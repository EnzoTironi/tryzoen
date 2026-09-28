import { useState } from "react";
import { Text, View } from "react-native";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import type { z } from "zod";
import { ActionButton } from "../button";
import { CompanionSheet } from "../sheet";
import { DocumentEditor } from "../document-editor";
import { pageStyles } from "../page";
import type { CreatorStudioData } from "./studio";
import { CreatorExample } from "./example";
import { CreatorDetails } from "./details";
import {
  creatorExampleTemplate,
  type creatorDraftSchema,
  type creatorExampleSchema,
} from "./schema";

export function CreatorDraft({
  id,
  data,
  cacheScope,
  onClose,
}: {
  readonly id: string;
  readonly data: CreatorStudioData;
  readonly cacheScope: string;
  readonly onClose: () => void;
}) {
  const client = useQueryClient();
  const queryKey = ["creator-draft", cacheScope, id];
  const draft = useQuery({ queryKey, queryFn: () => data.read(id) });
  const [playbook, setPlaybook] =
    useState<z.infer<typeof creatorDraftSchema>>();
  const [details, setDetails] = useState<z.infer<typeof creatorDraftSchema>>();
  const [example, setExample] = useState<{
    snapshot: z.infer<typeof creatorDraftSchema>;
    value: z.infer<typeof creatorExampleSchema>;
  }>();
  return (
    <CompanionSheet
      title={draft.data?.content.title ?? "Specialist draft"}
      onClose={onClose}
    >
      {draft.isPending && (
        <Text style={pageStyles.copy}>Loading your specialist…</Text>
      )}
      {draft.isError && (
        <>
          <Text accessibilityRole="alert" style={pageStyles.copy}>
            This draft is unavailable. Check your workspace and try again.
          </Text>
          <ActionButton
            onPress={() => {
              void draft.refetch();
            }}
          >
            Try again
          </ActionButton>
        </>
      )}
      {draft.data && (
        <>
          <Text style={pageStyles.copy}>
            Private draft · Only you can open this specialist in this workspace.
          </Text>
          {Boolean(draft.data.content.description) && (
            <Text style={pageStyles.copy}>
              {draft.data.content.description}
            </Text>
          )}
          <ActionButton
            quiet
            onPress={() => {
              setDetails(draft.data);
            }}
          >
            Edit specialist details
          </ActionButton>
          <Text
            accessibilityRole="header"
            style={[pageStyles.heading, { marginBottom: 0 }]}
          >
            Playbook
          </Text>
          <Text style={pageStyles.copy}>
            Define useful strategies, the context they need and when a person
            should take over.
          </Text>
          <ActionButton
            onPress={() => {
              setPlaybook(draft.data);
            }}
          >
            Edit playbook
          </ActionButton>
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
          {draft.data.content.examples.map((item) => (
            <View key={item.id} style={{ gap: 8, paddingVertical: 8 }}>
              <Text style={pageStyles.rowTitle}>{item.title}</Text>
              <Text style={pageStyles.copy}>{item.source}</Text>
              <ActionButton
                quiet
                onPress={() => {
                  setExample({ snapshot: draft.data, value: item });
                }}
              >
                {`Edit ${item.title}`}
              </ActionButton>
            </View>
          ))}
          <ActionButton
            quiet
            disabled={draft.data.content.examples.length >= 20}
            onPress={() => {
              setExample({
                snapshot: draft.data,
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
        </>
      )}
      {playbook && (
        <DocumentEditor
          title="Playbook.md"
          label="Specialist playbook"
          description="Your private draft. Saving does not publish this playbook or change an active agent."
          initialText={playbook.content.playbook}
          maxLength={64000}
          markdown
          onClose={() => {
            setPlaybook(undefined);
          }}
          onSave={async (text) => {
            const updated = await data.save({
              id,
              expectedRevision: playbook.revision,
              content: { ...playbook.content, playbook: text },
            });
            client.setQueryData(queryKey, updated);
          }}
        />
      )}
      {details && (
        <CreatorDetails
          draft={details}
          save={data.save}
          onSaved={(updated) => {
            client.setQueryData(queryKey, updated);
          }}
          onClose={() => {
            setDetails(undefined);
          }}
        />
      )}
      {example && (
        <CreatorExample
          key={example.value.id}
          initial={example.value}
          onRemove={
            example.snapshot.content.examples.some(
              (item) => item.id === example.value.id
            )
              ? async () => {
                  const updated = await data.save({
                    id,
                    expectedRevision: example.snapshot.revision,
                    content: {
                      ...example.snapshot.content,
                      examples: example.snapshot.content.examples.filter(
                        (item) => item.id !== example.value.id
                      ),
                    },
                  });
                  client.setQueryData(queryKey, updated);
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
              id,
              expectedRevision: example.snapshot.revision,
              content: { ...example.snapshot.content, examples },
            });
            client.setQueryData(queryKey, updated);
          }}
        />
      )}
    </CompanionSheet>
  );
}
