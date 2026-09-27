import type { Client } from "eve/client";
import { useState } from "react";
import { Text, View } from "react-native";
import { CompanionPage, pageStyles } from "./page";
import { ActionButton } from "./button";
import { MessagePart } from "./conversation";
import { useSessionAgent } from "./session/use-session-agent";

export function ConversationReview({
  client,
  sessionId,
  approvals = false,
}: {
  readonly client: Client;
  readonly sessionId: string;
  readonly approvals?: boolean;
}) {
  const agent = useSessionAgent(sessionId, client);
  const [error, setError] = useState<string>();
  const parts = agent.data.messages.flatMap((message) =>
    message.parts.filter(
      (part) =>
        part.type === "dynamic-tool" &&
        (!approvals ||
          part.toolMetadata?.eve?.inputRequest?.kind === "tool-approval")
    )
  );
  // oxlint-disable-next-line unicorn/no-array-reverse -- Reverse a fresh copy for the ES2022 native target.
  const newestFirst = [...parts].reverse();
  return (
    <CompanionPage
      title={approvals ? "Approval history" : "Conversation activity"}
      loading={agent.status === "resuming"}
      error={error ?? agent.error?.message}
      onRetry={() => {
        setError(undefined);
        void agent.resume().catch(() => {
          setError("Activity couldn’t be loaded. Try again.");
        });
      }}
    >
      <Text style={pageStyles.copy}>
        This conversation · most recent activity first
      </Text>
      {newestFirst.map((part, index) => (
        <View
          key={part.type === "dynamic-tool" ? part.toolCallId : index}
          style={pageStyles.section}
        >
          <MessagePart
            part={part}
            isUser={false}
            canRespond={agent.status === "ready" || agent.status === "error"}
            onRespond={agent.respond}
          />
        </View>
      ))}
      {!parts.length && agent.status !== "resuming" && (
        <Text style={[pageStyles.copy, pageStyles.section]}>
          {approvals
            ? "No approvals in the loaded history."
            : "No tool activity in the loaded history."}
        </Text>
      )}
      {agent.hasOlder && (
        <View style={pageStyles.section}>
          <ActionButton
            quiet
            disabled={agent.isLoadingOlder}
            onPress={() => {
              setError(undefined);
              void agent.loadOlder().catch(() => {
                setError("Earlier activity couldn’t be loaded. Try again.");
              });
            }}
          >
            {agent.isLoadingOlder ? "Loading…" : "Load earlier activity"}
          </ActionButton>
        </View>
      )}
    </CompanionPage>
  );
}
