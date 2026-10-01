import { randomUUID } from "node:crypto";
import { sql } from "drizzle-orm";
import { Client } from "pg";
import { expect, test } from "vitest";
import { query, transaction } from "@db/queries";
import { env } from "@shared/environment/env";
import { PrivateMemoryRepository } from "../../server/memory/repository";
import { LearnedMemory } from "../../server/memory/learned";
import { memoryNamespace } from "../../server/memory/namespace";
import { withTimeout } from "../../server/operations/async";
import { workspaceFixture } from "./workspace-fixture";

for (const scope of ["personal", "company"] as const) {
  test(`${scope} retained erasure denies a real cached learned recall before any engine access`, async () => {
    await using fixture = await workspaceFixture();
    const actor = scope === "personal" ? fixture.personal : fixture.actor;
    const scopeKey = `erasure-recall-${randomUUID()}`;
    const operationId = randomUUID();
    const namespace = await transaction(() => memoryNamespace(actor, scopeKey));
    const snapshot = {
      enabled: true,
      results: [
        {
          id: randomUUID(),
          memory: "Synthetic cached fact from a restored generation",
          createdAt: null,
          updatedAt: null,
          relations: [],
        },
      ],
    };
    await query(sql`INSERT INTO workspace_memory_recall(namespace_id, operation_id, snapshot)
      VALUES (${namespace.id}, ${operationId}, ${JSON.stringify(snapshot)}::jsonb)`);
    // A real persisted recall needs no native engine, dependency replacement or mock.
    expect(await LearnedMemory.recall(actor, scopeKey, operationId, "fact")).toEqual(
      snapshot
    );
    const client = new Client({ connectionString: env.DATABASE_URL });
    let connected = false;
    await query(sql`INSERT INTO workspace_memory_erasure(namespace_id, owner_user_id, available_at)
      VALUES (${namespace.id}, ${actor.userId}, now()+interval '1 day')`);
    try {
      await expect(
        LearnedMemory.recall(actor, scopeKey, operationId, "fact")
      ).rejects.toMatchObject({ reason: "stale_recall" });
      await client.connect();
      connected = true;
      await client.query("BEGIN");
      await client.query(
        "SELECT namespace_id FROM workspace_memory_erasure WHERE namespace_id=$1 FOR UPDATE",
        [namespace.id]
      );
      // Mere receipt presence denies access without waiting for its worker's lock.
      await withTimeout(async () => {
        await expect(
          LearnedMemory.recall(actor, scopeKey, operationId, "fact")
        ).rejects.toMatchObject({ reason: "stale_recall" });
        await expect(LearnedMemory.read(actor, undefined, true)).rejects.toMatchObject(
          { reason: "stale_recall" }
        );
        await expect(
          LearnedMemory.history(actor, {
            query: "fact",
            asOf: "2026-10-01T00:00:00.000Z",
          })
        ).rejects.toMatchObject({ reason: "stale_recall" });
        await expect(LearnedMemory.backup(actor)).rejects.toMatchObject({
          reason: "stale_recall",
        });
        await expect(LearnedMemory.recover(actor)).rejects.toMatchObject({
          reason: "stale_recall",
        });
        await expect(
          LearnedMemory.write(actor, {
            action: "remember",
            operationId: randomUUID(),
            text: "Synthetic write must remain unaccepted during erasure",
          })
        ).rejects.toMatchObject({ reason: "stale_recall" });
        await expect(LearnedMemory.setEnabled(actor, false)).rejects.toMatchObject({
          reason: "stale_recall",
        });
        await expect(PrivateMemoryRepository.read(actor)).rejects.toMatchObject({
          reason: "conflict",
        });
      }, 1500);
      const [retained] = await query<{ snapshot: unknown; pending: string | null }>(sql`
        SELECT r.snapshot, n.pending_operation AS pending
        FROM workspace_memory_recall r JOIN workspace_memory_namespace n ON n.namespace_id=r.namespace_id
        WHERE r.namespace_id=${namespace.id} AND r.operation_id=${operationId}`);
      expect(retained).toEqual({ snapshot, pending: null });
    } finally {
      try {
        if (connected) await client.query("ROLLBACK");
      } finally {
        if (connected) await client.end();
        // Retire only this synthetic generation before removing its test receipt.
        await query(sql`DELETE FROM workspace_memory_namespace
          WHERE namespace_id=${namespace.id} AND workspace_id=${actor.workspaceId} AND user_id=${actor.userId}`);
        await query(sql`DELETE FROM workspace_memory_erasure WHERE namespace_id=${namespace.id}`);
      }
    }
    const fresh = await transaction(() => memoryNamespace(actor, scopeKey));
    expect(fresh.id).not.toBe(namespace.id);
    expect(await query(sql`SELECT operation_id FROM workspace_memory_recall
      WHERE namespace_id=${fresh.id}`)).toHaveLength(0);
    await query(sql`DELETE FROM workspace_memory_namespace WHERE namespace_id=${fresh.id}`);
    await query(sql`DELETE FROM workspace_memory_erasure WHERE namespace_id=${fresh.id}`);
  });

  test(`${scope} private facts remain inaccessible during a locked, deferred erasure receipt`, async () => {
    await using fixture = await workspaceFixture();
    const actor = scope === "personal" ? fixture.personal : fixture.actor;
    const claimId = randomUUID();
    const publication = await PrivateMemoryRepository.change(actor, {
      action: "assert",
      operationId: randomUUID(),
      claimId,
      expectedRevision: null,
      body: {
        text: "Synthetic unsourced preference retained only before erasure",
        sources: [],
        relations: [],
        validTime: null,
      },
    });
    expect(publication.applied).toBe(true);
    const [namespace] = await query<{
      id: string;
    }>(sql`SELECT namespace_id AS id
      FROM workspace_memory_namespace WHERE workspace_id=${actor.workspaceId} AND user_id=${actor.userId}`);
    if (!namespace) throw new Error("Expected private namespace");
    const client = new Client({ connectionString: env.DATABASE_URL });
    await query(sql`INSERT INTO workspace_memory_erasure(namespace_id, available_at)
      VALUES (${namespace.id}, now()+interval '1 day')`);
    try {
      await client.connect();
      await client.query("BEGIN");
      await client.query(
        "SELECT namespace_id FROM workspace_memory_erasure WHERE namespace_id=$1 FOR UPDATE",
        [namespace.id]
      );
      // The worker's receipt lock must not delay denial or permit the restored
      // bundle to escape while that erasure is deferred for retry.
      await withTimeout(async () => {
        await expect(PrivateMemoryRepository.read(actor)).rejects.toMatchObject(
          { reason: "conflict" }
        );
        await expect(
          PrivateMemoryRepository.history(actor, claimId)
        ).rejects.toMatchObject({ reason: "conflict" });
        await expect(
          PrivateMemoryRepository.rebuildOperations(actor)
        ).rejects.toMatchObject({ reason: "conflict" });
      }, 1500);
    } finally {
      await client.query("ROLLBACK");
      await client.end();
      await query(
        sql`DELETE FROM workspace_memory_erasure WHERE namespace_id=${namespace.id}`
      );
    }
    expect((await PrivateMemoryRepository.read(actor)).snapshot.revision).toBe(
      publication.receipt.revision
    );
  });
}
