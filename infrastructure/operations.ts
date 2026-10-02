import * as Machines from "@distilled.cloud/fly-io/machines";
import { CredentialsFromEnv } from "@distilled.cloud/fly-io";
import { NodeRuntime } from "@effect/platform-node";
import { Config, Effect } from "effect";
import { FetchHttpClient } from "effect/unstable/http";
import { production } from "./production.ts";

const databaseCheck = Effect.gen(function* () {
  const machine = yield* Machines.getMachine({
    app_name: production.database.app,
    machine_id: production.database.machine,
  });
  if (
    machine.state !== "started" ||
    machine.config?.mounts?.[0]?.volume !== production.database.volume
  ) {
    return yield* Effect.fail(
      new Error(
        "Production PostgreSQL machine or volume does not match its declared identity"
      )
    );
  }
  const check = yield* Machines.execMachine({
    app_name: production.database.app,
    machine_id: production.database.machine,
    command: ["/usr/local/bin/backup-health.sh"],
    timeout: 60,
  });
  if (check.exit_code !== 0)
    return yield* Effect.fail(
      new Error("PostgreSQL backup or WAL archive health check failed")
    );
  yield* Effect.log(check.stdout ?? "Backup check passed");
  // File content lives on the paired web/Eve persistent volume. This verifies
  // placement only; it is not a recall, restore or throughput proof.
  const webs = yield* Machines.listMachines({ app_name: production.web.app });
  const web = webs.find(
    (candidate) =>
      candidate.name === production.web.name && candidate.state === "started"
  );
  const volume = yield* Config.string("ZOEN_FILE_MEMORY_VOLUME_ID");
  if (
    !web?.id ||
    !web.config?.mounts?.some(
      (mount) => mount.path === "/var/lib/zoen" && mount.volume === volume
    )
  )
    return yield* Effect.fail(
      new Error("File-memory volume placement is not verified")
    );
  const matrix = yield* Machines.execMachine({
    app_name: production.database.app,
    machine_id: production.database.machine,
    command: [
      "wget",
      "-q",
      "-T",
      "15",
      "-O",
      "-",
      `http://${production.matrix.app}.internal:8008/health`,
    ],
    timeout: 20,
  });
  if (matrix.exit_code !== 0 || matrix.stdout?.trim() !== "OK")
    return yield* Effect.fail(new Error("Private Matrix health check failed"));
  const roles = yield* Machines.execMachine({
    app_name: production.database.app,
    machine_id: production.database.machine,
    command: [
      "psql",
      "-X",
      "-U",
      "postgres",
      "-d",
      "open_instinct_prod",
      "-At",
      "-c",
      "SELECT (count(*) = 2 AND bool_and(NOT rolsuper AND NOT rolcreatedb AND NOT rolcreaterole AND NOT rolreplication AND NOT rolbypassrls) AND NOT pg_has_role('zoen_app','zoen_migrator','MEMBER'))::text FROM pg_roles WHERE rolname IN ('zoen_app','zoen_migrator')",
    ],
    timeout: 20,
  });
  if (roles.exit_code !== 0 || roles.stdout?.trim() !== "true")
    return yield* Effect.fail(
      new Error("Application database role isolation failed")
    );
  return yield* Effect.log(
    "PostgreSQL roles, backup status and private-memory volume placement verified."
  );
});

const vaultCheck = Effect.gen(function* () {
  const vaults = yield* Machines.listMachines({
    app_name: production.vaultwarden.app,
  });
  const vault = vaults.find(
    (candidate) =>
      candidate.name === "vaultwarden" && candidate.state === "started"
  );
  if (!vault?.id)
    return yield* Effect.fail(new Error("Hosted vault is not running"));
  const vaultBackup = yield* Machines.execMachine({
    app_name: production.vaultwarden.app,
    machine_id: vault.id,
    command: ["/usr/local/bin/backup-health.sh"],
    timeout: 60,
  });
  if (vaultBackup.exit_code !== 0)
    return yield* Effect.fail(
      new Error("Vault encrypted backup or volume health check failed")
    );
  return yield* Effect.log(vaultBackup.stdout ?? "Vault backup check passed");
});

const main = Effect.gen(function* () {
  const command = process.argv[2];
  if (command !== "check")
    return yield* Effect.fail(new Error("Usage: node operations.ts check"));
  yield* databaseCheck;
  const vaultEnabled = yield* Config.boolean("ZOEN_VAULT_PROBE_ENABLED").pipe(
    Config.withDefault(false)
  );
  if (vaultEnabled) yield* vaultCheck;
  else
    yield* Effect.log(
      "Vault probe inactive until the hosted vault is deployed."
    );
  const whatsappEnabled = yield* Config.boolean(
    "ZOEN_WHATSAPP_PROBE_ENABLED"
  ).pipe(Config.withDefault(false));
  if (!whatsappEnabled)
    return yield* Effect.log(
      "WhatsApp bridge probe inactive until a live paired session exists."
    );
  const whatsapp = yield* Machines.execMachine({
    app_name: production.database.app,
    machine_id: production.database.machine,
    command: [
      "wget",
      "-q",
      "-T",
      "15",
      "-O",
      "-",
      `http://${production.whatsapp.app}.internal:29318/_matrix/mau/live`,
    ],
    timeout: 20,
  });
  if (whatsapp.exit_code !== 0)
    return yield* Effect.fail(
      new Error("Private WhatsApp bridge health check failed")
    );
  return yield* Effect.log(whatsapp.stdout ?? "WhatsApp bridge check passed");
}).pipe(
  Effect.provide(CredentialsFromEnv),
  Effect.provide(FetchHttpClient.layer)
);

NodeRuntime.runMain(main);
