import { withSignal, withTimeout } from "../../../server/operations/async";
import { readBody } from "../../../server/http/body";
import { jsonString } from "@shared/validation";
import { isSameOrigin } from "../../../web/trpc/same-origin";
import { resolveWorkspaceActor } from "../../../server/workspaces/session";
import {
  ClientBatchSchema,
  ingestClientTelemetry,
} from "../../../server/observability/events";

export async function POST(request: Request) {
  if (!request.headers.has("origin") || !isSameOrigin(request) || !request.body)
    return new Response(null, { status: 403 });
  try {
    return await withSignal(request.signal, () =>
      withTimeout(async () => {
        const actor = await resolveWorkspaceActor(request.headers);
        const bytes = await readBody(request.body, 1_100_000);
        const batch = jsonString(ClientBatchSchema).parse(
          bytes.toString("utf8")
        );
        await ingestClientTelemetry(actor, batch);
        return new Response(null, { status: 204 });
      }, 5_000)
    );
  } catch {
    return new Response(null, { status: 400 });
  }
}
