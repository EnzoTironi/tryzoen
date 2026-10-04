import assert from "node:assert/strict";
import { createHash } from "node:crypto";
// oxlint-disable-next-line vitest/no-import-node-test -- This isolated package uses the Node runner.
import { test } from "node:test";
import { credentials, Retry } from "@distilled.cloud/fly-io";
import type { Machine } from "@distilled.cloud/fly-io/machines";
import { Effect, Schema } from "effect";
import { FetchHttpClient } from "effect/unstable/http";
import { migrateApplication } from "../migrations.ts";
import { startMigratedWeb } from "../web-cutover.ts";
import {
  erasureJournalSecretNames,
  privatePayloadSecretNames,
  privatePayloadVersion,
  privateStorageSecretNames,
} from "../secrets.ts";

const secretDigests = privateStorageSecretNames.map((name) => ({
  name,
  digest: `opaque-${name}`,
}));
const payloadDigests = privatePayloadSecretNames.map((name) => [
  name,
  `opaque-${name}`,
]);
const journalVersion = createHash("sha256")
  .update(
    JSON.stringify(erasureJournalSecretNames.map((name) => `opaque-${name}`))
  )
  .digest("hex");

const migration = {
  app: "test-pg",
  primary: "primary-pg",
  region: "gru",
  database: "application",
  image: "registry.fly.io/test-web@sha256:verified",
  prepared: {
    host: "primary.internal",
    release: "pg-image",
    credentialVersion: "v1",
  },
  storage: {
    payloadVersion: createHash("sha256")
      .update(JSON.stringify([payloadDigests, payloadDigests]))
      .digest("hex"),
    migrationJournalVersion: journalVersion,
    webJournalVersion: journalVersion,
  },
  web: {
    app: "test-web",
    retained: { machine: "primary-web", volume: "vol_auth" },
  },
};
const commandSchema = Schema.Struct({ command: Schema.Array(Schema.String) });
const updateSchema = Schema.Struct({ config: Schema.Unknown });

