import { query, transaction as withDatabaseTransaction } from "@db/queries";
import { sql } from "drizzle-orm";
import { mapAsync } from "../operations/async";
import { z } from "zod";

import { Mem0 } from "./mem0";
import { env } from "@shared/environment/env";
import { eraseSessionSources } from "./session-files";

/** A DB trigger retains these non-content receipts after an account/workspace is deleted. */
export const drainMemoryErasures = async function () {
  const mem0 = Mem0;
  return await withDatabaseTransaction(async () => {
    const queued = await query(
      sql`SELECT namespace_id AS id FROM workspace_memory_erasure ORDER BY requested_at LIMIT 5 FOR UPDATE SKIP LOCKED`
    );
    const rows = await z.array(z.object({ id: z.uuid() })).parseAsync(queued);
    await mapAsync(
      rows,
      async function ({ id }) {
        if (env.ZOEN_SESSION_ARCHIVE_DIR)
          await eraseSessionSources(env.ZOEN_SESSION_ARCHIVE_DIR, id);
        await mem0.mutate({
          namespace: id,
          action: "clear",
          operation_id: `erasure:${id}`,
        });
        await query(
          sql`DELETE FROM workspace_memory_erasure WHERE namespace_id = ${id}`
        );
      },
      1
    );
    return { cleared: rows.length };
  });
};
