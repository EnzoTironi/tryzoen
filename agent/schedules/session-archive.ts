import { defineSchedule } from "eve/schedules";
import { env } from "@shared/environment";
import { drainSessionSources } from "../../server/memory/session-capture";

let activeDelivery: Promise<void> | undefined;

export default defineSchedule({
  cron: "* * * * *",
  run() {
    // Share overlapping ticks in this process. Database locks isolate replicas.
    return (activeDelivery ??= deliverSources().finally(() => {
      activeDelivery = undefined;
    }));
  },
});

async function deliverSources() {
  const deadline = performance.now() + 45_000;
  const failures: unknown[] = [];
  for (let round = 0; round < 8 && performance.now() < deadline; round++) {
    const results = await Promise.allSettled(
      Array.from({ length: env.ZOEN_MEMORY_INGESTION_CONCURRENCY }, () =>
        drainSessionSources()
      )
    );
    for (const result of results)
      if (result.status === "rejected") failures.push(result.reason);
    if (
      results.every(
        (result) => result.status === "fulfilled" && result.value.stored === 0
      )
    )
      break;
    // The deadline stops new work; an active transaction must finish or roll back.
  }
  if (failures.length)
    throw new AggregateError(
      failures,
      "Session archive schedule has failed batches."
    );
}
