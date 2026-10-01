import { reconcileGroupDepartures } from "../../server/matrix/membership";
import { reconcileMatrixActivity } from "../../server/matrix/activity-reconcile";
import { reconcileMatrixErasures } from "../../server/matrix/erasure-reconcile";
import {
  completeMatrixGroupJoin,
  pendingMatrixGroupJoins,
} from "../../server/matrix/participation";
import {
  mapAsync,
  operationSignal,
  withDeadline,
} from "../../server/operations/async";
import { defineSchedule } from "eve/schedules";
import { withMatrixTransaction } from "../../server/matrix/deadline";
import matrix from "../channels/matrix";
import {
  pendingMatrixEvents,
  publishMatrixAnswer,
} from "../../server/matrix/delivery";
import { reconcileMatrixRooms } from "../../server/matrix/rooms";

let running: Promise<void> | undefined;

export default defineSchedule({
  cron: "* * * * *",
  run({ to, appAuth, waitUntil }) {
    // A repeated wake-up shares this tick, including its deadline and provider work.
    if (!running) {
      const startedAt = Date.now();
      const deadlineMs = startedAt + 30_000;
      running = withDeadline(async () => {
        let remaining = 50;
        const jobs = [
          {
            name: "departures",
            limit: 10,
            run: (limit: number) => reconcileGroupDepartures(deadlineMs, limit),
          },
          {
            name: "erasures",
            limit: 20,
            run: (limit: number) => reconcileMatrixErasures(deadlineMs, limit),
          },
          {
            name: "joins",
            limit: 5,
            run: async (limit: number) => {
              const candidates = await withMatrixTransaction(deadlineMs, () =>
                pendingMatrixGroupJoins(limit)
              );
              let attempted = 0;
              for (const item of candidates.slice(0, limit)) {
                operationSignal().throwIfAborted();
                if (Date.now() >= deadlineMs) break;
                attempted += 1;
                try {
                  // The completion owns a real transaction; no enclosing SQL scope.
                  await completeMatrixGroupJoin(
                    item.bindingId,
                    item.userId,
                    deadlineMs
                  );
                } catch {
                  operationSignal().throwIfAborted();
                  console.warn("Matrix participation remains pending");
                }
              }
              return attempted;
            },
          },
          {
            name: "rooms",
            limit: 5,
            run: (limit: number) => reconcileMatrixRooms(deadlineMs, limit),
          },
          {
            name: "activity",
            limit: 5,
            run: (limit: number) => reconcileMatrixActivity(deadlineMs, limit),
          },
          {
            name: "delivery",
            limit: 25,
            run: async (limit: number) => {
              const events = (
                await withMatrixTransaction(deadlineMs, () =>
                  pendingMatrixEvents(limit)
                )
              ).slice(0, limit);
              let attempted = 0;
              await mapAsync(
                events,
                async (event) => {
                  operationSignal().throwIfAborted();
                  if (Date.now() >= deadlineMs) return;
                  attempted += 1;
                  try {
                    if (event.state === "answer_ready")
                      await publishMatrixAnswer(event.eventId);
                    else
                      await to(matrix, { eventId: event.eventId }).send(
                        "Resume accepted Matrix event",
                        { auth: appAuth }
                      );
                  } catch {
                    operationSignal().throwIfAborted();
                    console.warn("Matrix delivery will be retried", {
                      eventId: event.eventId,
                    });
                  }
                },
                2
              );
              return attempted;
            },
          },
        ];
        // Rotate the first class by minute, so a slow provider cannot always put
        // the same durable backlog last. No second scheduler or cursor authority.
        const first = Math.floor(startedAt / 60_000) % jobs.length;
        for (const job of [...jobs.slice(first), ...jobs.slice(0, first)]) {
          operationSignal().throwIfAborted();
          if (remaining === 0 || Date.now() >= deadlineMs) break;
          const limit = Math.min(job.limit, remaining);
          try {
            const attempted = await job.run(limit);
            operationSignal().throwIfAborted();
            if (
              !Number.isInteger(attempted) ||
              attempted < 0 ||
              attempted > limit
            )
              throw new Error(
                "Matrix reconciliation exceeded its item budget."
              );
            remaining -= attempted;
          } catch {
            operationSignal().throwIfAborted();
            // Failed work may already have attempted its whole allocation.
            // Reserve it conservatively rather than freeing another provider slot.
            remaining -= limit;
            console.warn("Matrix reconciliation will be retried", {
              kind: job.name,
            });
          }
        }
      }, deadlineMs).finally(() => {
        running = undefined;
      });
    }
    waitUntil(running);
  },
});
