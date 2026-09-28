import { useState } from "react";
import { Text, View } from "react-native";
import type { z } from "zod";
import type { creatorReleaseSchema } from "./schema";
import { ActionButton } from "../button";
import { DocumentEditor } from "../document-editor";
import { pageStyles } from "../page";

export function CreatorReleaseEvidence({
  content,
  evidence,
}: Pick<z.infer<typeof creatorReleaseSchema>, "content" | "evidence">) {
  const [reading, setReading] = useState<{ title: string; text: string }>();
  return (
    <>
      <Text style={pageStyles.rowTitle}>{content.title}</Text>
      <Text style={pageStyles.copy}>{content.description}</Text>
      <ActionButton
        quiet
        onPress={() => {
          setReading({ title: "Playbook.md", text: content.playbook });
        }}
      >
        Read selected playbook
      </ActionButton>
      {content.examples.map((example) => (
        <ActionButton
          key={example.id}
          quiet
          onPress={() => {
            setReading({
              title: `${example.title}.md`,
              text: `${example.content}\n\n---\n\nSource: ${example.source}\n\nRights: ${example.rights}`,
            });
          }}
        >
          {`Read source: ${example.title}`}
        </ActionButton>
      ))}
      <Text accessibilityRole="header" style={pageStyles.heading}>
        Reviewed cases
      </Text>
      {evidence.map((item) => (
        <View key={item.id} style={{ gap: 8 }}>
          <Text style={pageStyles.rowTitle}>{item.evaluation.case.title}</Text>
          <Text style={pageStyles.copy}>
            Useful for this case ·{" "}
            {item.models.map((model) => model.modelId).join(", ")} ·{" "}
            {((item.finishedAt - item.startedAt) / 1000).toFixed(1)} s
          </Text>
          <ActionButton
            quiet
            onPress={() => {
              setReading({
                title: `${item.evaluation.case.title}.md`,
                text: [
                  "# Question",
                  item.question,
                  "# Criteria set before the run",
                  item.evaluation.case.criteria,
                  "# Specialist response",
                  item.response,
                  "# Creator review",
                  item.review.content.notes,
                ].join("\n\n"),
              });
            }}
          >
            {`Read evaluation: ${item.evaluation.case.title}`}
          </ActionButton>
        </View>
      ))}
      {reading && (
        <DocumentEditor
          title={reading.title}
          label="Version evidence"
          description="The selected source or evaluation preserved for this version."
          initialText={reading.text}
          markdown
          readOnly
          maxLength={64000}
          onClose={() => {
            setReading(undefined);
          }}
          onSave={async () => {
            throw new Error("Version evidence is read-only.");
          }}
        />
      )}
    </>
  );
}
