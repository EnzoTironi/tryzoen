import { defineSchedule } from "eve/schedules";
import {
  collectPayloads,
  collectPayloadOrphans,
  discoverPayloadOrphans,
} from "../../server/payloads/collection";
import { withDeadline } from "../../server/operations/async";
import { drainPayloadErasures } from "../../server/payloads/erasure";

let active: Promise<void> | undefined;

export default defineSchedule({
  cron: "* * * * *",
  run() {
    return (active ??= Promise.try(async () => {
      const failures: unknown[] = [];
      for (const action of [
        drainPayloadErasures,
        discoverPayloadOrphans,
        collectPayloads,
        collectPayloadOrphans,
      ]) {
        try {
          await withDeadline(async () => {
            await action();
          }, Date.now() + 12_000);
        } catch (error) {
          failures.push(error);
        }
      }
      if (failures.length)
        throw new AggregateError(
          failures,
          "Payload maintenance has pending operations"
        );
    }).finally(() => {
      active = undefined;
    }));
  },
});
