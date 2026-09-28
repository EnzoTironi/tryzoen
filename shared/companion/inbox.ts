import { inboxPageSchema, type InboxData } from "@zoen/companion-ui/inbox";
import type { TRPCUntypedClient } from "@trpc/client";
import type { AnyRouter } from "@trpc/server";

export function companionInboxData(
  rpc: Pick<TRPCUntypedClient<AnyRouter>, "query">
): InboxData {
  return {
    async list(input) {
      return inboxPageSchema.parse(await rpc.query("companion.inbox", input));
    },
  };
}
