import { sql } from "drizzle-orm";
import { z } from "zod";
import { query, requireDatabaseTransaction, transaction } from "@db/queries";
import { ErasureJournal } from "../accounts/erasure-journal";
import { PayloadErasureScopeSchema } from "../payloads/contract";
import { queuePayloadErasure } from "../payloads/erasure";

const scopeSchema = PayloadErasureScopeSchema.options[1];

/** Capture both live memory and release corpora before their owning cascade.
 * Call only after the membership/organization deletion has been authorized. */
export async function recordMemoryErasureIntents(
  target:
    | {
        readonly kind: "member";
        readonly workspaceId: string;
        readonly ownerUserId: string;
      }
    | { readonly kind: "organization"; readonly organizationId: string }
) {
  requireDatabaseTransaction();
  const predicate =
    target.kind === "member"
      ? sql`n.workspace_id=${target.workspaceId} AND n.user_id=${target.ownerUserId}`
      : sql`w.organization_id=${target.organizationId}`;
  let after = "";
  for (;;) {
    const scopes = z
      .array(scopeSchema)
      .max(25)
      .parse(
        await query(sql`
      WITH namespaces AS (
        SELECT namespace_id,workspace_id,user_id FROM workspace_memory_namespace
        UNION SELECT namespace_id,workspace_id,user_id FROM creator_release_corpora
      ) SELECT 'private-memory' AS kind,n.namespace_id::text AS "namespaceId",n.user_id AS "ownerUserId"
      FROM namespaces n JOIN workspaces w ON w.id=n.workspace_id
      WHERE (${predicate}) AND n.namespace_id::text>${after}
      ORDER BY n.namespace_id LIMIT 25`)
      );
    if (scopes.length === 0) return;
    for (const scope of scopes) {
      await ErasureJournal.appendMemoryNamespace(scope);
      after = scope.namespaceId;
    }
  }
}

/** Replay before application startup; an old SQL restore cannot revive a namespace. */
export async function applyMemoryErasureIntents() {
  let applied = 0;
  for await (const record of ErasureJournal.readMemoryNamespaces()) {
    const scope = {
      kind: record.kind,
      ownerUserId: record.ownerUserId,
      namespaceId: record.namespaceId,
    };
    await transaction(
      async () => {
        for (const owners of [
          await query(
            sql`SELECT user_id FROM workspace_memory_namespace WHERE namespace_id=${scope.namespaceId} FOR UPDATE`
          ),
          await query(
            sql`SELECT user_id FROM creator_release_corpora WHERE namespace_id=${scope.namespaceId} FOR UPDATE`
          ),
          await query(
            sql`SELECT owner_user_id AS user_id FROM workspace_memory_erasure WHERE namespace_id=${scope.namespaceId} FOR UPDATE`
          ),
        ]) {
          if (owners.some((owner) => owner.user_id !== scope.ownerUserId))
            throw new Error("Memory erasure owner mismatch");
        }
        await query(sql`INSERT INTO workspace_memory_erasure(namespace_id,owner_user_id)
        VALUES (${scope.namespaceId},${scope.ownerUserId}) ON CONFLICT(namespace_id) DO NOTHING`);
        await queuePayloadErasure(scope);
        await query(
          sql`DELETE FROM workspace_memory_namespace WHERE namespace_id=${scope.namespaceId} AND user_id=${scope.ownerUserId}`
        );
        await query(
          sql`DELETE FROM creator_release_corpora WHERE namespace_id=${scope.namespaceId} AND user_id=${scope.ownerUserId}`
        );
      },
      { outermost: true }
    );
    applied += 1;
  }
  return { applied };
}
