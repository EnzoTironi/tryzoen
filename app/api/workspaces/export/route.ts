import { withSignal } from "../../../../server/operations/async";
import { WorkspaceAccessDenied } from "../../../../server/workspaces/access";
import { resolveWorkspaceActor } from "../../../../server/workspaces/session";
import { WorkspaceRepository } from "../../../../server/workspaces/repository";

export async function GET(request: Request) {
  const headers = new Headers(request.headers);
  const space = new URL(request.url).searchParams.get("space");
  if (space) headers.set("x-zoen-workspace", space);
  return withSignal(request.signal, async () => {
    try {
      const actor = await resolveWorkspaceActor(headers);
      const stored = await WorkspaceRepository.export(actor);
      if (!stored) return new Response(null, { status: 404 });
      return new Response(Buffer.from(stored.bundle), {
        headers: {
          "content-type": "application/octet-stream",
          "content-disposition": 'attachment; filename="zoen-workspace.bundle"',
          "cache-control": "private, no-store",
          "x-content-type-options": "nosniff",
        },
      });
    } catch (error) {
      if (error instanceof WorkspaceAccessDenied)
        return new Response(null, { status: 403 });
      throw error;
    }
  });
}
