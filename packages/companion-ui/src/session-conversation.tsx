import { useMemo, useState } from "react";
import type { Client } from "eve/client";
import { Conversation } from "./conversation";
import { useSessionAgent } from "./session/use-session-agent";
import { visibleConversationMessages } from "./session/delivered";

export function SessionConversation({
  sessionId,
  client,
  onCopyText,
  initialDraft,
}: {
  readonly sessionId: string;
  readonly client: Client;
  readonly onCopyText?: (text: string) => Promise<void>;
  readonly initialDraft?: string;
}) {
  const agent = useSessionAgent(sessionId, client);
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
      status={agent.status}
      error={actionError ?? agent.error?.message}
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
          ? () => {
              setActionError(undefined);
              void agent.loadOlder().catch(() => {
                setActionError(
                  "Earlier messages couldn’t be loaded. Please try again."
                );
              });
            }
          : undefined
      }
      loadingOlder={agent.isLoadingOlder}
    />
  );
}
