import type { FeedData } from "@zoen/companion-ui";
import {
  feedPageSchema,
  feedInstructionsSchema,
} from "@zoen/companion-ui/feed";

export function companionFeedData(rpc: {
  query: (path: string, input?: unknown) => Promise<unknown>;
  mutation: (path: string, input?: unknown) => Promise<unknown>;
}): FeedData {
  return {
    async instructions() {
      return feedInstructionsSchema.parse(
        await rpc.query("companion.feedInstructions")
      );
    },
    async saveInstructions(input) {
      return feedInstructionsSchema.parse(
        await rpc.mutation("companion.saveFeedInstructions", input)
      );
    },
    async list(cursor) {
      return feedPageSchema.parse(
        await rpc.query("companion.feed", { cursor })
      );
    },
    async like(input) {
      await rpc.mutation("companion.likePost", input);
    },
    async remove(id) {
      await rpc.mutation("companion.deletePost", { id });
    },
  };
}
