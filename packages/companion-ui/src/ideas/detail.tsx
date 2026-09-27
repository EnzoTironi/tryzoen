import type { z } from "zod";
import { Text, View } from "react-native";
import { ActionButton } from "../button";
import { pageStyles } from "../page";
import { colors } from "../theme";
import {
  ideaStatusLabels,
  type ideaSchema,
  type ideaFeedbackSchema,
} from "./schema";

export function IdeaDetail({
  idea,
  feedbackOnly,
  pending,
  error,
  onStart,
  onFeedback,
}: {
  readonly idea: z.infer<typeof ideaSchema>;
  readonly feedbackOnly: boolean;
  readonly pending: boolean;
  readonly error?: string;
  readonly onStart: () => void;
  readonly onFeedback: (feedback: z.infer<typeof ideaFeedbackSchema>) => void;
}) {
  return (
    <>
      {!feedbackOnly && (
        <>
          <Text style={pageStyles.copy}>{idea.description}</Text>
          <View style={{ gap: 8 }}>
            <Text style={pageStyles.rowTitle}>Why this fits you</Text>
            <Text style={pageStyles.copy}>{idea.rationale}</Text>
          </View>
          <View style={{ gap: 8 }}>
            <Text style={pageStyles.rowTitle}>The plan</Text>
            <Text style={pageStyles.copy}>{idea.prompt}</Text>
          </View>
          {idea.status !== "suggested" && (
            <Text style={pageStyles.copy}>{ideaStatusLabels[idea.status]}</Text>
          )}
        </>
      )}
      {error && (
        <Text accessibilityRole="alert" style={{ color: colors.danger }}>
          {error}
        </Text>
      )}
      <ActionButton disabled={pending} onPress={onStart}>
        {idea.sessionId
          ? "Open conversation"
          : idea.status === "starting"
            ? "Continue starting"
            : "Let's go"}
      </ActionButton>
      <ActionButton
        quiet
        disabled={pending || idea.feedback === "more"}
        onPress={() => {
          onFeedback("more");
        }}
      >
        {idea.feedback === "more" ? "Preference saved" : "More like this"}
      </ActionButton>
      {idea.feedback === "more" && (
        <Text accessibilityLiveRegion="polite" style={pageStyles.copy}>
          I’ll use this preference when suggesting new ideas.
        </Text>
      )}
      <ActionButton
        quiet
        disabled={pending}
        onPress={() => {
          onFeedback("dismissed");
        }}
      >
        Not interested
      </ActionButton>
      {idea.sessionId && (
        <Text style={pageStyles.copy}>
          Hiding this idea won’t stop its work. Open the conversation to stop or
          continue it.
        </Text>
      )}
    </>
  );
}
