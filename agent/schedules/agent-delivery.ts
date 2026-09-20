import { mapAsync } from "../../server/operations/async";
import { MatrixError } from "../../server/matrix/client";
import { defineSchedule } from "eve/schedules";
import a2a from "../channels/a2a";
import { listPendingProtocolTasks } from "../../server/a2a/delivery";
import { pendingProtocolCancellations } from "../../server/a2a/cancellation";
import { retireMatrixRooms } from "../../server/matrix/retirement";
import {
  pendingMatrixProtocolAnswers,
  publishMatrixProtocolAnswer,
} from "../../server/matrix/network-delivery";

export default defineSchedule({
  cron: "* * * * *",
  run({ to, appAuth, waitUntil }) {
    waitUntil(
      (async function () {
        await mapAsync(
          await pendingProtocolCancellations(),
          async ({ session_id }) => {
            try {
              await to(a2a, { cancelSessionId: session_id }).send(
                "Retire revoked task",
                { auth: appAuth }
              );
            } catch {
              console.warn("A2A cancellation will be retried");
            }
          },
          2
        );
        const tasks = await listPendingProtocolTasks();
        await mapAsync(
          tasks,
          async ({ id }) => {
            try {
              await to(a2a, { taskId: id }).send("Resume accepted task", {
                auth: appAuth,
              });
            } catch {
              console.warn("A2A delivery will be retried", { taskId: id });
            }
          },
          2
        );
        await mapAsync(
          await pendingMatrixProtocolAnswers(),
          async ({ id }) => {
            try {
              await publishMatrixProtocolAnswer(id);
              return;
            } catch {
              console.warn("Matrix result delivery remains pending", {
                taskId: id,
              });
            }
          },
          2
        );
        await Promise.try(async () => retireMatrixRooms()).catch(
          (error: unknown) => {
            if (error instanceof MatrixError) return Promise.resolve();
            throw error;
          }
        );
      })()
    );
  },
});
