import { mapAsync } from "../../server/operations/async";
import { defineSchedule } from "eve/schedules";
import matrix from "../channels/matrix";
import {
  pendingMatrixEvents,
  publishMatrixAnswer,
} from "../../server/matrix/delivery";
import { reconcileMatrixRooms } from "../../server/matrix/rooms";

export default defineSchedule({
  cron: "* * * * *",
  run({ to, appAuth, waitUntil }) {
    waitUntil(
      (async function () {
        await reconcileMatrixRooms();
        const events = await pendingMatrixEvents();
        await mapAsync(
          events,
          async (event) => {
            try {
              if (event.state === "answer_ready")
                await publishMatrixAnswer(event.eventId);
              else
                await to(matrix, { eventId: event.eventId }).send(
                  "Resume accepted Matrix event",
                  { auth: appAuth }
                );
            } catch {
              console.warn("Matrix delivery will be retried", {
                eventId: event.eventId,
              });
            }
          },
          2
        );
      })()
    );
  },
});
