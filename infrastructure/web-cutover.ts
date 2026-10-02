import { Action } from "alchemy/Action";
import * as Machines from "@distilled.cloud/fly-io/machines";
import { CredentialsFromEnv } from "@distilled.cloud/fly-io";
import { Effect, Schedule } from "effect";
import { FetchHttpClient } from "effect/unstable/http";

interface WebCutover {
  app: string;
  replacement: string;
  legacy: string;
  release: string;
  volume: string;
}

export interface WebMigration {
  app: string;
  retained?: { machine: string; volume: string };
}

const stoppedStates = ["stopped", "suspended", "created"];

const stopWebMachine = Effect.fn("stopWebMachine")(function* (
  app: string,
  id: string
) {
  const machine = yield* Machines.getMachine({ app_name: app, machine_id: id });
  if (!machine.config || !machine.instance_id)
    return yield* Effect.fail(new Error("Web configuration unavailable"));
  if (
    machine.config.services?.length ||
    machine.config.restart?.policy !== "no"
  ) {
    yield* Machines.updateMachine({
      app_name: app,
      machine_id: id,
      current_version: machine.instance_id,
      skip_launch: true,
      config: Object.assign({}, machine.config, {
        services: [],
        restart: { policy: "no" },
      }),
    });
  }
  const current = yield* Effect.gen(function* () {
    const updated = yield* Machines.getMachine({
      app_name: app,
      machine_id: id,
    });
    if (
      updated.config?.services?.length ||
      updated.config?.restart?.policy !== "no" ||
      ![...stoppedStates, "started", "failed"].includes(updated.state ?? "")
    )
      return yield* Effect.fail(
        new Error("Web traffic drain is still in progress")
      );
    return updated;
  }).pipe(Effect.retry({ times: 24, schedule: Schedule.spaced("5 seconds") }));
  if (!stoppedStates.includes(current.state ?? "")) {
    yield* Machines.stopMachine({
      app_name: app,
      machine_id: id,
      signal: "SIGTERM",
      timeout: "30s",
    });
    yield* Machines.waitMachine({
      app_name: app,
      machine_id: id,
      state: "stopped",
      timeout: 60,
    });
  }
  return undefined;
});

export const quiesceWebForMigration = Effect.fn("quiesceWebForMigration")(
  function* (input: WebMigration) {
    const machines = yield* Machines.listMachines({ app_name: input.app });
    if (input.retained) {
      const primary = machines.find(({ id }) => id === input.retained?.machine);
      if (
        !primary?.config?.mounts?.some(
          ({ path, volume }) =>
            path === "/root/.eve/auth" && volume === input.retained?.volume
        )
      )
        return yield* Effect.fail(new Error("Retained web volume unavailable"));
    }
    for (const machine of machines) {
      if (!machine.id || !machine.instance_id || !machine.config)
        return yield* Effect.fail(new Error("Web inventory incomplete"));
    }
    // Drain the entire app: an unrecorded replica can still use the old schema.
    for (const machine of machines) {
      if (machine.id) yield* stopWebMachine(input.app, machine.id);
    }
    const current = yield* Machines.listMachines({ app_name: input.app });
    if (
      current.some(
        (machine) =>
          !machines.some(({ id }) => id === machine.id) ||
          !stoppedStates.includes(machine.state ?? "") ||
          (machine.config?.services?.length ?? 0) > 0 ||
          machine.config?.restart?.policy !== "no"
      )
    )
      return yield* Effect.fail(
        new Error("Web is not quiescent; migration aborted")
      );
    return undefined;
  }
);

export const startMigratedWeb = Effect.fn("startMigratedWeb")(function* (
  input: Omit<WebCutover, "legacy" | "replacement"> & { machine: string }
) {
  const machine = yield* Effect.gen(function* () {
    const current = yield* Machines.getMachine({
      app_name: input.app,
      machine_id: input.machine,
    });
    if (![...stoppedStates, "started"].includes(current.state ?? ""))
      return yield* Effect.fail(
        new Error("Web image update is still in progress")
      );
    return current;
  }).pipe(Effect.retry({ times: 24, schedule: Schedule.spaced("5 seconds") }));
  if (
    machine.config?.image !== input.release ||
    machine.config.metadata?.["zoen.migrated-image"] !== input.release ||
    !machine.config.mounts?.some(
      ({ path, volume }) =>
        path === "/root/.eve/auth" && volume === input.volume
    )
  )
    return yield* Effect.fail(
      new Error("Migrated web image or volume mismatch")
    );
  if (machine.state !== "started") {
    yield* Machines.startMachine({
      app_name: input.app,
      machine_id: input.machine,
    });
  }
  yield* Machines.waitMachine({
    app_name: input.app,
    machine_id: input.machine,
    state: "started",
    timeout: 60,
  });
  yield* Effect.gen(function* () {
    const current = yield* Machines.getMachine({
      app_name: input.app,
      machine_id: input.machine,
    });
    if (
      current.state !== "started" ||
      !current.checks?.some(
        ({ name, status }) => name === "alive" && status === "passing"
      )
    )
      return yield* Effect.fail(new Error("Migrated web is not ready"));
    return undefined;
  }).pipe(Effect.retry({ times: 24, schedule: Schedule.spaced("5 seconds") }));
  return { machine: input.machine, release: input.release };
});

export const StartMigratedWeb = Action(
  "Zoen.StartMigratedWeb",
  (input: Parameters<typeof startMigratedWeb>[0]) =>
    startMigratedWeb(input).pipe(
      Effect.provide(CredentialsFromEnv),
      Effect.provide(FetchHttpClient.layer)
    )
);

export const retireLegacyWeb = Effect.fn("retireLegacyWeb")(function* (
  input: WebCutover
) {
  if (input.replacement === input.legacy)
    return yield* Effect.fail(new Error("Web cutover requires a new machine"));

  // Fly volumes are tied to a physical host. The replacement must have its
  // persistent volume and pass its own readiness check before removing traffic.
  yield* Effect.gen(function* () {
    const machine = yield* Machines.getMachine({
      app_name: input.app,
      machine_id: input.replacement,
    });
    if (
      machine.state !== "started" ||
      machine.config?.metadata?.["zoen.migrated-image"] !== input.release ||
      !machine.config.mounts?.some(
        (mount) =>
          mount.path === "/root/.eve/auth" && mount.volume === input.volume
      ) ||
      !machine.checks?.some(
        (check) => check.name === "alive" && check.status === "passing"
      )
    )
      return yield* Effect.fail(new Error("Replacement web is not ready"));
    return undefined;
  }).pipe(Effect.retry({ times: 24, schedule: Schedule.spaced("5 seconds") }));

  yield* stopWebMachine(input.app, input.legacy);
  return { machine: input.replacement, release: input.release };
});

export const RetireLegacyWeb = Action(
  "Zoen.RetireLegacyWeb",
  (input: WebCutover) =>
    retireLegacyWeb(input).pipe(
      Effect.provide(CredentialsFromEnv),
      Effect.provide(FetchHttpClient.layer)
    )
);
