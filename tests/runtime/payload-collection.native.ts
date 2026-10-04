import { randomUUID } from "node:crypto";
import { createServer, request } from "node:http";
import { mkdir, readFile, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { setTimeout as delay } from "node:timers/promises";
import type { Socket } from "node:net";
import { Client } from "pg";
import { sql } from "drizzle-orm";
import {
  afterAll,
  afterEach,
  beforeAll,
  beforeEach,
  describe,
  expect,
  it,
  vi,
} from "vitest";
import { z } from "zod";
import { query, transaction } from "@db/queries";
import { env } from "@shared/environment/env";
import {
  collectPayloads,
  collectPayloadOrphans,
  discoverPayloadOrphans,
} from "../../server/payloads/collection";
import { openPayloads } from "../../server/payloads/connection";
import {
  PayloadReferenceSchema,
  PayloadScopeSchema,
  type PayloadReference,
} from "../../server/payloads/contract";
import {
  adoptPayload,
  putRegistered,
  readPayload,
  registerPayload,
} from "../../server/payloads/publication";
import { payloadDigest, payloadObjectKey } from "../../server/payloads/s3";
import { operationSignal } from "../../server/operations/async";
import {
  drainPayloadErasures,
  queuePayloadErasure,
} from "../../server/payloads/erasure";
import { drainMemoryErasures } from "../../server/memory/erasure";
import {
  isMemoryNamespaceErased,
  memoryNamespace,
} from "../../server/memory/namespace";
import { PrivateMemoryRepository } from "../../server/memory/repository";
import { publishWorkspaceGit } from "../../server/workspaces/git";
import { workspaceFixture } from "./workspace-fixture";

async function providerRead(reference: PayloadReference) {
  const connection = openPayloads();
  try {
    return await connection.payloads.readVerified({
      reference,
      signal: operationSignal(),
      deadlineMs: Date.now() + 5000,
    });
  } finally {
    connection.close();
  }
}

async function ready(reference: PayloadReference) {
  await transaction(() =>
    query(
      sql`UPDATE payload_object SET available_at=clock_timestamp() WHERE id=${reference.candidateId}`
    )
  );
}

describe("native payload collection", () => {
  let administrator: Client;
  let fixture: Awaited<ReturnType<typeof workspaceFixture>> | undefined;
  let scope: z.infer<typeof PayloadScopeSchema>;
  let bundle: Awaited<ReturnType<typeof publishWorkspaceGit>>;

  beforeAll(async () => {
    const database = new URL(env.DATABASE_URL);
    if (
      env.NODE_ENV !== "test" ||
      database.hostname !== "127.0.0.1" ||
      database.port !== "15432" ||
      database.pathname !== "/companion_runtime_test" ||
      database.username !== "zoen_app" ||
      env.ZOEN_PAYLOAD_ENDPOINT !== "http://127.0.0.1:19480" ||
      env.ZOEN_PAYLOAD_BUCKET !== "synthetic-storage-2a69cdcd"
    )
      throw new Error(
        "Collection proof requires the owned PostgreSQL and RustFS fixtures"
      );
    database.username = "postgres";
    database.password = "synthetic-admin";
    administrator = new Client({
      connectionString: database.toString(),
      connectionTimeoutMillis: 5000,
    });
    await administrator.connect();
    bundle = await publishWorkspaceGit({
      bundle: null,
      parent: null,
      changes: [
        {
          path: "knowledge/collection-proof.md",
          content: "Synthetic collection proof",
        },
      ],
      message: "Synthetic collection proof",
    });
  });

  beforeEach(async () => {
    fixture = await workspaceFixture();
    const [row] = await query(
      sql`SELECT payload_generation AS generation FROM workspaces WHERE id=${fixture.actor.workspaceId}`
    );
    scope = PayloadScopeSchema.parse({
      workspaceId: fixture.actor.workspaceId,
      ownerGeneration: row?.generation,
      ownerUserId: null,
      kind: "workspace-bundle",
    });
    await floor();
  });

  afterEach(async () => {
    vi.unstubAllEnvs();
    if (fixture) {
      const users = [fixture.actor.userId, fixture.guest.userId];
      await fixture[Symbol.asyncDispose]();
      await transaction(() =>
        query(
          sql`UPDATE payload_object SET available_at=clock_timestamp()+interval '1 day' WHERE workspace_id=${scope.workspaceId}`
        )
      );
      await transaction(() =>
        query(sql`UPDATE payload_orphan SET available_at=clock_timestamp()+interval '1 day'
        WHERE object_key LIKE ${env.ZOEN_PAYLOAD_PREFIX + "/workspace/" + payloadDigest(scope.workspaceId) + "/" + scope.ownerGeneration + "/%"}`)
      );
      await transaction(async () => {
        await query(sql`UPDATE payload_erasure SET available_at=clock_timestamp()+interval '1 day'
          WHERE owner_user_id IN (${users[0]},${users[1]})`);
        await query(sql`UPDATE workspace_memory_erasure SET available_at=clock_timestamp()+interval '1 day'
          WHERE owner_user_id IN (${users[0]},${users[1]})`);
        await query(sql`UPDATE payload_object SET available_at=clock_timestamp()+interval '1 day'
          WHERE owner_user_id IN (${users[0]},${users[1]})`);
      });
      fixture = undefined;
    }
  });

  afterAll(async () => {
    await administrator.end();
  });

  async function floor() {
    // This is a synthetic retention inventory supplied by the fixture's backup
    // administrator. The application role is never permitted to mint one.
    await delay(10);
    await administrator.query(`INSERT INTO zoen_maintenance.payload_backup_inventory(repository,oldest_backup_start,observed_at)
      VALUES ('zoen',clock_timestamp(),clock_timestamp()) ON CONFLICT(repository) DO UPDATE
      SET oldest_backup_start=EXCLUDED.oldest_backup_start,observed_at=EXCLUDED.observed_at`);
  }

  async function uploaded() {
    const reference = await transaction(() =>
      registerPayload(scope, bundle.bundle)
    );
    await putRegistered(reference, bundle.bundle);
    return reference;
  }

  async function published() {
    const reference = await uploaded();
    await transaction(async () => {
      await adoptPayload(reference);
      await query(sql`INSERT INTO workspace_repository(workspace_id,head_sha,payload_object_id)
        VALUES (${scope.workspaceId},${bundle.revision},${reference.candidateId})
        ON CONFLICT(workspace_id) DO UPDATE SET payload_object_id=EXCLUDED.payload_object_id`);
    });
    return reference;
  }

  async function expired(rawScope: z.input<typeof PayloadScopeSchema> = scope) {
    const reference = unregistered(rawScope);
    // A native, already expired intent models a process that disappeared after
    // committing its intent. No immutable coordinate or guard is altered.
    await transaction(() =>
      query(sql`INSERT INTO payload_object(id,workspace_id,owner_generation,owner_user_id,kind,sha256,byte_length,created_at,write_until)
      VALUES (${reference.candidateId},${reference.workspaceId},${reference.ownerGeneration},${reference.ownerUserId},${reference.kind},${reference.sha256},${reference.byteLength},
        clock_timestamp()-interval '3 minutes',clock_timestamp()-interval '1 minute')`)
    );
    await directPut(reference);
    return reference;
  }

  function unregistered(rawScope: z.input<typeof PayloadScopeSchema> = scope) {
    return PayloadReferenceSchema.parse({
      ...rawScope,
      candidateId: randomUUID(),
      sha256: payloadDigest(bundle.bundle),
      byteLength: bundle.bundle.byteLength,
    });
  }

  async function directPut(reference: PayloadReference) {
    const connection = openPayloads();
    try {
      await connection.payloads.putVerified({
        candidate: reference,
        bytes: bundle.bundle,
        signal: operationSignal(),
        deadlineMs: Date.now() + 5000,
      });
    } finally {
      connection.close();
    }
  }

  function owner() {
    if (!fixture) throw new Error("Missing owned workspace fixture");
    return fixture;
  }

  function privateScope(namespaceId: string = randomUUID()) {
    return PayloadScopeSchema.options[2].parse({
      ...scope,
      kind: "private-memory-bundle",
      ownerUserId: owner().actor.userId,
      ownerGeneration: namespaceId,
    });
  }

  async function accountIntent() {
    const user = owner().actor.userId;
    const requestId = randomUUID();
    // Real native privacy coordinates authorize the transport/coordinator proof.
    // This does not claim qualification of the full account-deletion request UI.
    await transaction(async () => {
      await query(sql`INSERT INTO account_deletion_requests(id,user_id,status,completed_at,backup_expires_at)
        VALUES (${requestId},${user},'pending_external',clock_timestamp(),clock_timestamp()+interval '30 days')`);
      await query(
        sql`INSERT INTO account_deletion_tombstones(user_id,request_id) VALUES (${user},${requestId})`
      );
      await query(
        sql`INSERT INTO account_deletion_ledger(request_id,surface,status) VALUES (${requestId},'private_files','pending_external')`
      );
    });
    return user;
  }

  async function namespaceIntent(namespaceId: string) {
    const user = owner().actor.userId;
    return transaction(async () => {
      await query(sql`INSERT INTO workspace_memory_erasure(namespace_id,owner_user_id)
        VALUES (${namespaceId},${user}) ON CONFLICT DO NOTHING`);
      return queuePayloadErasure({
        kind: "private-memory",
        ownerUserId: user,
        namespaceId,
      });
    });
  }

  async function readyErasure(scopeKey = "account") {
    await transaction(() =>
      query(sql`UPDATE payload_erasure SET available_at=clock_timestamp()
      WHERE owner_user_id=${owner().actor.userId} AND scope_key=${scopeKey}`)
    );
  }

  async function deletionFault(
    reference: PayloadReference,
    mode: "lost-ack" | "late-put"
  ) {
    const sockets = new Set<Socket>();
    const observations: { method: string; path: string; status?: number }[] =
      [];
    const connection = openPayloads();
    const bucket = z
      .literal("synthetic-storage-2a69cdcd")
      .parse(env.ZOEN_PAYLOAD_BUCKET);
    const key = `/${bucket}/${payloadObjectKey(env.ZOEN_PAYLOAD_PREFIX, reference)}`;
    const proxy = createServer((incoming, outgoing) => {
      const observation: (typeof observations)[number] = {
        method: incoming.method ?? "",
        path: new URL(incoming.url ?? "/", "http://127.0.0.1:19480").pathname,
      };
      observations.push(observation);
      const upstream = request(
        new URL(incoming.url ?? "/", "http://127.0.0.1:19480"),
        { method: incoming.method, headers: incoming.headers },
        (response) => {
          observation.status = response.statusCode;
          if (incoming.method === "DELETE" && observation.path === key) {
            response.resume();
            response.on("end", () => {
              if (mode === "lost-ack") {
                outgoing.destroy();
                return;
              }
              void connection.payloads
                .putVerified({
                  candidate: reference,
                  bytes: bundle.bundle,
                  signal: operationSignal(),
                  deadlineMs: Date.now() + 5000,
                })
                .then(
                  () => {
                    outgoing.writeHead(
                      response.statusCode ?? 502,
                      response.headers
                    );
                    outgoing.end();
                  },
                  () => outgoing.destroy()
                );
            });
          } else {
            outgoing.writeHead(response.statusCode ?? 502, response.headers);
            response.pipe(outgoing);
          }
        }
      );
      upstream.on("error", () => outgoing.destroy());
      incoming.on("aborted", () => upstream.destroy());
      outgoing.on("close", () => upstream.destroy());
      incoming.pipe(upstream);
    });
    proxy.on("connection", (socket) => {
      sockets.add(socket);
      socket.on("close", () => sockets.delete(socket));
    });
    await new Promise<void>((resolve, reject) => {
      proxy.once("error", reject);
      proxy.listen(0, "127.0.0.1", resolve);
    });
    const address = proxy.address();
    if (!address || typeof address === "string")
      throw new Error("No owned proxy address");
    vi.stubEnv("ZOEN_PAYLOAD_ENDPOINT", `http://127.0.0.1:${address.port}`);
    return {
      observations,
      key,
      async [Symbol.asyncDispose]() {
        vi.unstubAllEnvs();
        connection.close();
        for (const socket of sockets) socket.destroy();
        await new Promise<void>((resolve, reject) =>
          proxy.close((error) => {
            if (error) reject(error);
            else resolve();
          })
        );
      },
    };
  }

  it("fails closed without a fresh backup inventory and prevents the application from forging it", async () => {
    await expect(
      transaction(() =>
        query(
          sql`UPDATE zoen_maintenance.payload_backup_inventory SET oldest_backup_start=clock_timestamp()`
        )
      )
    ).rejects.toThrow("database operation failed");
    await expect(
      transaction(() =>
        query(sql`DELETE FROM zoen_maintenance.payload_backup_inventory`)
      )
    ).rejects.toThrow("database operation failed");
    await expect(
      transaction(() =>
        query(
          sql`INSERT INTO zoen_maintenance.payload_backup_inventory VALUES ('zoen',now(),now())`
        )
      )
    ).rejects.toThrow("database operation failed");
    await administrator.query(
      "DELETE FROM zoen_maintenance.payload_backup_inventory"
    );
    await expect(collectPayloads()).rejects.toMatchObject({
      reason: "unavailable",
    });
    await floor();
    await administrator.query(
      "UPDATE zoen_maintenance.payload_backup_inventory SET oldest_backup_start=clock_timestamp()-interval '1 hour',observed_at=clock_timestamp()-interval '6 minutes'"
    );
    await expect(collectPayloads()).rejects.toMatchObject({
      reason: "unavailable",
    });
    await administrator.query(
      "UPDATE zoen_maintenance.payload_backup_inventory SET observed_at=clock_timestamp()+interval '1 minute'"
    );
    await expect(collectPayloads()).rejects.toMatchObject({
      reason: "unavailable",
    });
  });

  it("keeps a current reader's native locks through pointer replacement and preserves the new head", async () => {
    const previous = await published();
    const next = await uploaded();
    const held = Promise.withResolvers<void>();
    const release = Promise.withResolvers<void>();
    const reader = transaction(async () => {
      await query(
        sql`SELECT payload_object_id FROM workspace_repository WHERE workspace_id=${scope.workspaceId} FOR SHARE`
      );
      const bytes = await readPayload(scope, previous.candidateId);
      held.resolve();
      await release.promise;
      return bytes;
    });
    await held.promise;
    let replacement: Promise<void> | undefined;
    try {
      await expect(
        administrator.query(
          "SELECT id FROM payload_object WHERE id=$1 FOR UPDATE NOWAIT",
          [previous.candidateId]
        )
      ).rejects.toMatchObject({ code: "55P03" });
      replacement = transaction(async () => {
        await adoptPayload(next);
        await query(
          sql`UPDATE workspace_repository SET payload_object_id=${next.candidateId} WHERE workspace_id=${scope.workspaceId}`
        );
      });
      await expect
        .poll(
          async () => {
            const result = await administrator.query(
              "SELECT count(*)::integer AS count FROM pg_stat_activity WHERE usename='zoen_app' AND cardinality(pg_blocking_pids(pid))>0"
            );
            return z
              .array(z.object({ count: z.number().int() }))
              .length(1)
              .parse(result.rows)[0]?.count;
          },
          { timeout: 5000, interval: 20 }
        )
        .toBe(1);
      expect(await collectPayloads()).toEqual({ removed: 0 });
    } finally {
      release.resolve();
      await reader;
      await replacement;
    }
    expect(Buffer.from(await reader)).toEqual(bundle.bundle);
    await floor();
    expect(await collectPayloads()).toEqual({ removed: 1 });
    await expect(providerRead(previous)).rejects.toMatchObject({
      reason: "missing",
    });
    expect(
      Buffer.from(await transaction(() => readPayload(scope, next.candidateId)))
    ).toEqual(bundle.bundle);
  });

  it("collects an expired unpublished intent and repeats deletion after a real late upload", async () => {
    const neighboring = await published();
    const candidate = await expired();
    expect(await collectPayloads()).toEqual({ removed: 0 });
    expect(Buffer.from(await providerRead(candidate))).toEqual(bundle.bundle);
    await expect(
      transaction(() => adoptPayload(candidate))
    ).rejects.toMatchObject({ reason: "invalid" });
    await floor();
    expect(await collectPayloads()).toEqual({ removed: 1 });
    await expect(providerRead(candidate)).rejects.toMatchObject({
      reason: "missing",
    });
    await directPut(candidate);
    expect(Buffer.from(await providerRead(candidate))).toEqual(bundle.bundle);
    await ready(candidate);
    expect(await collectPayloads()).toEqual({ removed: 1 });
    await expect(providerRead(candidate)).rejects.toMatchObject({
      reason: "missing",
    });
    await expect(
      transaction(() => adoptPayload(candidate))
    ).rejects.toMatchObject({ reason: "invalid" });
    expect(
      Buffer.from(
        await transaction(() => readPayload(scope, neighboring.candidateId))
      )
    ).toEqual(bundle.bundle);
  });

  it("retains replaced bytes while an older backup can reference them", async () => {
    const previous = await published();
    const current = await published();
    await administrator.query(
      "UPDATE zoen_maintenance.payload_backup_inventory SET oldest_backup_start=clock_timestamp()-interval '1 day',observed_at=clock_timestamp()"
    );
    expect(await collectPayloads()).toEqual({ removed: 0 });
    expect(Buffer.from(await providerRead(previous))).toEqual(bundle.bundle);
    await floor();
    expect(await collectPayloads()).toEqual({ removed: 1 });
    await expect(providerRead(previous)).rejects.toMatchObject({
      reason: "missing",
    });
    expect(
      Buffer.from(
        await transaction(() => readPayload(scope, current.candidateId))
      )
    ).toEqual(bundle.bundle);
  });

  it("quarantines restored pending coordinates until retained backups follow their discovery", async () => {
    const candidate = await expired();
    // A newer backup can contain the later adopted pointer even though the
    // restored row is pending and its original write window has expired.
    await administrator.query(
      "UPDATE zoen_maintenance.payload_backup_inventory SET oldest_backup_start=clock_timestamp()-interval '30 seconds',observed_at=clock_timestamp()"
    );
    expect(await collectPayloads()).toEqual({ removed: 0 });
    expect(await collectPayloads()).toEqual({ removed: 0 });
    expect(Buffer.from(await providerRead(candidate))).toEqual(bundle.bundle);
    const rows = await query(
      sql`SELECT state,retired_at>write_until AS quarantined FROM payload_object WHERE id=${candidate.candidateId}`
    );
    expect(rows).toEqual([{ state: "deleting", quarantined: true }]);
    await expect(
      transaction(() => adoptPayload(candidate))
    ).rejects.toMatchObject({ reason: "invalid" });
    await floor();
    expect(await collectPayloads()).toEqual({ removed: 1 });
    await expect(providerRead(candidate)).rejects.toMatchObject({
      reason: "missing",
    });
  });

  it("keeps an unknown DELETE acknowledgement fenced until an actual retry confirms absence", async () => {
    const neighboring = await published();
    const candidate = await expired();
    expect(await collectPayloads()).toEqual({ removed: 0 });
    await floor();
    await using fault = await deletionFault(candidate, "lost-ack");
    await expect(collectPayloads()).rejects.toBeInstanceOf(AggregateError);
    const [row] = await query(
      sql`SELECT state,available_at>clock_timestamp() AS delayed FROM payload_object WHERE id=${candidate.candidateId}`
    );
    expect(row).toEqual({ state: "deleting", delayed: true });
    expect(fault.observations).toContainEqual({
      method: "DELETE",
      path: fault.key,
      status: 204,
    });
    vi.unstubAllEnvs();
    await expect(providerRead(candidate)).rejects.toMatchObject({
      reason: "missing",
    });
    await ready(candidate);
    expect(await collectPayloads()).toEqual({ removed: 1 });
    expect(
      Buffer.from(
        await transaction(() => readPayload(scope, neighboring.candidateId))
      )
    ).toEqual(bundle.bundle);
  });

  it("refuses to acknowledge deletion when a real late PUT makes the follow-up GET positive", async () => {
    const neighboring = await published();
    const candidate = await expired();
    expect(await collectPayloads()).toEqual({ removed: 0 });
    await floor();
    await using fault = await deletionFault(candidate, "late-put");
    await expect(collectPayloads()).rejects.toBeInstanceOf(AggregateError);
    const [row] = await query(
      sql`SELECT state,available_at>clock_timestamp() AS delayed FROM payload_object WHERE id=${candidate.candidateId}`
    );
    expect(row).toEqual({ state: "deleting", delayed: true });
    expect(fault.observations).toContainEqual({
      method: "GET",
      path: fault.key,
      status: 200,
    });
    vi.unstubAllEnvs();
    expect(Buffer.from(await providerRead(candidate))).toEqual(bundle.bundle);
    await ready(candidate);
    expect(await collectPayloads()).toEqual({ removed: 1 });
    await expect(providerRead(candidate)).rejects.toMatchObject({
      reason: "missing",
    });
    expect(
      Buffer.from(
        await transaction(() => readPayload(scope, neighboring.candidateId))
      )
    ).toEqual(bundle.bundle);
  });

  it("fences a provider-only key and preserves it until all retained backups follow its discovery", async () => {
    const neighboring = await published();
    const candidate = unregistered();
    await directPut(candidate);
    expect((await discoverPayloadOrphans()).discovered).toBe(1);
    expect(await collectPayloadOrphans()).toEqual({ removed: 0 });
    expect(Buffer.from(await providerRead(candidate))).toEqual(bundle.bundle);
    await expect(
      transaction(() =>
        query(sql`INSERT INTO payload_object(id,workspace_id,owner_generation,owner_user_id,kind,sha256,byte_length,write_until)
      VALUES (${candidate.candidateId},${candidate.workspaceId},${candidate.ownerGeneration},NULL,${candidate.kind},${candidate.sha256},${candidate.byteLength},clock_timestamp()+interval '2 minutes')`)
      )
    ).rejects.toThrow("database operation failed");
    await expect(
      transaction(() =>
        query(sql`DELETE FROM payload_orphan WHERE id=${candidate.candidateId}`)
      )
    ).rejects.toThrow("database operation failed");
    await expect(
      transaction(() =>
        query(
          sql`UPDATE payload_orphan SET discovered_at=clock_timestamp()-interval '1 day' WHERE id=${candidate.candidateId}`
        )
      )
    ).rejects.toThrow("database operation failed");
    await floor();
    expect(await collectPayloadOrphans()).toEqual({ removed: 1 });
    await expect(providerRead(candidate)).rejects.toMatchObject({
      reason: "missing",
    });
    await directPut(candidate);
    await transaction(() =>
      query(
        sql`UPDATE payload_orphan SET available_at=clock_timestamp() WHERE id=${candidate.candidateId}`
      )
    );
    expect(await collectPayloadOrphans()).toEqual({ removed: 1 });
    await expect(providerRead(candidate)).rejects.toMatchObject({
      reason: "missing",
    });
    expect(
      Buffer.from(
        await transaction(() => readPayload(scope, neighboring.candidateId))
      )
    ).toEqual(bundle.bundle);
  });

  it("retains an orphan deletion obligation after a real lost acknowledgement", async () => {
    const candidate = unregistered();
    await directPut(candidate);
    expect((await discoverPayloadOrphans()).discovered).toBe(1);
    await floor();
    await using fault = await deletionFault(candidate, "lost-ack");
    await expect(collectPayloadOrphans()).rejects.toBeInstanceOf(
      AggregateError
    );
    const [row] = await query(
      sql`SELECT deleted_at IS NULL AS pending,available_at>clock_timestamp() AS delayed FROM payload_orphan WHERE id=${candidate.candidateId}`
    );
    expect(row).toEqual({ pending: true, delayed: true });
    expect(fault.observations).toContainEqual({
      method: "DELETE",
      path: fault.key,
      status: 204,
    });
    vi.unstubAllEnvs();
    await expect(providerRead(candidate)).rejects.toMatchObject({
      reason: "missing",
    });
    await transaction(() =>
      query(
        sql`UPDATE payload_orphan SET available_at=clock_timestamp() WHERE id=${candidate.candidateId}`
      )
    );
    expect(await collectPayloadOrphans()).toEqual({ removed: 1 });
  });

  it("advances the actual bounded provider cursor across more than one page without quarantining a canonical head", async () => {
    const neighboring = await published();
    const candidates: PayloadReference[] = [];
    for (let count = 0; count < 101; count++) {
      const candidate = unregistered();
      await directPut(candidate);
      candidates.push(candidate);
    }
    const first = await discoverPayloadOrphans();
    expect(first.scanned).toBe(100);
    const [cursor] = await query(
      sql`SELECT continuation_token FROM payload_inventory_cursor WHERE prefix=${env.ZOEN_PAYLOAD_PREFIX}`
    );
    expect(cursor?.continuation_token).toEqual(expect.any(String));
    const second = await discoverPayloadOrphans();
    expect(first.discovered + second.discovered).toBe(101);
    const [reset] = await query(
      sql`SELECT continuation_token FROM payload_inventory_cursor WHERE prefix=${env.ZOEN_PAYLOAD_PREFIX}`
    );
    expect(reset?.continuation_token).toBeNull();
    expect(await collectPayloadOrphans()).toEqual({ removed: 0 });
    expect(
      await query(
        sql`SELECT id FROM payload_orphan WHERE id=${neighboring.candidateId}`
      )
    ).toHaveLength(0);
    expect(
      Buffer.from(
        await transaction(() => readPayload(scope, neighboring.candidateId))
      )
    ).toEqual(bundle.bundle);
    expect(candidates).toHaveLength(101);
  });

  it("preserves both orphan fences when the runtime role creates shadow temporary tables", async () => {
    const registered = await published();
    const key = payloadObjectKey(env.ZOEN_PAYLOAD_PREFIX, registered);
    await transaction(async () => {
      await query(
        sql`CREATE TEMP TABLE payload_object(id uuid) ON COMMIT DROP`
      );
      await expect(
        transaction(() =>
          query(
            sql`INSERT INTO public.payload_orphan(id,object_key) VALUES (${registered.candidateId},${key})`
          )
        )
      ).rejects.toThrow("database operation failed");
    });
    const orphan = unregistered();
    await directPut(orphan);
    expect((await discoverPayloadOrphans()).discovered).toBe(1);
    await transaction(async () => {
      await query(
        sql`CREATE TEMP TABLE payload_orphan(id uuid) ON COMMIT DROP`
      );
      await expect(
        transaction(() =>
          query(sql`INSERT INTO public.payload_object(id,workspace_id,owner_generation,owner_user_id,kind,sha256,byte_length,write_until)
        VALUES (${orphan.candidateId},${orphan.workspaceId},${orphan.ownerGeneration},NULL,${orphan.kind},${orphan.sha256},${orphan.byteLength},clock_timestamp()+interval '2 minutes')`)
        )
      ).rejects.toThrow("database operation failed");
    });
    expect(Buffer.from(await providerRead(registered))).toEqual(bundle.bundle);
    expect(Buffer.from(await providerRead(orphan))).toEqual(bundle.bundle);
  });

  it("erases exactly the account's private and personal roots while preserving the company's canonical head and another owner", async () => {
    const company = await published();
    const ownPrivate = await expired(privateScope());
    const artifact = unregistered({
      ...privateScope(),
      kind: "private-artifact",
    });
    const foreign = unregistered({
      ...privateScope(),
      ownerUserId: owner().guest.userId,
    });
    const [personalRow] = await query(
      sql`SELECT payload_generation AS generation FROM workspaces WHERE id=${owner().personal.workspaceId}`
    );
    const personal = unregistered({
      ...scope,
      workspaceId: owner().personal.workspaceId,
      ownerGeneration: z.uuid().parse(personalRow?.generation),
    });
    await directPut(artifact);
    await directPut(foreign);
    await directPut(personal);
    const user = await accountIntent();
    await transaction(() =>
      queuePayloadErasure({ kind: "account", ownerUserId: user })
    );
    expect(await drainPayloadErasures()).toEqual({
      completed: 1,
      progressed: 2,
    });
    for (const reference of [ownPrivate, artifact, personal])
      await expect(providerRead(reference)).rejects.toMatchObject({
        reason: "missing",
      });
    expect(Buffer.from(await providerRead(foreign))).toEqual(bundle.bundle);
    expect(
      Buffer.from(
        await transaction(() => readPayload(scope, company.candidateId))
      )
    ).toEqual(bundle.bundle);
    expect(
      await query(
        sql`SELECT l.status FROM account_deletion_ledger l JOIN account_deletion_requests r ON r.id=l.request_id WHERE r.user_id=${user} AND l.surface='private_files'`
      )
    ).toEqual([{ status: "erased" }]);
    await expect(
      transaction(() => registerPayload(privateScope(), bundle.bundle))
    ).rejects.toThrow("database operation failed");
    await expect(
      transaction(() =>
        registerPayload(
          {
            ...scope,
            workspaceId: personal.workspaceId,
            ownerGeneration: personal.ownerGeneration,
          },
          bundle.bundle
        )
      )
    ).rejects.toThrow("database operation failed");
    await expect(
      transaction(() =>
        query(sql`DELETE FROM payload_erasure WHERE owner_user_id=${user}`)
      )
    ).rejects.toThrow("database operation failed");
    await expect(
      transaction(() =>
        query(
          sql`UPDATE payload_erasure SET owner_user_id=${owner().guest.userId} WHERE owner_user_id=${user}`
        )
      )
    ).rejects.toThrow("database operation failed");
    const nextCompany = await published();
    expect(
      Buffer.from(
        await transaction(() => readPayload(scope, nextCompany.candidateId))
      )
    ).toEqual(bundle.bundle);
  });

  it("keeps the file receipt until the namespace's real provider bytes disappear and denies a restored generation afterward", async () => {
    const partition = await transaction(() => memoryNamespace(owner().actor));
    const target = await expired(privateScope(partition.id));
    const neighbor = unregistered(privateScope());
    const artifact = unregistered({
      ...privateScope(partition.id),
      kind: "private-artifact",
      ownerGeneration: randomUUID(),
    });
    await directPut(neighbor);
    await directPut(artifact);
    const root = z.string().min(1).parse(env.ZOEN_SESSION_ARCHIVE_DIR);
    const file = join(root, partition.id, "raw", "eve", "synthetic.txt");
    await mkdir(join(root, partition.id, "raw", "eve"), {
      recursive: true,
      mode: 0o700,
    });
    await writeFile(file, "Synthetic namespace source", { mode: 0o600 });
    await transaction(() =>
      query(
        sql`DELETE FROM workspace_memory_namespace WHERE namespace_id=${partition.id}`
      )
    );
    expect(await drainMemoryErasures()).toEqual({ cleared: 0 });
    expect(await readFile(file, "utf8")).toBe("Synthetic namespace source");
    expect(await drainPayloadErasures()).toEqual({
      completed: 1,
      progressed: 1,
    });
    await expect(providerRead(target)).rejects.toMatchObject({
      reason: "missing",
    });
    expect(Buffer.from(await providerRead(neighbor))).toEqual(bundle.bundle);
    expect(Buffer.from(await providerRead(artifact))).toEqual(bundle.bundle);
    await transaction(() =>
      query(
        sql`UPDATE workspace_memory_erasure SET available_at=clock_timestamp() WHERE namespace_id=${partition.id}`
      )
    );
    expect(await drainMemoryErasures()).toEqual({ cleared: 1 });
    await expect(readFile(file)).rejects.toMatchObject({ code: "ENOENT" });
    expect(
      await query(
        sql`SELECT namespace_id FROM workspace_memory_erasure WHERE namespace_id=${partition.id}`
      )
    ).toEqual([]);
    expect(await transaction(() => isMemoryNamespaceErased(partition.id))).toBe(
      true
    );
    await transaction(() =>
      query(
        sql`INSERT INTO workspace_memory_namespace(namespace_id,workspace_id,user_id) VALUES (${partition.id},${scope.workspaceId},${owner().actor.userId})`
      )
    );
    await expect(
      PrivateMemoryRepository.read(owner().actor)
    ).rejects.toMatchObject({ reason: "conflict" });
    await expect(
      transaction(() =>
        registerPayload(privateScope(partition.id), bundle.bundle)
      )
    ).rejects.toThrow("database operation failed");
  });

  it("waits for every committed writer window instead of claiming absence while an upload is still allowed", async () => {
    const targetScope = privateScope();
    const reference = await transaction(() =>
      registerPayload(targetScope, bundle.bundle)
    );
    await putRegistered(reference, bundle.bundle);
    await namespaceIntent(reference.ownerGeneration);
    expect(await drainPayloadErasures()).toEqual({
      completed: 0,
      progressed: 0,
    });
    expect(
      await query(
        sql`SELECT e.completed_at IS NULL AS pending, e.available_at>=p.write_until AS waits FROM payload_erasure e JOIN payload_object p ON p.owner_user_id=e.owner_user_id AND p.owner_generation::text=e.scope_key WHERE p.id=${reference.candidateId}`
      )
    ).toEqual([{ pending: true, waits: true }]);
    expect(Buffer.from(await providerRead(reference))).toEqual(bundle.bundle);
  });

  it.each(["lost-ack", "late-put"] as const)(
    "keeps privacy erasure pending after actual %s and completes only after a healthy retry",
    async (mode) => {
      const candidate = await expired(privateScope());
      const user = await accountIntent();
      await transaction(() =>
        queuePayloadErasure({ kind: "account", ownerUserId: user })
      );
      await using fault = await deletionFault(candidate, mode);
      await expect(drainPayloadErasures()).rejects.toBeInstanceOf(
        AggregateError
      );
      expect(
        await query(
          sql`SELECT completed_at IS NULL AS pending,continuation_token,available_at>clock_timestamp() AS delayed FROM payload_erasure WHERE owner_user_id=${user} AND scope_key='account'`
        )
      ).toEqual([{ pending: true, continuation_token: null, delayed: true }]);
      expect(
        await query(
          sql`SELECT l.status FROM account_deletion_ledger l JOIN account_deletion_requests r ON r.id=l.request_id WHERE r.user_id=${user} AND l.surface='private_files'`
        )
      ).toEqual([{ status: "pending_external" }]);
      expect(fault.observations).toContainEqual({
        method: "DELETE",
        path: fault.key,
        status: 204,
      });
      expect(
        fault.observations.some(
          (observation) =>
            observation.method === "GET" &&
            observation.path === fault.key &&
            observation.status === 200
        )
      ).toBe(mode === "late-put");
      vi.unstubAllEnvs();
      await readyErasure();
      expect(await drainPayloadErasures()).toEqual({
        completed: 1,
        progressed: 2,
      });
      await expect(providerRead(candidate)).rejects.toMatchObject({
        reason: "missing",
      });
    }
  );

  it("resumes a real privacy cursor across more than 125 keys without deleting a neighboring namespace", async () => {
    const targetScope = privateScope();
    const neighbor = unregistered(privateScope());
    await directPut(neighbor);
    const targets: PayloadReference[] = [];
    for (let count = 0; count < 131; count++) {
      const reference = unregistered(targetScope);
      await directPut(reference);
      targets.push(reference);
    }
    await namespaceIntent(targetScope.ownerGeneration);
    expect(await drainPayloadErasures()).toEqual({
      completed: 0,
      progressed: 5,
    });
    expect(
      await query(
        sql`SELECT completed_at IS NULL AS pending,continuation_token IS NOT NULL AS resumable FROM payload_erasure WHERE owner_user_id=${owner().actor.userId} AND scope_key=${targetScope.ownerGeneration}`
      )
    ).toEqual([{ pending: true, resumable: true }]);
    expect((await drainPayloadErasures()).completed).toBe(1);
    for (const reference of targets)
      await expect(providerRead(reference)).rejects.toMatchObject({
        reason: "missing",
      });
    expect(Buffer.from(await providerRead(neighbor))).toEqual(bundle.bundle);
  });

  it("rejects cleanup without its exact native privacy intent or with a forged owner or personal root", async () => {
    const user = owner().actor.userId;
    const namespace = randomUUID();
    const reference = unregistered(privateScope(namespace));
    await directPut(reference);
    await expect(
      transaction(() =>
        queuePayloadErasure({ kind: "account", ownerUserId: user })
      )
    ).rejects.toThrow("database operation failed");
    await transaction(() =>
      query(
        sql`INSERT INTO workspace_memory_erasure(namespace_id,owner_user_id) VALUES (${namespace},${user})`
      )
    );
    await expect(
      transaction(() =>
        queuePayloadErasure({
          kind: "private-memory",
          ownerUserId: owner().guest.userId,
          namespaceId: namespace,
        })
      )
    ).rejects.toThrow("database operation failed");
    await accountIntent();
    await expect(
      transaction(() =>
        query(
          sql`INSERT INTO payload_erasure(owner_user_id,scope_key,personal_workspace_id) VALUES (${user},'account',${owner().guestPersonal.workspaceId})`
        )
      )
    ).rejects.toThrow("database operation failed");
    expect(
      await query(
        sql`SELECT scope_key FROM payload_erasure WHERE owner_user_id IN (${user},${owner().guest.userId})`
      )
    ).toEqual([]);
    expect(Buffer.from(await providerRead(reference))).toEqual(bundle.bundle);
  });

  it("keeps a restored namespace reader's real lock before admitting cleanup or touching provider bytes", async () => {
    const partition = await transaction(() => memoryNamespace(owner().actor));
    const reference = await expired(privateScope(partition.id));
    await transaction(() =>
      query(
        sql`INSERT INTO workspace_memory_erasure(namespace_id,owner_user_id) VALUES (${partition.id},${owner().actor.userId})`
      )
    );
    await administrator.query("BEGIN");
    try {
      await administrator.query(
        "SELECT namespace_id FROM workspace_memory_namespace WHERE namespace_id=$1 FOR SHARE",
        [partition.id]
      );
      await expect(drainMemoryErasures()).rejects.toBeInstanceOf(
        AggregateError
      );
      expect(
        await query(
          sql`SELECT scope_key FROM payload_erasure WHERE owner_user_id=${owner().actor.userId}`
        )
      ).toEqual([]);
      expect(Buffer.from(await providerRead(reference))).toEqual(bundle.bundle);
    } finally {
      await administrator.query("ROLLBACK");
    }
    await transaction(() =>
      query(
        sql`UPDATE workspace_memory_erasure SET available_at=clock_timestamp() WHERE namespace_id=${partition.id}`
      )
    );
    expect(await drainMemoryErasures()).toEqual({ cleared: 0 });
    expect(await drainPayloadErasures()).toEqual({
      completed: 1,
      progressed: 1,
    });
    await transaction(() =>
      query(
        sql`UPDATE workspace_memory_erasure SET available_at=clock_timestamp() WHERE namespace_id=${partition.id}`
      )
    );
    expect(await drainMemoryErasures()).toEqual({ cleared: 1 });
    await expect(providerRead(reference)).rejects.toMatchObject({
      reason: "missing",
    });
  });
});
