import { randomUUID } from "node:crypto";
import { sql } from "drizzle-orm";
import { Client } from "pg";
import { expect, test } from "vitest";
import { query } from "@db/queries";
import { env } from "@shared/environment/env";
import { PrivateMemoryRepository } from "../../server/memory/repository";
import { withDeadline } from "../../server/operations/async";
import { privateMemoryFixture } from "./private-memory-fixture";

for (const scope of ["personal", "company"] as const) {
  test(`${scope} retained erasure denies the real canonical cached recall and every review/recovery boundary`, async () => {
    await using fixture = await privateMemoryFixture();
    const actor = scope === "personal" ? fixture.personal : fixture.actor;
    const claimId = randomUUID();
    const first = await PrivateMemoryRepository.change(actor, {
      action: "assert",
      operationId: randomUUID(),
      claimId,
      expectedRevision: null,
      body: {
        text: "Synthetic cached Cedar preference",
        sources: [],
        relations: [],
        validTime: null,
      },
    });
    const current = await PrivateMemoryRepository.read(actor);
    const namespace = await fixture.namespace(actor);
    const scopeKey = `erasure-recall-${namespace.id}`;
    const operationId = randomUUID();
    const snapshot = await PrivateMemoryRepository.recall(
      actor,
      scopeKey,
      operationId,
      "Cedar"
    );
    expect(snapshot.matches).toHaveLength(1);
    expect(
      await PrivateMemoryRepository.recall(
        actor,
        scopeKey,
        operationId,
        "Cedar"
      )
    ).toEqual(snapshot);
    const archive = await PrivateMemoryRepository.backup(actor);
    const corpus = await PrivateMemoryRepository.backupCorpus(actor);
    const client = new Client({ connectionString: env.DATABASE_URL });
    let connected = false;
    await query(sql`INSERT INTO workspace_memory_erasure(namespace_id,owner_user_id,available_at)
      VALUES (${namespace.id},${actor.userId},now()+interval '1 day')`);
    try {
      await expect(
        PrivateMemoryRepository.recall(actor, scopeKey, operationId, "Cedar")
      ).rejects.toMatchObject({ reason: "conflict" });
      await client.connect();
      connected = true;
      await client.query("BEGIN");
      await client.query(
        "SELECT namespace_id FROM workspace_memory_erasure WHERE namespace_id=$1 FOR UPDATE",
        [namespace.id]
      );
      await withDeadline(async () => {
        const denied = [
          () =>
            PrivateMemoryRepository.recall(
              actor,
              scopeKey,
              operationId,
              "Cedar"
            ),
          () => PrivateMemoryRepository.read(actor),
          () => PrivateMemoryRepository.search(actor, { query: "Cedar" }),
          () => PrivateMemoryRepository.history(actor, claimId),
          () => PrivateMemoryRepository.backup(actor),
          () => PrivateMemoryRepository.backupCorpus(actor),
          () => PrivateMemoryRepository.rebuildOperations(actor),
          () =>
            PrivateMemoryRepository.restore(actor, {
              expectedRevision: first.receipt.revision,
              archive,
            }),
          () =>
            PrivateMemoryRepository.restoreCorpus(actor, {
              expectedRevision: first.receipt.revision,
              archive: corpus,
            }),
          () =>
            PrivateMemoryRepository.setEnabled(actor, {
              operationId: randomUUID(),
              enabled: false,
              expectedPreferenceRevision: current.preferenceRevision,
            }),
          () =>
            PrivateMemoryRepository.change(actor, {
              action: "tombstone",
              operationId: randomUUID(),
              claimId,
              expectedRevision: first.receipt.revision,
            }),
        ];
        for (const run of denied)
          await expect(run()).rejects.toMatchObject({ reason: "conflict" });
      }, Date.now() + 3000);
      const [retained] = await query<{
        snapshot: unknown;
        revision: string;
      }>(sql`SELECT r.snapshot,p.head_sha AS revision
        FROM workspace_memory_recall r JOIN private_memory_repository p ON p.namespace_id=r.namespace_id
        WHERE r.namespace_id=${namespace.id} AND r.operation_id=${operationId}`);
      expect(retained).toEqual({ snapshot, revision: first.receipt.revision });
    } finally {
      if (connected) {
        try {
          await client.query("ROLLBACK");
        } finally {
          await client.end();
        }
      }
    }
    // Only an explicitly retired generation can enroll a different namespace.
    await query(
      sql`DELETE FROM workspace_memory_namespace WHERE namespace_id=${namespace.id}`
    );
    const fresh = await fixture.namespace(actor);
    expect(fresh.id).not.toBe(namespace.id);
    expect((await PrivateMemoryRepository.read(actor)).snapshot.claims).toEqual(
      []
    );
    expect(
      await query(
        sql`SELECT operation_id FROM workspace_memory_recall WHERE namespace_id=${fresh.id}`
      )
    ).toHaveLength(0);
    // The old obligation survives reenrollment and still names the old generation.
    expect(
      await query(
        sql`SELECT namespace_id FROM workspace_memory_erasure WHERE namespace_id=${namespace.id}`
      )
    ).toHaveLength(1);
  });
}
