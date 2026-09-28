import { query, transaction as withDatabaseTransaction } from "@db/queries";
import { sql } from "drizzle-orm";
import { mapAsync } from "../operations/async";
import { z } from "zod";

import { FileMemoryError } from "./ai-memory/mutations";
import { env } from "@shared/environment/env";
import { eraseSessionSources } from "./session-files";

/** A DB trigger retains these non-content receipts after an account/workspace is deleted. */
export const drainMemoryErasures = async function () {
  return await withDatabaseTransaction(async () => {
    const queued = await query(
      sql`SELECT namespace_id AS id, owner_user_id AS "ownerUserId" FROM workspace_memory_erasure ORDER BY requested_at LIMIT 5 FOR UPDATE SKIP LOCKED`
    );
    const rows = await z
      .array(z.object({ id: z.uuid(), ownerUserId: z.string().nullable() }))
      .parseAsync(queued);
    await mapAsync(
      rows,
      async function ({ id, ownerUserId }) {
        if (!env.ZOEN_SESSION_ARCHIVE_DIR)
          throw new FileMemoryError("unconfigured");
        await eraseSessionSources(env.ZOEN_SESSION_ARCHIVE_DIR, id);
        await query(
          sql`DELETE FROM workspace_memory_erasure WHERE namespace_id = ${id}`
        );
        if (ownerUserId)
          await query(sql`UPDATE account_deletion_ledger l SET status = 'erased'
          FROM account_deletion_requests r WHERE l.request_id = r.id AND r.user_id = ${ownerUserId}
          AND l.surface = 'file_memory' AND l.status = 'pending_external'
          AND NOT EXISTS (SELECT 1 FROM workspace_memory_erasure WHERE owner_user_id = ${ownerUserId})`);
      },
      1
    );
    return { cleared: rows.length };
  });
};
