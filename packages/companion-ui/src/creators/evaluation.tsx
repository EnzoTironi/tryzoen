import { useI18n, Translated } from "./../i18n";

import { useState } from "react";
import { Text, View } from "react-native";
import type { z } from "zod";
import { ActionButton } from "../button";
import { CompanionSheet } from "../sheet";
import { usePageStyles } from "../page";
import type { creatorDraftSchema, creatorEvaluationCaseSchema } from "./schema";
import type { CreatorStudioData } from "./studio";
import { CreatorEvaluationCase } from "./evaluation-case";

export function CreatorEvaluation({
  draft,
  data,
  onChanged,
  onClose,
}: {
  readonly draft: z.infer<typeof creatorDraftSchema>;
  readonly data: CreatorStudioData;
  readonly onChanged: (draft: z.infer<typeof creatorDraftSchema>) => void;
  readonly onClose: () => void;
}) {
  const { t } = useI18n();
  const pageStyles = usePageStyles();
  const [editing, setEditing] = useState<{
    draft: typeof draft;
    value: z.infer<typeof creatorEvaluationCaseSchema>;
  }>();
  const cases = draft.evaluation?.cases ?? [];
  return (
    <CompanionSheet title={t("Evaluation cases")} onClose={onClose}>
      <Text style={pageStyles.copy}>
        {t(
          "Write new situations that are not covered by your teaching examples. Decide what a useful answer must do before running the specialist."
        )}
      </Text>
      <Text style={pageStyles.copy}>
        {t(
          "Cases stay private and separate from the playbook. Only the selected question reaches the specialist; your criteria and other cases stay hidden. Repeated cases help you compare revisions, but do not prove performance on unseen situations."
        )}
      </Text>
      {!draft.archivedAt && (
        <ActionButton
          disabled={cases.length >= 20}
          onPress={() => {
            setEditing({
              draft,
              value: {
                id: data.newId(),
                title: "",
                question: "",
                criteria: "",
              },
            });
          }}
        >
          {t("Add evaluation case")}
        </ActionButton>
      )}
      <Text style={pageStyles.copy}>
        <Translated
          message="{value1} of 20 cases · Run a saved case from Try this specialist."
          values={{ value1: cases.length }}
        />
      </Text>
      {cases.map((item) => (
        <View key={item.id} style={{ gap: 8, paddingVertical: 12 }}>
          <Text style={pageStyles.rowTitle}>{item.title}</Text>
          <Text style={pageStyles.copy}>{item.question}</Text>
          <ActionButton
            quiet
            onPress={() => {
              setEditing({ draft, value: item });
            }}
          >
            {t("{value1} case: {value2}", {
              value1: draft.archivedAt ? t("Read") : t("Edit"),
              value2: item.title,
            })}
          </ActionButton>
        </View>
      ))}
      {editing && (
        <CreatorEvaluationCase
          draft={editing.draft}
          initial={editing.value}
          data={data}
          onSaved={onChanged}
          onClose={() => {
            setEditing(undefined);
          }}
        />
      )}
    </CompanionSheet>
  );
}
