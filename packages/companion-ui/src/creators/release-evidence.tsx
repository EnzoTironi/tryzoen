import { useI18n, Translated } from "./../i18n";

import { useState } from "react";
import { Text, View } from "react-native";
import type { z } from "zod";
import type { creatorReleaseSchema } from "./schema";
import { ActionButton } from "../button";
import { DocumentEditor } from "../document-editor";
import { usePageStyles } from "../page";

export function CreatorReleaseEvidence({
  content,
  evidence,
}: Pick<z.infer<typeof creatorReleaseSchema>, "content"> &
  Partial<Pick<z.infer<typeof creatorReleaseSchema>, "evidence">>) {
  const { t, locale } = useI18n();
  const pageStyles = usePageStyles();
  const [reading, setReading] = useState<{ title: string; text: string }>();
  return (
    <>
      <Text style={pageStyles.rowTitle}>{content.title}</Text>
      <Text style={pageStyles.copy}>{content.description}</Text>
      <ActionButton
        quiet
        onPress={() => {
          setReading({ title: t("Playbook.md"), text: content.playbook });
        }}
      >
        {t("Read selected playbook")}
      </ActionButton>
      {content.examples.map((example) => (
        <ActionButton
          key={example.id}
          quiet
          onPress={() => {
            setReading({
              title: `${example.title}.md`,
              text: `${example.content}\n\n---\n\n${t("Source")}: ${example.source}\n\n${t("Usage rights")}: ${t(example.rights)}`,
            });
          }}
        >
          {t("Read source: {value1}", { value1: example.title })}
        </ActionButton>
      ))}
      {evidence && (
        <Text accessibilityRole="header" style={pageStyles.heading}>
          {t("Reviewed cases")}
        </Text>
      )}
      {evidence?.map((item) => (
        <View key={item.id} style={{ gap: 8 }}>
          <Text style={pageStyles.rowTitle}>{item.evaluation.case.title}</Text>
          <Text style={pageStyles.copy}>
            <Translated
              message="Useful for this case · {value1} · {value2} s"
              values={{
                value1: item.models.map((model) => model.modelId).join(", "),
                value2: (
                  (item.finishedAt - item.startedAt) /
                  1000
                ).toLocaleString(locale, {
                  minimumFractionDigits: 1,
                  maximumFractionDigits: 1,
                }),
              }}
            />
          </Text>
          <ActionButton
            quiet
            onPress={() => {
              setReading({
                title: `${item.evaluation.case.title}.md`,
                text: [
                  t("# Question"),
                  item.question,
                  t("# Criteria set before the run"),
                  item.evaluation.case.criteria,
                  t("# Specialist response"),
                  item.response,
                  t("# Creator review"),
                  item.review.content.notes,
                ].join("\n\n"),
              });
            }}
          >
            {t("Read evaluation: {value1}", {
              value1: item.evaluation.case.title,
            })}
          </ActionButton>
        </View>
      ))}
      {reading && (
        <DocumentEditor
          title={reading.title}
          label={t("Version evidence")}
          description={t(
            "The selected source or evaluation preserved for this version."
          )}
          initialText={reading.text}
          markdown
          readOnly
          maxLength={64000}
          onClose={() => {
            setReading(undefined);
          }}
          onSave={async () => {
            throw new Error(t("Version evidence is read-only."));
          }}
        />
      )}
    </>
  );
}
