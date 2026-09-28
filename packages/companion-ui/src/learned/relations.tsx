import { useState } from "react";
import { StyleSheet, Text, TextInput, View } from "react-native";
import { useMutation } from "@tanstack/react-query";
import { CompanionSheet } from "../sheet";
import { ActionButton } from "../button";
import { pageStyles } from "../page";
import type { LearnedNotesData } from "./notes";

const labels = {
  causes: "Causes",
  fixes: "Fixes",
  contradicts: "Contradicts",
} as const;

const noteSummary = (text: string) => text.replace(/\s+/gu, " ").trim();

export function MemoryRelations({
  noteId,
  documents,
  data,
  onSaved,
  onClose,
}: {
  readonly noteId: string;
  readonly documents: readonly Pick<
    Awaited<ReturnType<LearnedNotesData["read"]>>["documents"][number],
    "id" | "text" | "relations"
  >[];
  readonly data: Pick<LearnedNotesData, "relate" | "newOperationId">;
  readonly onSaved: () => Promise<void>;
  readonly onClose: () => void;
}) {
  const note = documents.find((item) => item.id === noteId);
  const [expected] = useState(note?.relations ?? []);
  const [draft, setDraft] = useState({
    relations: expected,
    operationId: data.newOperationId(),
  });
  const [kind, setKind] = useState<keyof typeof labels>("contradicts");
  const [query, setQuery] = useState("");
  const save = useMutation({
    mutationFn: () =>
      data.relate(
        {
          memoryId: noteId,
          relations: draft.relations,
          expectedRelations: expected,
        },
        draft.operationId
      ),
    onSuccess: async () => {
      await onSaved();
      onClose();
    },
    onError: onSaved,
  });
  const matches = documents.filter(
    (item) =>
      item.id !== noteId &&
      item.text.toLocaleLowerCase().includes(query.trim().toLocaleLowerCase())
  );
  return (
    <CompanionSheet
      title="Memory relationships"
      onClose={() => {
        if (!save.isPending) onClose();
      }}
    >
      <Text style={pageStyles.copy}>
        Private to you in this workspace. Connect notes without changing either
        claim.
      </Text>
      <Text selectable style={pageStyles.rowTitle}>
        {note ? noteSummary(note.text) : "This note is no longer available."}
      </Text>
      <View style={styles.group}>
        <Text style={pageStyles.rowTitle}>This note…</Text>
        {draft.relations.length === 0 && (
          <Text style={pageStyles.copy}>No relationships yet.</Text>
        )}
        {draft.relations.map((relation) => (
          <View
            key={`${relation.kind}:${relation.memoryId}`}
            style={styles.relation}
          >
            <Text style={pageStyles.copy}>
              {labels[relation.kind]}:{" "}
              {noteSummary(
                documents.find((item) => item.id === relation.memoryId)?.text ??
                  "Removed note"
              )}
            </Text>
            <ActionButton
              quiet
              disabled={save.isPending}
              onPress={() => {
                setDraft({
                  relations: draft.relations.filter(
                    (item) => item !== relation
                  ),
                  operationId: data.newOperationId(),
                });
              }}
            >
              Remove relationship
            </ActionButton>
          </View>
        ))}
      </View>
      <View style={styles.actions}>
        {(["causes", "fixes", "contradicts"] as const).map((value) => (
          <ActionButton
            key={value}
            quiet={kind !== value}
            disabled={save.isPending}
            onPress={() => {
              setKind(value);
            }}
          >
            {labels[value]}
          </ActionButton>
        ))}
      </View>
      <TextInput
        accessibilityLabel="Find a memory to connect"
        placeholder="Find a memory to connect"
        value={query}
        onChangeText={setQuery}
        style={pageStyles.field}
        maxLength={8000}
      />
      <Text style={pageStyles.copy}>
        Choose the other note. Up to 20 relationships per note.
      </Text>
      {matches.slice(0, 20).map((target) => (
        <View key={target.id} style={styles.relation}>
          <Text numberOfLines={3} style={pageStyles.copy}>
            {noteSummary(target.text)}
          </Text>
          <ActionButton
            quiet
            disabled={
              save.isPending ||
              draft.relations.length >= 20 ||
              draft.relations.some(
                (item) => item.kind === kind && item.memoryId === target.id
              )
            }
            onPress={() => {
              setDraft({
                relations: [...draft.relations, { kind, memoryId: target.id }],
                operationId: data.newOperationId(),
              });
            }}
          >
            Connect note
          </ActionButton>
        </View>
      ))}
      {matches.length > 20 && (
        <Text style={pageStyles.copy}>
          Showing the first 20 matches. Refine your search to find another note.
        </Text>
      )}
      {matches.length === 0 && (
        <Text style={pageStyles.copy}>No other matching memories.</Text>
      )}
      {save.isError && (
        <Text accessibilityRole="alert" style={pageStyles.copy}>
          The relationships could not be saved. Your draft is retained. Close
          this panel to review the current notes and any unfinished update
          before retrying.
        </Text>
      )}
      <View style={styles.actions}>
        <ActionButton
          disabled={!note || save.isPending}
          onPress={() => {
            save.mutate();
          }}
        >
          {save.isPending ? "Saving…" : "Save relationships"}
        </ActionButton>
        <ActionButton quiet disabled={save.isPending} onPress={onClose}>
          Cancel
        </ActionButton>
      </View>
    </CompanionSheet>
  );
}

const styles = StyleSheet.create({
  group: { gap: 8 },
  actions: {
    flexDirection: "row",
    flexWrap: "wrap",
    gap: 8,
  },
  relation: { gap: 6, paddingVertical: 12 },
});
