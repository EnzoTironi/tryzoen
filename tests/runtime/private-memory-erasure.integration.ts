import { randomUUID } from "node:crypto";
import { sql } from "drizzle-orm";
import { Client } from "pg";
import { expect, test } from "vitest";
import { query } from "@db/queries";
import { env } from "@shared/environment/env";
import { PrivateMemoryRepository } from "../../server/memory/repository";
import { withTimeout } from "../../server/operations/async";
import { workspaceFixture } from "./workspace-fixture";

for (const scope of ["personal", "company"] as const) {
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
