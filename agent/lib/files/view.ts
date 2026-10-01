import type { DynamicResolveContext } from "eve/tools";
import { z } from "zod";
import {
  GitRevisionSchema,
  WorkspacePathSchema,
} from "@zoen/companion-ui/workspace-files";
import { workspaceActorFromPrincipal } from "../../../server/workspaces/access";
import { invokeWorkspaceTool } from "../../../server/tools/workspace";

const revisionSchema = GitRevisionSchema.nullable();
const listingSchema = z.object({
  revision: revisionSchema,
  files: z.array(WorkspacePathSchema).max(1_000),
});
const pageSchema = z.object({
  revision: revisionSchema,
  exists: z.boolean(),
  path: WorkspacePathSchema,
  content: z.string().max(12_000),
  nextOffset: z.number().int().min(1).max(262_144).nullable(),
});

function relativePath(path: string) {
  if (!path.startsWith("/workspace/"))
    throw new Error("Invalid workspace path");
  return WorkspacePathSchema.parse(path.slice("/workspace/".length));
}

/** Trusted runtime binding only. Never expose context construction to a file caller.
 * This projects published workspace files, not host files or other domain stores.
 * A view fails on publication changes; create a fresh view to restart.
 */
export function workspaceFileView(
  context: Pick<DynamicResolveContext, "session">
) {
  const principal = structuredClone(
    context.session.auth.current ?? context.session.auth.initiator ?? undefined
  );
  let revision: string | null | undefined;
  function checkRevision(current: string | null) {
    if (revision !== undefined && current !== revision)
      throw new Error("Workspace revision changed; reopen the view");
    revision = current;
  }
  async function invoke(
    path: "workspace_files_list" | "workspace_files_read",
    args: Parameters<typeof invokeWorkspaceTool>[1]["args"]
  ) {
    const actor = await workspaceActorFromPrincipal(principal);
    return invokeWorkspaceTool(actor, { path, args });
  }
  return {
    async list(offset = 0) {
      z.number().int().min(0).max(1_000).parse(offset);
      const listing = listingSchema.parse(
        await invoke("workspace_files_list", {})
      );
      checkRevision(listing.revision);
      const entries = listing.files
        .slice(offset, offset + 100)
        .map((path) => `/workspace/${path}`);
      return {
        revision: listing.revision,
        entries,
        nextOffset:
          offset + entries.length < listing.files.length
            ? offset + entries.length
            : null,
      };
    },
    async read(path: string) {
      const relative = relativePath(path);
      let offset = 0;
      let content = "";
      for (;;) {
        const page = pageSchema.parse(
          await invoke("workspace_files_read", { path: relative, offset })
        );
        checkRevision(page.revision);
        if (page.path !== relative)
          throw new Error("Workspace file response path mismatch");
        if (!page.exists) throw new Error("Workspace file not found");
        content += page.content;
        if (Buffer.byteLength(content, "utf8") > 262_144)
          throw new Error("Workspace file exceeds byte limit");
        if (page.nextOffset === null)
          return { revision: page.revision, content };
        if (
          page.nextOffset !== offset + page.content.length ||
          page.nextOffset <= offset
        )
          throw new Error("Invalid workspace file pagination");
        offset = page.nextOffset;
      }
    },
  };
}
