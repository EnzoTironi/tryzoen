import { Client } from "eve/client";
import { SessionConversation, NewConversation } from "@zoen/companion-ui";
import { accountHeaders, auth } from "./auth";
import { companionReactionData } from "../../../shared/companion/reactions";
import { apiOrigin } from "./environment";
import { rpc } from "./api";
import { setStringAsync } from "expo-clipboard";
import type { ConversationDraft } from "@zoen/companion-ui/messages";
export const client = new Client({
  host: apiOrigin,
  headers: accountHeaders,
  redirect: "error",
});
const reactions = companionReactionData(rpc);
export function MobileConversation({
  sessionId,
  initialDraft,
  onCreated,
}: {
  readonly sessionId?: string;
  readonly initialDraft?: ConversationDraft;
  readonly onCreated: (id: string, draft?: ConversationDraft) => void;
}) {
  const account = auth.useSession();
  const cacheScope = `${account.data?.user.id ?? "anonymous"}:${account.data?.session.id ?? "signed-out"}`;
  return sessionId ? (
    <SessionConversation
      key={`${cacheScope}:${sessionId}`}
      cacheScope={cacheScope}
      reactions={reactions}
      sessionId={sessionId}
      initialDraft={initialDraft}
      client={client}
      onCopyText={async (text) => {
        await setStringAsync(text);
      }}
    />
  ) : (
    <NewConversation
      client={client}
      initialDraft={initialDraft}
      avatarUri={`${apiOrigin}/marketing/zoen-avatar.webp`}
      save={(id, title) => rpc.mutation("chats.save", { sessionId: id, title })}
      onCreated={onCreated}
    />
  );
}
