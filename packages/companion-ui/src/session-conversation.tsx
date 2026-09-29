import { useMemo, useState } from "react";
import type { Client } from "eve/client";
import { Conversation } from "./conversation";
import { useSessionAgent } from "./session/use-session-agent";
import { visibleConversationMessages } from "./session/delivered";
import type { ConversationDraft } from "./session/input";
import { useMessageReactions } from "./reactions/use-message-reactions";
import type { ReactionData } from "./reactions/schema";

export function SessionConversation({
  sessionId,
  client,
  onCopyText,
  initialDraft,
  reactions,
  cacheScope,
}: {
  readonly sessionId: string;
  readonly client: Client;
  readonly onCopyText?: (text: string) => Promise<void>;
  readonly initialDraft?: ConversationDraft;
  readonly reactions: ReactionData;
  readonly cacheScope: string;
}) {
  const agent = useSessionAgent(sessionId, client, cacheScope);
  const feedback = useMessageReactions(reactions, cacheScope, sessionId);
  const messages = useMemo(
    () => visibleConversationMessages(agent.data.messages, agent.events),
    [agent.data.messages, agent.events]
  );
  const [actionError, setActionError] = useState<string>();
  const busy = agent.status === "streaming" || agent.status === "submitted";
  return (
    <Conversation
      key={sessionId}
      messages={messages}
      initialDraft={initialDraft}
      onCopyText={onCopyText}
      onVisibleMessagesChange={feedback.showMessages}
      reactions={
        new Map(
          feedback.query.data?.map((item) => [item.messageId, item.emoji])
        )
      }
      onReact={feedback.setReaction}
      status={agent.status}
      error={
        actionError ??
        agent.error?.message ??
        (feedback.query.isError
          ? "Couldn’t load reactions. Reopen the conversation to try again."
          : undefined)
      }
      onSend={(text) =>
        agent.send(text, busy ? { turnPolicy: "steer" } : undefined)
      }
      onRespond={agent.respond}
      onCancel={() => {
        setActionError(undefined);
        void agent.cancel().catch(() => {
          setActionError("The stop request failed. Please try again.");
        });
      }}
      onLoadOlder={
        agent.hasOlder
          ? async () => {
              setActionError(undefined);
              await agent.loadOlder().catch(() => {
                setActionError(
                  "Earlier messages couldn’t be loaded. Please try again."
                );
              });
            }
          : undefined
      }
      loadingOlder={agent.isLoadingOlder}
      olderError={agent.olderError?.message}
    />
  );
}
