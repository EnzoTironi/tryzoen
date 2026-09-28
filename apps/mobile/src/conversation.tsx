import { Client } from "eve/client";
import { SessionConversation, NewConversation } from "@zoen/companion-ui";
import { accountHeaders } from "./auth";
import { apiOrigin } from "./environment";
import { rpc } from "./api";
import { setStringAsync } from "expo-clipboard";
import type { ConversationDraft } from "@zoen/companion-ui/messages";
export const client = new Client({
  host: apiOrigin,
  headers: accountHeaders,
  redirect: "error",
});
export function MobileConversation({
  sessionId,
  initialDraft,
  onCreated,
}: {
  readonly sessionId?: string;
  readonly initialDraft?: ConversationDraft;
  readonly onCreated: (id: string, draft?: ConversationDraft) => void;
}) {
  return sessionId ? (
    <SessionConversation
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
