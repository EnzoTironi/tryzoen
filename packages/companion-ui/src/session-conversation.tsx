import { useMemo, useState } from "react";
import { useConversationDraft } from "./session/draft";
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
  const { draft, saveDraft } = useConversationDraft(
    cacheScope,
    sessionId,
    initialDraft
  );
  const agent = useSessionAgent(sessionId, client, cacheScope);
  const feedback = useMessageReactions(reactions, cacheScope, sessionId);
  const messages = useMemo(
    () => visibleConversationMessages(agent.data.messages, agent.events),
    [agent.data.messages, agent.events]
  );
  const [actionError, setActionError] = useState<string>();
  return (
    <Conversation
      key={sessionId}
      messages={messages}
      delivery={agent.delivery}
      initialDraft={draft}
      onDraftChange={saveDraft}
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
      onSend={agent.send}
      onRetrySend={agent.retrySend}
      onRemoveSend={agent.removeSend}
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
