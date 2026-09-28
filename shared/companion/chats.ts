import { chatPageSchema, type ChatData } from "@zoen/companion-ui/chats";
import type { TRPCUntypedClient } from "@trpc/client";
import type { AnyRouter } from "@trpc/server";

export function companionChatData(
  rpc: Pick<TRPCUntypedClient<AnyRouter>, "query" | "mutation">
): ChatData {
  return {
    async list(input) {
      return chatPageSchema.parse(await rpc.query("companion.chats", input));
    },
    async change(input) {
      await rpc.mutation("companion.changeChat", input);
    },
  };
}
