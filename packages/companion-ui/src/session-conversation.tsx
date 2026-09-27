import { useState } from "react";
import type { Client } from "eve/client";
import { Conversation } from "./conversation";
import { useSessionAgent } from "./session/use-session-agent";

export function SessionConversation({
  sessionId,
  client,
}: {
  readonly sessionId: string;
  readonly client: Client;
}) {
  const agent = useSessionAgent(sessionId, client);
  const [actionError, setActionError] = useState<string>();
  const busy = agent.status === "streaming" || agent.status === "submitted";
  return (
    <Conversation
      key={sessionId}
      messages={agent.data.messages}
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
