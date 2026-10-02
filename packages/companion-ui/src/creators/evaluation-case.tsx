import { useI18n, Translated } from "./../i18n";

import { useState } from "react";
import { Text, TextInput, View } from "react-native";
import { useMutation } from "@tanstack/react-query";
import type { z } from "zod";
import { ActionButton } from "../button";
import { CompanionSheet } from "../sheet";
import { DocumentEditor } from "../document-editor";
import { usePageStyles } from "../page";
import { creatorEvaluationCaseSchema, type creatorDraftSchema } from "./schema";
import type { CreatorStudioData } from "./studio";

export function CreatorEvaluationCase({
  draft,
  initial,
  data,
  onSaved,
  onClose,
}: {
  readonly draft: z.infer<typeof creatorDraftSchema>;
  readonly initial: z.infer<typeof creatorEvaluationCaseSchema>;
  readonly data: Pick<CreatorStudioData, "saveEvaluation">;
  readonly onSaved: (draft: z.infer<typeof creatorDraftSchema>) => void;
  readonly onClose: () => void;
}) {
  const { t, errorText } = useI18n();
  const pageStyles = usePageStyles();
  const [value, setValue] = useState(initial);
  const [editing, setEditing] = useState<"question" | "criteria">();
  const [confirming, setConfirming] = useState<"discard" | "remove">();
  const cases = draft.evaluation?.cases ?? [];
  const existing = cases.some((item) => item.id === initial.id);
  const readOnly = Boolean(draft.archivedAt);
  const save = useMutation({
    mutationFn: (remove: boolean) =>
      data.saveEvaluation({
        draftId: draft.id,
        expectedRevision: draft.evaluation?.revision ?? null,
        cases: remove
          ? cases.filter((item) => item.id !== initial.id)
          : existing
            ? cases.map((item) => (item.id === value.id ? value : item))
            : [...cases, value],
      }),
    onSuccess: (updated) => {
      onSaved(updated);
      onClose();
    },
  });
  const close = () => {
    if (save.isPending) return;
    if (JSON.stringify(value) !== JSON.stringify(initial))
      setConfirming("discard");
    else onClose();
  };
  return (
    <CompanionSheet
      title={existing ? t("Evaluation case") : t("New evaluation case")}
      onClose={close}
    >
      <TextInput
        accessibilityLabel={t("Evaluation case title")}
        placeholder={t("Case title")}
        maxLength={120}
        value={value.title}
        editable={!readOnly && !save.isPending}
        style={pageStyles.field}
        onChangeText={(title) => {
          setValue({ ...value, title });
        }}
      />
      <Text style={pageStyles.copy}>
        {t(
          "Use a fictional situation or material you have permission to use. Include difficult or inappropriate requests as well as ordinary cases."
        )}
      </Text>
      <ActionButton
        quiet
        disabled={save.isPending}
        onPress={() => {
          setEditing("question");
        }}
      >
        {value.question
          ? t("Read or edit test question")
          : t("Write test question")}
      </ActionButton>
      <ActionButton
        quiet
        disabled={save.isPending}
        onPress={() => {
          setEditing("criteria");
        }}
      >
        {value.criteria
          ? t("Read or edit evaluation criteria")
          : t("Write evaluation criteria")}
      </ActionButton>
      <Text style={pageStyles.copy}>
        {t(
          "Criteria stay hidden from the specialist. Saved runs keep their original question and criteria even after you edit or remove this case."
        )}
      </Text>
      {!readOnly && (
        <ActionButton
          disabled={
            save.isPending ||
            !creatorEvaluationCaseSchema.safeParse(value).success
          }
          onPress={() => {
            save.mutate(false);
          }}
        >
          {save.isPending ? t("Saving…") : t("Save evaluation case")}
        </ActionButton>
      )}
      {!readOnly && existing && (
        <ActionButton
          quiet
          disabled={save.isPending}
          onPress={() => {
            setConfirming("remove");
          }}
        >
          {t("Remove case")}
        </ActionButton>
      )}
      {save.error && (
        <Text accessibilityRole="alert" style={pageStyles.copy}>
          <Translated
            message="{value1} Your draft is still here."
            values={{ value1: errorText(save.error.message) }}
          />
        </Text>
      )}
      {confirming && (
        <View style={{ gap: 8 }}>
          <Text style={pageStyles.rowTitle}>
            {confirming === "remove"
              ? t(
                  "Remove this case from future evaluations? Saved runs will remain."
                )
              : t("Discard unsaved changes?")}
          </Text>
          <ActionButton
            quiet
            disabled={save.isPending}
            onPress={() => {
              setConfirming(undefined);
            }}
          >
            {t("Keep editing")}
          </ActionButton>
          <ActionButton
            disabled={save.isPending}
            onPress={() => {
              if (confirming === "remove") save.mutate(true);
              else onClose();
            }}
          >
            {confirming === "remove"
              ? t("Confirm removal")
              : t("Discard changes")}
          </ActionButton>
        </View>
      )}
      {editing && (
        <DocumentEditor
          title={
            editing === "question"
              ? t("Test question")
              : t("Evaluation criteria")
          }
          label={
            editing === "question"
              ? t("Evaluation test question")
              : t("Predeclared evaluation criteria")
          }
          initialText={value[editing]}
          maxLength={4000}
          markdown
          readOnly={readOnly}
          description={t(
            "This edits your case draft. Use Save evaluation case to save the question and criteria together."
          )}
          onSave={async (text) => {
            setValue({ ...value, [editing]: text });
          }}
          onClose={() => {
            setEditing(undefined);
          }}
        />
      )}
    </CompanionSheet>
  );
}
