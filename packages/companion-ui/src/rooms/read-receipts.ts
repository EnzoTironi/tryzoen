import type { z } from "zod";
import type { roomReadReceiptSchema } from "./schema";

/** Native deltas replace a reader's position independently for each thread. */
export function mergeReadReceipts(
  current: z.infer<typeof roomReadReceiptSchema>[],
  updates: z.infer<typeof roomReadReceiptSchema>[],
  reset: boolean
) {
  const positions = new Map<string, z.infer<typeof roomReadReceiptSchema>>();
  for (const receipt of [...(reset ? [] : current), ...updates]) {
    const key = JSON.stringify([receipt.userId, receipt.threadId]);
    positions.delete(key);
    positions.set(key, receipt);
  }
  return [...positions.values()].slice(-1000);
}
