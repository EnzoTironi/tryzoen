import { withSignal } from "../../../../../server/operations/async";
import { WorkspaceAccessDenied } from "../../../../../server/workspaces/access";
import { resolveWorkspaceActor } from "../../../../../server/workspaces/session";
import {
  LearnedMemory,
  LearnedMemoryError,
} from "../../../../../server/memory/learned";
import { FileMemoryError } from "../../../../../server/memory/ai-memory/mutations";

export async function GET(request: Request) {
  const headers = new Headers(request.headers);
  const space = new URL(request.url).searchParams.get("space");
  if (space) headers.set("x-zoen-workspace", space);
  return withSignal(request.signal, async () => {
    try {
      const archive = await LearnedMemory.backup(
        await resolveWorkspaceActor(headers)
      );
      return new Response(archive, {
        headers: {
          "content-type": "application/zip",
          "content-disposition":
            'attachment; filename="zoen-learned-memory.zip"',
          "cache-control": "private, no-store",
          "x-content-type-options": "nosniff",
        },
      });
    } catch (error) {
      if (
        !(
          error instanceof WorkspaceAccessDenied ||
          error instanceof LearnedMemoryError ||
          error instanceof FileMemoryError
        )
      )
        throw error;
      let status = 503;
      if (error instanceof WorkspaceAccessDenied) status = 403;
      else if (error.reason === "stale_recall") status = 409;
      else if (error.reason === "not_found") status = 404;
      return new Response(null, {
        status,
        headers: { "cache-control": "private, no-store" },
      });
    }
  });
}
