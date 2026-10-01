import { query, transaction } from "@db/queries";
import { sql } from "drizzle-orm";
import type {
  workspaceMemoryErasures,
  workspaceMemoryNamespaces,
} from "@db/schema/learned-memory";
import { FileMemoryError } from "./ai-memory/mutations";
import { env } from "@shared/environment/env";
import { eraseSessionSources } from "./session-files";

/** One receipt commits independently; a failed filesystem operation keeps its obligation. */
async function eraseNextReceipt() {
  return transaction(
    async () => {
      const [receipt] = await query<
        Pick<
          typeof workspaceMemoryErasures.$inferSelect,
          "namespaceId" | "ownerUserId" | "erasureFailures"
        >
      >(sql`SELECT namespace_id AS "namespaceId", owner_user_id AS "ownerUserId", erasure_failures AS "erasureFailures"
      FROM workspace_memory_erasure WHERE available_at <= statement_timestamp()
      ORDER BY available_at, requested_at, namespace_id LIMIT 1 FOR UPDATE SKIP LOCKED`);
      if (!receipt) return null;
      const { namespaceId, ownerUserId } = receipt;
      try {
        // Keep the receipt lock if any DB acknowledgement rolls back to this savepoint.
        await transaction(async () => {
          if (!env.ZOEN_SESSION_ARCHIVE_DIR)
            throw new FileMemoryError("unconfigured");
          // Recovery can restore a retired generation beside its erasure receipt.
          // A busy generation must retry; skipping its lock cannot prove absence.
          const [restored] = await query<
            Pick<typeof workspaceMemoryNamespaces.$inferSelect, "userId">
          >(sql`SELECT user_id AS "userId" FROM workspace_memory_namespace
            WHERE namespace_id=${namespaceId} FOR UPDATE NOWAIT`);
          if (restored && (!ownerUserId || restored.userId !== ownerUserId))
            throw new FileMemoryError("unavailable");
          await eraseSessionSources(env.ZOEN_SESSION_ARCHIVE_DIR, namespaceId);
          if (restored) {
            // Cascades retire this generation's Git, recalls and source outbox.
            // Its delete trigger preserves our already-locked receipt.
            const retired = await query(
              sql`DELETE FROM workspace_memory_namespace WHERE namespace_id=${namespaceId}
                AND user_id=${ownerUserId} RETURNING namespace_id`
            );
            if (retired.length !== 1) throw new FileMemoryError("unavailable");
          }
          // Concurrent workers may erase different namespaces of one account.
          // Serialize acknowledgement, then use a fresh statement snapshot below.
          if (ownerUserId)
            await query(
              sql`SELECT id FROM account_deletion_requests WHERE user_id=${ownerUserId} FOR UPDATE`
            );
          await query(
            sql`DELETE FROM workspace_memory_erasure WHERE namespace_id=${namespaceId}`
          );
          if (ownerUserId)
            await query(sql`UPDATE account_deletion_ledger l SET status = 'erased'
          FROM account_deletion_requests r WHERE l.request_id = r.id AND r.user_id = ${ownerUserId}
          AND l.surface = 'file_memory' AND l.status = 'pending_external'
          AND NOT EXISTS (SELECT 1 FROM workspace_memory_erasure WHERE owner_user_id = ${ownerUserId})`);
        });
        return { cleared: 1 };
      } catch (error) {
        const delaySeconds = Math.min(
          3600,
          60 * 2 ** Math.min(receipt.erasureFailures, 6)
        );
        await query(sql`UPDATE workspace_memory_erasure SET erasure_failures=erasure_failures+1,
        last_failed_at=clock_timestamp(), available_at=clock_timestamp()+${delaySeconds} * interval '1 second'
        WHERE namespace_id=${namespaceId}`);
        return { cleared: 0, error };
      }
    },
    { outermost: true }
  );
}

/** A DB trigger retains these non-content receipts after an account/workspace is deleted. */
export async function drainMemoryErasures() {
  let cleared = 0;
  const failures: unknown[] = [];
  for (let count = 0; count < 5; count++) {
    const result = await eraseNextReceipt();
    if (!result) break;
    cleared += result.cleared;
    if ("error" in result) failures.push(result.error);
  }
  if (failures.length)
    throw new AggregateError(
      failures,
      `Memory erasure failed for ${failures.length} partition(s); ${cleared} cleared.`
    );
  return { cleared };
}
