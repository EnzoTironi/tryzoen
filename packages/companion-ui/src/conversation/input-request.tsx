import {
  Check,
  CircleAlert,
  MessageCircle,
  ShieldCheck,
} from "lucide-react-native";
import { useState } from "react";
import { StyleSheet, Text, TextInput, View } from "react-native";
import type { EveDynamicToolPart } from "eve/react";
import type { InputResponse } from "eve/client";
import { ResourceCard } from "../cards/resource";
import { ActionButton } from "../button";
import { colors } from "../theme";
import { useInputResponse } from "./response";

export function InputRequestCard({
  part,
  enabled,
  onRespond,
}: {
  readonly part: EveDynamicToolPart;
  readonly enabled: boolean;
  readonly onRespond: (responses: readonly InputResponse[]) => Promise<void>;
}) {
  const [text, setText] = useState("");
  const [expanded, setExpanded] = useState(false);
  const request = part.toolMetadata?.eve?.inputRequest;
  const submission = useInputResponse(
    enabled &&
      part.state === "approval-requested" &&
      !part.toolMetadata?.eve?.inputResponse,
    onRespond
  );
  if (!request) return null;
  const response = part.toolMetadata.eve.inputResponse ?? submission.response;
  // Workflow questions can retain request metadata after finishing without a
  // durable input.resolved event. Only the native pending state accepts input.
  const waiting = part.state === "approval-requested" && !response;
  const approval = request.kind === "tool-approval";
  const outcome =
    part.state === "output-error"
      ? "The action failed."
      : part.state === "output-denied"
        ? "The action was not allowed."
        : part.state === "output-available" && !part.partial
          ? "Request completed"
          : response || part.state === "approval-responded"
            ? "Response received"
            : "In progress";

  return (
    <ResourceCard
      style={styles.card}
      title={
        waiting
          ? approval
            ? "Your permission is needed"
            : "A question for you"
          : outcome
      }
      icon={
        waiting
          ? approval
            ? ShieldCheck
            : MessageCircle
          : part.state === "output-error" || part.state === "output-denied"
            ? CircleAlert
            : Check
      }
      tint="#4c9984"
    >
      {(waiting || expanded) && (
        <Text selectable style={styles.text}>
          {request.prompt}
        </Text>
      )}
      {!waiting && (
        <>
          {response && (
            <Text selectable style={styles.text}>
              {request.options?.find(
                (option) => option.id === response.optionId
              )?.label ??
                response.text ??
                response.optionId}
            </Text>
          )}
          <ActionButton
            quiet
            onPress={() => {
              setExpanded(!expanded);
            }}
          >
            {expanded ? "Hide request" : "View request"}
          </ActionButton>
        </>
      )}
      {waiting && (
        <>
          <View style={styles.options}>
            {request.options?.map((option) => (
              <ActionButton
                key={option.id}
                quiet={option.style !== "danger"}
                disabled={!enabled || submission.pending}
                onPress={() =>
                  void submission.submit({
                    requestId: request.requestId,
                    optionId: option.id,
                  })
                }
              >
                {option.label}
              </ActionButton>
            ))}
          </View>
          {((request.allowFreeform ?? false) || !request.options?.length) && (
            <View style={styles.request}>
              <TextInput
                accessibilityLabel="Your answer"
                placeholder="Your answer"
                value={text}
                onChangeText={setText}
                editable={enabled && !submission.pending}
                multiline
                textAlignVertical="top"
                style={styles.answer}
              />
              <ActionButton
                disabled={!enabled || submission.pending || !text.trim()}
                onPress={() =>
                  void submission.submit({
                    requestId: request.requestId,
                    text: text.trim(),
                  })
                }
              >
                Send answer
              </ActionButton>
            </View>
          )}
        </>
      )}
      {submission.failed && (
        <Text accessibilityRole="alert" style={styles.error}>
          Your answer wasn’t accepted. Please try again.
        </Text>
      )}
    </ResourceCard>
  );
}

const styles = StyleSheet.create({
  card: { width: 600 },
  text: { fontSize: 16, lineHeight: 25, color: colors.ink },
  options: { flexDirection: "row", flexWrap: "wrap", gap: 8 },
  request: { gap: 12, paddingVertical: 8 },
  answer: {
    minHeight: 88,
    maxHeight: 240,
    borderWidth: 1,
    borderColor: colors.line,
    borderRadius: 14,
    padding: 12,
    fontSize: 16,
    lineHeight: 24,
    color: colors.ink,
  },
  error: { color: colors.danger, fontSize: 13, lineHeight: 21 },
});