function migrationApi({
  backup = 0,
  migrationExit = "0",
  grant = 0,
  inventory = 0,
  stopWorks = true,
  volume = "vol_auth",
  secretApp = "",
  missingSecret = "",
  duplicateSecret = "",
  rotatedSecret = "",
  emptyDigest = "",
  secretStatus = 200,
} = {}) {
  const web: Machine[] = ["primary-web", "unrecorded-replica"].map((id) => ({
    id,
    instance_id: `${id}-version`,
    state: "started",
    config: {
      image: "old-web-image",
      env: { SETTING: "preserved" },
      mounts: id === "primary-web" ? [{ path: "/root/.eve/auth", volume }] : [],
      services: [{ internal_port: 3000, autostart: true }],
      restart: { policy: "always" },
    },
  }));
  const calls: string[] = [];
  const fetch: typeof globalThis.fetch = async (url, init) => {
    const request = new Request(url, init);
    const requestUrl = new URL(request.url);
    const path = requestUrl.pathname;
    if (path.endsWith("/secrets")) {
      calls.push(`${request.method} ${path}`);
      assert.equal(request.method, "GET");
      assert.equal(requestUrl.searchParams.get("show_secrets"), "false");
      const app = path.split("/")[3];
      const secrets = secretDigests
        .filter(({ name }) => app !== secretApp || name !== missingSecret)
        .flatMap((secret) => {
          if (app !== secretApp) return [secret];
          if (secret.name === duplicateSecret) return [secret, secret];
          return [
            {
              ...secret,
              digest:
                secret.name === rotatedSecret
                  ? "rotated-digest"
                  : secret.name === emptyDigest
                    ? "  "
                    : secret.digest,
            },
          ];
        });
      return app === secretApp && secretStatus !== 200
        ? Response.json(
            { error: "private provider diagnostics with credential material" },
            { status: secretStatus }
          )
        : Response.json({ secrets });
    }
    if (path.includes("/test-web/")) {
      calls.push(`${request.method} ${path}`);
      if (path.endsWith("/machines")) return Response.json(web);
      const id = path.split("/")[5];
      const machine = web.find((item) => item.id === id);
      assert.ok(machine);
      if (path.endsWith("/stop")) {
        if (stopWorks) machine.state = "stopped";
        return Response.json({});
      }
      if (path.endsWith("/wait")) return Response.json({});
      if (request.method === "POST") {
        const body = Schema.decodeUnknownSync(updateSchema)(
          await request.json()
        );
        const config = body.config;
        assert.ok(config && typeof config === "object");
        machine.config = Object.assign({}, machine.config, config);
      }
      return Response.json(machine);
    }
    assert.ok(path.includes("/test-pg/"));
    if (path.endsWith("/exec")) {
      const body = Schema.decodeUnknownSync(commandSchema)(
        await request.json()
      );
      const command = body.command[0];
      assert.ok(command);
      calls.push(command);
      return Response.json({
        exit_code: command.endsWith("backup.sh")
          ? backup
          : command.endsWith("bootstrap-application.sh")
            ? grant
            : command.endsWith("backup-health.sh")
              ? inventory
              : 0,
        stdout: command === "sh" ? migrationExit : "",
        stderr: "private database diagnostics",
      });
    }
    calls.push(`${request.method} ${path}`);
    if (path.endsWith("/machines") && request.method === "POST") {
      assert.ok(
        web.every(
          ({ state, config }) =>
            state === "stopped" &&
            config?.restart?.policy === "no" &&
            config.services?.length === 0
        )
      );
      return Response.json({ id: "isolated-migration", state: "started" });
    }
    return Response.json({});
  };
  return {
    web,
    calls,
    run: () =>
      Effect.runPromise(
        migrateApplication(migration).pipe(
          Retry.none,
          Effect.provide(
            credentials({
              apiKey: "test-token",
              apiBaseUrl: "https://fly.invalid/v1",
            })
          ),
          Effect.provide(FetchHttpClient.layer),
          Effect.provideService(FetchHttpClient.Fetch, fetch)
        )
      ),
    prepare: () =>
      Effect.runPromise(
        privatePayloadVersion([migration.app, migration.web.app]).pipe(
          Retry.none,
          Effect.provide(
            credentials({
              apiKey: "test-token",
              apiBaseUrl: "https://fly.invalid/v1",
            })
          ),
          Effect.provide(FetchHttpClient.layer),
          Effect.provideService(FetchHttpClient.Fetch, fetch)
        )
      ),
  };
}

await test("backs up, drains web, migrates, grants, verifies the inventory and removes the temporary machine in order", async () => {
  const api = migrationApi();
  assert.deepEqual(await api.run(), {
    image: migration.image,
    verified: true,
    privateStorageVersion: createHash("sha256")
      .update(JSON.stringify(migration.storage))
      .digest("hex"),
  });
  assert.deepEqual(api.calls.slice(0, 3), [
    "GET /v1/apps/test-pg/secrets",
    "GET /v1/apps/test-web/secrets",
    "/usr/local/bin/backup.sh",
  ]);
  const create = api.calls.indexOf("POST /v1/apps/test-pg/machines");
  assert.ok(
    create >
      api.calls.indexOf(
        "POST /v1/apps/test-web/machines/unrecorded-replica/stop"
      )
  );
  assert.ok(
    api.calls.indexOf("/usr/local/bin/bootstrap-application.sh") > create
  );
  assert.ok(
    api.calls.indexOf("/usr/local/bin/backup-health.sh") >
      api.calls.indexOf("/usr/local/bin/bootstrap-application.sh")
  );
  assert.equal(
    api.calls.at(-1),
    "DELETE /v1/apps/test-pg/machines/isolated-migration"
  );
  assert.deepEqual(api.web[0].config?.mounts, [
    { path: "/root/.eve/auth", volume: "vol_auth" },
  ]);
  assert.deepEqual(api.web[0].config.env, { SETTING: "preserved" });
  assert.ok(api.web.every(({ config }) => config?.image === "old-web-image"));
});

