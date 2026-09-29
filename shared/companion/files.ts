import type { DocumentHistoryData } from "@zoen/companion-ui";
import { z } from "zod";
import { workspaceRevisionSchema } from "@zoen/companion-ui/workspace-files";
import { companionFilesSchema } from "./schema";

export function companionDocumentHistory(
  rpc: { query: (path: string, input?: unknown) => Promise<unknown> },
  path: string,
  cacheScope: string
): DocumentHistoryData {
  return {
    cacheKey: ["workspace-document", cacheScope, path],
    async list() {
      const versions = z
        .array(workspaceRevisionSchema)
        .parse(await rpc.query("workspaces.history", { path }));
      return versions.map((version) => ({
        revision: version.revision,
        date: new Date(version.createdAt).toLocaleString(),
        source: version.source,
      }));
    },
    async read(revision) {
      return (
        companionFilesSchema.parse(
          await rpc.query("workspaces.files", { path, revision })
        ).content ?? null
      );
    },
  };
}
