import { Action } from "alchemy/Action";
import * as Machines from "@distilled.cloud/fly-io/machines";
import { CredentialsFromEnv } from "@distilled.cloud/fly-io";
import { Effect, Schedule } from "effect";
import { FetchHttpClient } from "effect/unstable/http";
import { quiesceWebForMigration, type WebMigration } from "./web-cutover.ts";

interface ApplicationMigration {
  app: string;
  primary: string;
  region: string;
  database: string;
  image: string;
  prepared: { host: string; release: string; credentialVersion: string };
  web: WebMigration;
}

/** The migration credential stays in the database app's vault, never in the web app. */
export const migrateApplication = Effect.fn("migrateApplication")(
  (input: ApplicationMigration) =>
    Effect.gen(function* () {
      const backup = yield* Machines.execMachine({
        app_name: input.app,
        machine_id: input.primary,
        command: ["/usr/local/bin/backup.sh", "incr"],
        timeout: 300,
      });
      if (backup.exit_code !== 0)
        return yield* Effect.fail(
          new Error(
            "Pre-migration backup failed; keeping the existing web release."
          )
        );
      yield* quiesceWebForMigration(input.web);
      const machine = yield* Effect.acquireRelease(
        Machines.createMachine({
          app_name: input.app,
          region: input.region,
          skip_service_registration: true,
          config: {
            image: input.image,
            guest: { cpu_kind: "shared", cpus: 1, memory_mb: 1024 },
            dns: { skip_registration: true },
            services: [],
            restart: { policy: "no" },
            init: {
              entrypoint: ["/bin/sh", "-c"],
              cmd: [
                "node --import tsx scripts/migrate-hosted.ts >/tmp/migration.log 2>&1; printf '%s' \"$?\" >/tmp/migration.exit; exec sleep infinity",
              ],
            },
            env: {
              POSTGRES_DB: input.database,
              ZOEN_DATABASE_HOST: input.prepared.host,
            },
            metadata: { "zoen.role": "isolated-migration" },
          },
        }),
        (created) =>
          created.id
            ? Machines.deleteMachine({
                app_name: input.app,
                machine_id: created.id,
                force: true,
              }).pipe(
                Effect.retry({
                  times: 5,
                  schedule: Schedule.exponential("1 second"),
                }),
                Effect.orDie
              )
            : Effect.void
      );
      if (!machine.id || machine.id === input.primary)
        return yield* Effect.fail(
          new Error("Invalid migration machine identity.")
        );
      yield* Machines.waitMachine({
        app_name: input.app,
        machine_id: machine.id,
        state: "started",
        timeout: 60,
      });
      let verified = false;
      for (let attempt = 0; attempt < 125; attempt++) {
        const status = yield* Machines.execMachine({
          app_name: input.app,
          machine_id: machine.id,
          command: [
            "sh",
            "-c",
            "test -f /tmp/migration.exit && cat /tmp/migration.exit",
          ],
          timeout: 10,
        });
        if (status.exit_code === 0) {
          if (status.stdout?.trim() !== "0")
            return yield* Effect.fail(
              new Error(
                "Database migration failed; web remains stopped. Inspect the migration journal before retrying."
              )
            );
          verified = true;
          break;
        }
        yield* Effect.sleep("5 seconds");
      }
      if (!verified)
        return yield* Effect.fail(
          new Error(
            "Database migration timed out; web remains stopped. Inspect the migration journal before retrying."
          )
        );
      const grants = yield* Machines.execMachine({
        app_name: input.app,
        machine_id: input.primary,
        command: ["/usr/local/bin/bootstrap-application.sh"],
        timeout: 60,
      });
      if (grants.exit_code !== 0)
        return yield* Effect.fail(
          new Error("Runtime grant verification failed; web remains stopped.")
        );
      return { image: input.image, verified: true };
    }).pipe(Effect.scoped)
);

export const MigrateApplication = Action(
  "Zoen.MigrateApplication",
  (input: ApplicationMigration) =>
    migrateApplication(input).pipe(
      Effect.provide(CredentialsFromEnv),
      Effect.provide(FetchHttpClient.layer)
    )
);
