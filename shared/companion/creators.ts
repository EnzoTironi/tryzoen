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
  newId: () => string
): CreatorStudioData {
  return {
    newId,
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
