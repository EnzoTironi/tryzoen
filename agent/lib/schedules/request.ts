import { postInternalRequest } from "../internal-request";
import { InternalCallbackRejected } from "../../../server/internal/callback-auth";

export async function postScheduledReport(runId: string) {
  const response = await postInternalRequest("/internal/scheduled-run/report", {
    runId,
  });
  if (!response.ok) throw new InternalCallbackRejected({ status: 503 });
  return undefined;
}
