import { resolveWorkspaceActor } from "../../../../../server/workspaces/session";
import { WorkspaceAccessDenied } from "../../../../../server/workspaces/access";
import {
  exportSessionSources,
  SessionArchiveUnavailable,
} from "../../../../../server/memory/session-export";

export async function GET(
  request: Request,
  context: RouteContext<"/api/conversations/[id]/archive">
) {
  const headers = new Headers(request.headers);
  const space = new URL(request.url).searchParams.get("space");
  if (space) headers.set("x-zoen-workspace", space);
  try {
    const actor = await resolveWorkspaceActor(headers);
    const { id } = await context.params;
    return await exportSessionSources(
      actor,
      id,
      AbortSignal.any([request.signal, AbortSignal.timeout(60_000)])
    );
  } catch (error) {
    const status =
      error instanceof WorkspaceAccessDenied
        ? 403
        : error instanceof SessionArchiveUnavailable
          ? 404
          : 503;
    return Response.json(
      {
        message:
          error instanceof SessionArchiveUnavailable
            ? error.message
            : "Could not export this conversation archive. Try again.",
      },
      { status, headers: { "cache-control": "private, no-store" } }
    );
  }
}
