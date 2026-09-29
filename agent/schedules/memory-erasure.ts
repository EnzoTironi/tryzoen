import { defineSchedule } from "eve/schedules";
import { drainMemoryErasures } from "../../server/memory/erasure";

let activeErasure: Promise<void> | undefined;

export default defineSchedule({
  cron: "* * * * *",
  run() {
    return (activeErasure ??= erasePartitions().finally(() => {
      activeErasure = undefined;
    }));
  },
});

async function erasePartitions() {
  const deadline = performance.now() + 45_000;
  const failures: unknown[] = [];
  for (let round = 0; round < 8 && performance.now() < deadline; round++) {
    try {
      if ((await drainMemoryErasures()).cleared === 0) break;
    } catch (error) {
      // Failed receipts have their own durable delay. Continue eligible work.
      failures.push(error);
    }
    // Finish an active filesystem operation and its receipt before returning.
  }
  if (failures.length)
    throw new AggregateError(
      failures,
      "Memory erasure schedule has failed partitions."
    );
}