await test("a backup failure leaves every serving web machine untouched", async () => {
  const api = migrationApi({ backup: 1 });
  await assert.rejects(api.run(), /Pre-migration backup failed/);
  assert.deepEqual(api.calls, [
    "GET /v1/apps/test-pg/secrets",
    "GET /v1/apps/test-web/secrets",
    "/usr/local/bin/backup.sh",
  ]);
  assert.ok(api.web.every(({ state }) => state === "started"));
});

for (const secretApp of [migration.app, migration.web.app]) {
  for (const missingSecret of privateStorageSecretNames) {
    await test(`missing ${missingSecret} in ${secretApp} leaves all serving machines untouched`, async () => {
      const api = migrationApi({ secretApp, missingSecret });
      await assert.rejects(api.run(), /missing or ambiguous/);
      assert.ok(
        api.calls.every(
          (call) => call.startsWith("GET ") && call.endsWith("/secrets")
        )
      );
      assert.ok(api.web.every(({ state }) => state === "started"));
    });
  }
  await test(`ambiguous or empty secret metadata in ${secretApp} aborts before backup or drain`, async () => {
    for (const problem of [
      { duplicateSecret: "ZOEN_PAYLOAD_ACCESS_KEY" },
      { emptyDigest: "ZOEN_ERASURE_JOURNAL_SECRET_KEY" },
    ]) {
      const api = migrationApi({ secretApp, ...problem });
      await assert.rejects(api.run(), /missing or ambiguous/);
      assert.ok(
        api.calls.every(
          (call) => call.startsWith("GET ") && call.endsWith("/secrets")
        )
      );
      assert.ok(api.web.every(({ state }) => state === "started"));
    }
  });
  await test(`an unavailable ${secretApp} vault aborts with sanitized diagnostics before backup or drain`, async () => {
    const api = migrationApi({ secretApp, secretStatus: 503 });
    await assert.rejects(
      api.run(),
      (error: unknown) =>
        error instanceof Error &&
        error.message.includes(
          "Private storage secret inventory unavailable"
        ) &&
        !error.message.includes("credential material")
    );
    assert.ok(
      api.calls.every(
        (call) => call.startsWith("GET ") && call.endsWith("/secrets")
      )
    );
    assert.ok(api.web.every(({ state }) => state === "started"));
  });
  for (const rotatedSecret of [
    "ZOEN_PAYLOAD_SECRET_KEY",
    "ZOEN_ERASURE_JOURNAL_SECRET_KEY",
  ]) {
    await test(`a rotated ${rotatedSecret} in ${secretApp} requires a newly prepared deployment before drain`, async () => {
      const api = migrationApi({ secretApp, rotatedSecret });
      await assert.rejects(api.run(), /Private storage secrets changed/);
      assert.ok(
        api.calls.every(
          (call) => call.startsWith("GET ") && call.endsWith("/secrets")
        )
      );
      assert.ok(api.web.every(({ state }) => state === "started"));
    });
  }
}

await test("deployment preparation reads payload digests afresh and never requires managed journal credentials", async () => {
  const first = migrationApi({
    secretApp: migration.app,
    missingSecret: "ZOEN_ERASURE_JOURNAL_SECRET_KEY",
  });
  assert.equal(await first.prepare(), migration.storage.payloadVersion);
  const second = migrationApi({
    secretApp: migration.web.app,
    rotatedSecret: "ZOEN_PAYLOAD_PREFIX",
  });
  assert.notEqual(await second.prepare(), migration.storage.payloadVersion);
  assert.ok(
    [...first.calls, ...second.calls].every(
      (call) => call.startsWith("GET ") && call.endsWith("/secrets")
    )
  );
});

await test("a wrong retained volume aborts before mutating web or applying migrations", async () => {
  const api = migrationApi({ volume: "unexpected-volume" });
  await assert.rejects(api.run(), /Retained web volume unavailable/);
  assert.ok(api.web.every(({ state }) => state === "started"));
  assert.ok(!api.calls.includes("POST /v1/apps/test-pg/machines"));
});

