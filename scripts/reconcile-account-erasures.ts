import { applyAccountDeletionTombstones } from "../server/accounts/deletion";
import { db } from "../db";
try {
  const { applied } = await applyAccountDeletionTombstones();
  console.info("Account erasures reconciled before startup", { applied });
} catch {
  console.error("Account erasure reconciliation failed.");
  process.exitCode = 1;
} finally {
  await db.$client.end();
}
