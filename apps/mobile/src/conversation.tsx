import { Client } from "eve/client";
import { SessionConversation, NewConversation } from "@zoen/companion-ui";
import { accountHeaders } from "./auth";
import { apiOrigin } from "./environment";
import { rpc } from "./api";
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
  readonly initialDraft?: string;
  readonly onCreated: (id: string) => void;
}) {
  return sessionId ? (
    <SessionConversation sessionId={sessionId} client={client} />
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
