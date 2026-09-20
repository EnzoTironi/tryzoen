import { withSignal } from "../../../../server/operations/async";
import { WorkspaceRepositoryError } from "../../../../server/workspaces/repository";
import { WorkspaceAccessDenied } from "../../../../server/workspaces/access";
import { resolveWorkspaceActor } from "../../../../server/workspaces/session";
import { WorkspaceRepository } from "../../../../server/workspaces/repository";

export async function GET(request: Request) {
  const url = new URL(request.url);
  const headers = new Headers(request.headers);
  const workspace = url.searchParams.get("space");
  if (workspace) headers.set("x-zoen-workspace", workspace);
  return withSignal(request.signal, async () => {
    try {
      try {
        const actor = await resolveWorkspaceActor(headers);
        const source = await WorkspaceRepository.source(
          actor,
          url.searchParams.get("revision") ?? ""
        );
        return new Response(Buffer.from(source.bytes), {
          headers: {
            "content-type": "application/octet-stream",
            "cache-control": "private, no-store",
            "x-content-type-options": "nosniff",
            "content-disposition": `attachment; filename="document"; filename*=UTF-8''${encodeURIComponent(source.filename)}`,
          },
        });
      } catch (error) {
        if (error instanceof WorkspaceAccessDenied)
          return new Response(null, { status: 403 });
        throw error;
      }
    } catch (error) {
      if (error instanceof WorkspaceRepositoryError)
        return new Response(null, { status: 404 });
      throw error;
    }
  });
}