await test("a partial drain never starts the migrator", async () => {
  const api = migrationApi({ stopWorks: false });
  await assert.rejects(api.run(), /migration aborted/);
  assert.ok(!api.calls.includes("POST /v1/apps/test-pg/machines"));
});

await test("a failed migration removes its temporary machine and leaves old web stopped", async () => {
  const api = migrationApi({ migrationExit: "1" });
  await assert.rejects(api.run(), /web remains stopped/);
  assert.ok(api.web.every(({ state }) => state === "stopped"));
  assert.ok(!api.calls.includes("/usr/local/bin/bootstrap-application.sh"));
  assert.equal(
    api.calls.at(-1),
    "DELETE /v1/apps/test-pg/machines/isolated-migration"
  );
});

await test("a failed grant verification leaves old web stopped and diagnostics private", async () => {
  const api = migrationApi({ grant: 1 });
  await assert.rejects(
    api.run(),
    (error: unknown) =>
      error instanceof Error &&
      error.message.includes("web remains stopped") &&
      !error.message.includes("private database diagnostics")
  );
  assert.ok(api.web.every(({ state }) => state === "stopped"));
  assert.equal(
    api.calls.at(-1),
    "DELETE /v1/apps/test-pg/machines/isolated-migration"
  );
});

await test("a failed backup inventory probe keeps web stopped and removes the temporary migrator", async () => {
  const api = migrationApi({ inventory: 1 });
  await assert.rejects(
    api.run(),
    /Backup inventory verification failed; web remains stopped/
  );
  assert.ok(api.web.every(({ state }) => state === "stopped"));
  assert.equal(
    api.calls.at(-1),
    "DELETE /v1/apps/test-pg/machines/isolated-migration"
  );
});

function startupApi(
  image = migration.image,
  marker = migration.image,
  volume = "vol_auth"
) {
  const calls: string[] = [];
  const machine: Machine = {
    id: "primary-web",
    state: "stopped",
    config: {
      image,
      metadata: { "zoen.migrated-image": marker },
      mounts: [{ path: "/root/.eve/auth", volume }],
    },
    checks: [{ name: "alive", status: "passing" }],
  };
  const fetch: typeof globalThis.fetch = async (url, init) => {
    const request = new Request(url, init);
    const path = new URL(request.url).pathname;
    calls.push(path);
    if (path.endsWith("/start")) {
      machine.state = "started";
      return Response.json({});
    }
    if (path.endsWith("/wait")) return Response.json({});
    return Response.json(machine);
  };
  return {
    calls,
    run: () =>
      Effect.runPromise(
        startMigratedWeb({
          app: migration.web.app,
          machine: "primary-web",
          release: migration.image,
          volume: "vol_auth",
        }).pipe(
          Retry.none,
          Effect.provide(
            credentials({
              apiKey: "test-token",
              apiBaseUrl: "https://fly.invalid/v1",
            })
          ),
          Effect.provide(FetchHttpClient.layer),
          Effect.provideService(FetchHttpClient.Fetch, fetch)
        )
      ),
  };
}

await test("starts the migrated mounted image and proves its readiness", async () => {
  const api = startupApi();
  assert.deepEqual(await api.run(), {
    machine: "primary-web",
    release: migration.image,
  });
  assert.ok(api.calls[0].endsWith("/primary-web"));
  assert.ok(api.calls[1].endsWith("/start"));
  assert.ok(api.calls[2].endsWith("/wait"));
  assert.ok(api.calls.at(-1)?.endsWith("/primary-web"));
});

for (const [image, marker, volume] of [
  ["old-image", migration.image, "vol_auth"],
  [migration.image, "unverified-image", "vol_auth"],
  [migration.image, migration.image, "unexpected-volume"],
]) {
  await test(`refuses startup with mismatched image, migration marker or volume: ${image}/${marker}/${volume}`, async () => {
    const api = startupApi(image, marker, volume);
    await assert.rejects(api.run(), /image or volume mismatch/);
    assert.ok(api.calls.every((path) => path.endsWith("/primary-web")));
  });
}
