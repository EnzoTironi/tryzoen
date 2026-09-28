import { useRef, useState } from "react";
import { Text, TextInput } from "react-native";
import { useMutation } from "@tanstack/react-query";
import type { z } from "zod";
import { ActionButton } from "../button";
import { CompanionSheet } from "../sheet";
import { pageStyles } from "../page";
import type { creatorDraftSchema } from "./schema";
import type { CreatorStudioData } from "./studio";

export function CreatorPreviewRequest({
  draft,
  data,
  disabled,
  onRefresh,
}: {
  readonly draft: z.infer<typeof creatorDraftSchema>;
  readonly data: CreatorStudioData;
  readonly disabled: boolean;
  readonly onRefresh: () => Promise<unknown>;
}) {
  const [selectedCase, setSelectedCase] = useState<string>();
  const [choosing, setChoosing] = useState(false);
  const [question, setQuestion] = useState("");
  const requestId = useRef<string | undefined>(undefined);
  const mutation = useMutation({
    mutationFn: () => {
      requestId.current ??= data.newId();
      return data.preview({
        id: requestId.current,
        draftId: draft.id,
        revision: draft.revision,
        question,
        ...(selectedCase && draft.evaluation
          ? {
              caseRef: {
                id: selectedCase,
                revision: draft.evaluation.revision,
              },
            }
          : {}),
      });
    },
    onSuccess: () => {
      setQuestion("");
      setSelectedCase(undefined);
      requestId.current = undefined;
    },
    onSettled: () => {
      void onRefresh();
    },
  });
  return (
    <>
      {(draft.evaluation?.cases.length ?? 0) > 0 && (
        <ActionButton
          quiet
          disabled={mutation.isPending}
          onPress={() => {
            setChoosing(true);
          }}
        >
          Choose evaluation case
        </ActionButton>
      )}
      {selectedCase && (
        <>
          <Text style={pageStyles.copy}>
            The saved criteria stay hidden from the specialist and cannot change
            for this run.
          </Text>
          <ActionButton
            quiet
            disabled={mutation.isPending}
            onPress={() => {
              setSelectedCase(undefined);
              setQuestion("");
              requestId.current = undefined;
            }}
          >
            Write a different question
          </ActionButton>
        </>
      )}
      <TextInput
        accessibilityLabel="Preview question"
        multiline
        maxLength={4000}
        value={question}
        editable={!mutation.isPending && !selectedCase}
        onChangeText={(value) => {
          setQuestion(value);
          requestId.current = undefined;
        }}
        placeholder="What should this specialist help with?"
        style={[pageStyles.field, { minHeight: 120 }]}
      />
      <ActionButton
        disabled={!question.trim() || mutation.isPending || disabled}
        onPress={() => {
          mutation.mutate();
        }}
      >
        {mutation.isPending
          ? "Starting preview…"
          : selectedCase
            ? "Run evaluation case"
            : "Run private preview"}
      </ActionButton>
      {mutation.error && (
        <Text accessibilityRole="alert" style={pageStyles.copy}>
          {mutation.error.message} Any accepted request will appear below.
        </Text>
      )}
      {choosing && (
        <CompanionSheet
          title="Choose evaluation case"
          onClose={() => {
            setChoosing(false);
          }}
        >
          <Text style={pageStyles.copy}>
            Choose a saved question with criteria defined before the response.
          </Text>
          {draft.evaluation?.cases.map((item) => (
            <ActionButton
              key={item.id}
              quiet
              onPress={() => {
                setSelectedCase(item.id);
                setQuestion(item.question);
                requestId.current = undefined;
                setChoosing(false);
              }}
            >{`Evaluate: ${item.title}`}</ActionButton>
          ))}
        </CompanionSheet>
      )}
    </>
  );
}
