import type { CreatorStudioData } from "@zoen/companion-ui";
import {
  creatorDraftListSchema,
  creatorDraftSchema,
} from "@zoen/companion-ui/creators";

export function companionCreatorData(
  rpc: {
    query: (path: string, input?: unknown) => Promise<unknown>;
    mutation: (path: string, input?: unknown) => Promise<unknown>;
  },
  newId: () => string,
  saveFile: (
    content: string,
    options: { filename: string; mediaType: string }
  ) => Promise<void>
): CreatorStudioData {
  return {
    newId,
    async archive(input) {
      return creatorDraftSchema.parse(
        await rpc.mutation("workspaces.creators.archive", input)
      );
    },
    async exportDraft(id) {
      const draft = creatorDraftSchema.parse(
        await rpc.query("workspaces.creators.read", { id })
      );
      await saveFile(
        JSON.stringify(
          { format: "zoen-creator-draft", version: 1, draft },
          null,
          2
        ),
        {
          filename: `zoen-creator-${draft.id}.json`,
          mediaType: "application/json",
        }
      );
    },
    async list() {
      return creatorDraftListSchema.parse(
        await rpc.query("workspaces.creators.list")
      );
    },
    async read(id) {
      return creatorDraftSchema.parse(
        await rpc.query("workspaces.creators.read", { id })
      );
    },
    async save(input) {
      return creatorDraftSchema.parse(
        await rpc.mutation("workspaces.creators.save", input)
      );
    },
  };
}
