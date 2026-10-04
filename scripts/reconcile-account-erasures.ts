import { applyAccountDeletionTombstones } from "../server/accounts/deletion";
import { applyMemoryErasureIntents } from "../server/memory/erasure-intents";
import { db } from "../db";
try {
  const { applied } = await applyAccountDeletionTombstones();
  const { applied: memoryApplied } = await applyMemoryErasureIntents();
  console.info("Erasures reconciled before startup", {
    applied,
    memoryApplied,
  });
} catch {
  console.error("Account erasure reconciliation failed.");
  process.exitCode = 1;
} finally {
  await db.$client.end();
}
