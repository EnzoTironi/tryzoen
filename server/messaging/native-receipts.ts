import { sql } from "drizzle-orm";
import { query, transaction } from "@db/queries";
import type { nativeDeliveryReceipts } from "@db/schema";

type Receipt = typeof nativeDeliveryReceipts.$inferSelect;

export async function readNativeReceipt(workspaceId: string, inputId: string) {
  const rows = await query<Pick<Receipt, "sessionId" | "digest">>(sql`
    SELECT session_id AS "sessionId", digest FROM native_delivery_receipts
    WHERE workspace_id = ${workspaceId} AND input_id = ${inputId}`);
  return rows[0];
}

export async function recordNativeReceipt(receipt: Receipt) {
  const rows = await query(sql`
    INSERT INTO native_delivery_receipts(workspace_id, input_id, session_id, digest)
    VALUES (${receipt.workspaceId}, ${receipt.inputId}, ${receipt.sessionId}, ${receipt.digest})
    ON CONFLICT (workspace_id, input_id) DO UPDATE SET digest = EXCLUDED.digest
    WHERE native_delivery_receipts.digest = EXCLUDED.digest
      AND native_delivery_receipts.session_id = EXCLUDED.session_id
    RETURNING input_id`);
  if (!rows.length) throw new Error("Conflicting native delivery receipt");
}

/** Serialize only transport handoff; Eve still owns the session and turn queue. */
export function withNativeDeliveryLock<Value>(
  address: string,
  run: () => Promise<Value>
) {
  return transaction(async () => {
    await query(
      sql`SELECT pg_advisory_xact_lock(hashtextextended(${address}, 4218))`
    );
    return run();
  });
}
