import {
  messageReactionSchema,
  reactionPageSchema,
  type ReactionData,
} from "@zoen/companion-ui/reactions";
import type { TRPCUntypedClient } from "@trpc/client";
import type { AnyRouter } from "@trpc/server";

export function companionReactionData(
  rpc: Pick<TRPCUntypedClient<AnyRouter>, "query" | "mutation">
): ReactionData {
  return {
    async read(input) {
      return reactionPageSchema.parse(
        await rpc.query("companion.reactions", input)
      );
    },
    async set(input) {
      return messageReactionSchema.parse(
        await rpc.mutation("companion.setReaction", input)
      );
    },
  };
}
