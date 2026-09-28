import { useState } from "react";
import { Text, View } from "react-native";
import type { z } from "zod";
import { ActionButton } from "../button";
import { DocumentEditor } from "../document-editor";
import { pageStyles } from "../page";
import { CreatorExample } from "./example";
import type { CreatorStudioData } from "./studio";
import {
  creatorExampleTemplate,
  type creatorDraftSchema,
  type creatorExampleSchema,
} from "./schema";

export function CreatorExamples({
  draft,
  data,
  onChanged,
}: {
  readonly draft: z.infer<typeof creatorDraftSchema>;
  readonly data: CreatorStudioData;
  readonly onChanged: (draft: z.infer<typeof creatorDraftSchema>) => void;
}) {
  const [example, setExample] = useState<{
    snapshot: z.infer<typeof creatorDraftSchema>;
    value: z.infer<typeof creatorExampleSchema>;
  }>();
  return (
    <>
      <Text
        accessibilityRole="header"
        style={[pageStyles.heading, { marginBottom: 0 }]}
      >
        Authored examples
      </Text>
      <Text style={pageStyles.copy}>
        Use representative cases you can share. Include your observations,
        chosen strategy, alternatives and a useful response. Keep private
        conversations and client details out of these examples.
      </Text>
      {draft.content.examples.map((item) => (
        <View key={item.id} style={{ gap: 8, paddingVertical: 8 }}>
          <Text style={pageStyles.rowTitle}>{item.title}</Text>
          <Text style={pageStyles.copy}>{item.source}</Text>
          <ActionButton
            quiet
            onPress={() => {
              setExample({ snapshot: draft, value: item });
            }}
          >
            {`${draft.archivedAt ? "Read" : "Edit"} ${item.title}`}
          </ActionButton>
        </View>
      ))}
      {!draft.archivedAt && (
        <ActionButton
          quiet
          disabled={draft.content.examples.length >= 20}
          onPress={() => {
            setExample({
              snapshot: draft,
              value: {
                id: data.newId(),
                title: "",
                content: creatorExampleTemplate,
                source: "",
                rights: "original",
              },
            });
          }}
        >
          Add an example
        </ActionButton>
      )}
      {example?.snapshot.archivedAt ? (
        <DocumentEditor
          title={example.value.title}
          label="Archived example"
          description={`${example.value.source} · ${example.value.rights}`}
          initialText={example.value.content}
          maxLength={24000}
          markdown
          readOnly
          onSave={async () => {
            throw new Error("Restore this draft before editing it.");
          }}
          onClose={() => {
            setExample(undefined);
          }}
        />
      ) : (
        example && (
          <CreatorExample
            key={example.value.id}
            initial={example.value}
            onRemove={
              example.snapshot.content.examples.some(
                (item) => item.id === example.value.id
              )
                ? async () => {
                    const updated = await data.save({
                      id: draft.id,
                      expectedRevision: example.snapshot.revision,
                      content: {
                        ...example.snapshot.content,
                        examples: example.snapshot.content.examples.filter(
                          (item) => item.id !== example.value.id
                        ),
                      },
                    });
                    onChanged(updated);
                  }
                : undefined
            }
            onClose={() => {
              setExample(undefined);
            }}
            onSave={async (value) => {
              const previous = example.snapshot.content.examples;
              const examples = previous.some((item) => item.id === value.id)
                ? previous.map((item) => (item.id === value.id ? value : item))
                : [...previous, value];
              const updated = await data.save({
                id: draft.id,
                expectedRevision: example.snapshot.revision,
                content: { ...example.snapshot.content, examples },
              });
              onChanged(updated);
            }}
          />
        )
      )}
    </>
  );
}
