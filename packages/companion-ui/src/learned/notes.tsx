import { useState } from "react";
import { StyleSheet, Text, View } from "react-native";
import { useMutation, useQuery } from "@tanstack/react-query";
import { CompanionPage, pageStyles } from "../page";
import { ActionButton } from "../button";
import { DocumentEditor } from "../document-editor";
import { CompanionSheet } from "../sheet";
import type { MemoryDocumentView } from "../personal-memory";
import type { z } from "zod";
import type {
  learnedMemoryHistoryInputSchema,
  learnedMemoryHistorySchema,
  learnedMemoryRelationEditSchema,
  LearnedMemoryItemSchema,
} from "./schema";
import { MemoryHistory } from "./history";
import { MemoryRelations } from "./relations";

export interface LearnedNotesData {
  relate: (
    input: z.infer<typeof learnedMemoryRelationEditSchema>,
    operationId: string
  ) => Promise<void>;
  history: (
    input: z.infer<typeof learnedMemoryHistoryInputSchema>
  ) => Promise<z.infer<typeof learnedMemoryHistorySchema>>;
  read: () => Promise<{
    documents: readonly (MemoryDocumentView &
      Pick<z.infer<typeof LearnedMemoryItemSchema>, "relations">)[];
    enabled: boolean;
    workspaceEnabled: boolean;
    needsAttention: boolean;
  }>;
  save: (
    id: string | undefined,
    text: string,
    operationId: string
  ) => Promise<void>;
  remove: (id: string, operationId: string) => Promise<void>;
  clear: (operationId: string) => Promise<void>;
  setEnabled: (enabled: boolean) => Promise<void>;
  recover: () => Promise<void>;
  newOperationId: () => string;
}

export function LearnedNotes({
  data,
  cacheScope,
}: {
  readonly data: LearnedNotesData;
  readonly cacheScope: string;
}) {
  const [historyOpen, setHistoryOpen] = useState(false);
  const [relating, setRelating] = useState<string>();
  const memory = useQuery({
    queryKey: ["companion-learned-memory", cacheScope],
    queryFn: data.read,
  });
  const [editing, setEditing] = useState<{
    id?: string;
    text: string;
    operationId: string;
  }>();
  const [removing, setRemoving] = useState<{
    id?: string;
    operationId: string;
  }>();
  const mutation = useMutation({
    mutationFn: (action: () => Promise<void>) => action(),
    onSettled: async () => {
      await memory.refetch();
    },
  });
  const actionsDisabled =
    mutation.isPending || memory.isFetching || memory.isError;
  const edit = (id?: string, text = "") => {
    setEditing({ id, text, operationId: data.newOperationId() });
  };
  return (
    <CompanionPage
      title="Learned memories"
      loading={memory.isPending}
      error={
        memory.error
          ? "Your saved memories couldn’t be loaded. Try again when access is restored."
          : mutation.error
            ? "Your change couldn’t be confirmed. Review the saved notes before trying again."
            : undefined
      }
      onRetry={() => {
        void memory.refetch();
      }}
    >
      <Text style={pageStyles.copy}>
        Private to you in this workspace. Review what Zoen remembers, correct a
        note, or pause learning.
      </Text>
      <View style={styles.actions}>
        <ActionButton
          quiet
          disabled={
            !memory.data?.enabled ||
            memory.data.needsAttention ||
            actionsDisabled
          }
          onPress={() => {
            setHistoryOpen(true);
          }}
        >
          Search memory history
        </ActionButton>
        <ActionButton
          disabled={
            !memory.data?.enabled ||
            actionsDisabled ||
            memory.data.needsAttention
          }
          onPress={() => {
            edit();
          }}
        >
          Remember something
        </ActionButton>
        <ActionButton
          quiet
          disabled={!memory.data?.workspaceEnabled || actionsDisabled}
          onPress={() => {
            mutation.mutate(() => data.setEnabled(!memory.data?.enabled));
          }}
        >
          {memory.data?.enabled === false ? "Resume memory" : "Pause memory"}
        </ActionButton>
      </View>
      {memory.data?.enabled === false && (
        <Text style={pageStyles.copy}>
          Learning and recall are paused. You can still review or remove saved
          notes.
        </Text>
      )}
      {memory.data?.needsAttention && (
        <View style={pageStyles.section}>
          <Text accessibilityRole="alert" style={pageStyles.copy}>
            An update did not finish. Review the saved notes before resuming
            memory.
          </Text>
          <ActionButton
            quiet
            disabled={actionsDisabled}
            onPress={() => {
              mutation.mutate(data.recover);
            }}
          >
            Resume with these notes
          </ActionButton>
        </View>
      )}
      {memory.isError && !!memory.data?.documents.length && (
        <Text style={pageStyles.copy}>
          Showing the last loaded notes. Editing will resume after access is
          restored.
        </Text>
      )}
      {memory.data?.documents.map((note) => (
        <View key={note.id} style={pageStyles.section}>
          <Text selectable style={pageStyles.rowTitle}>
            {note.text}
          </Text>
          {!!note.updated && (
            <Text style={pageStyles.copy}>Updated {note.updated}</Text>
          )}
          <View style={styles.actions}>
            <ActionButton
              quiet
              disabled={actionsDisabled || memory.data.needsAttention}
              onPress={() => {
                setRelating(note.id);
              }}
            >
              {`Relationships (${note.relations.length})`}
            </ActionButton>
            <ActionButton
              quiet
              disabled={actionsDisabled || memory.data.needsAttention}
              onPress={() => {
                edit(note.id, note.text);
              }}
            >
              Edit note
            </ActionButton>
            <ActionButton
              quiet
              disabled={actionsDisabled}
              onPress={() => {
                setRemoving({
                  id: note.id,
                  operationId: data.newOperationId(),
                });
              }}
            >
              Remove note
            </ActionButton>
          </View>
        </View>
      ))}
      {!memory.isError && memory.data?.documents.length === 0 && (
        <Text style={pageStyles.copy}>
          Things you ask Zoen to remember will appear here.
        </Text>
      )}
      {!!memory.data?.documents.length && (
        <View style={pageStyles.section}>
          <ActionButton
            quiet
            disabled={actionsDisabled}
            onPress={() => {
              setRemoving({ operationId: data.newOperationId() });
            }}
          >
            Remove all learned notes
          </ActionButton>
        </View>
      )}
      <Text style={[pageStyles.copy, pageStyles.section]}>
        Removing a note stops learned-memory recall of it. Earlier
        conversations, saved files, local version history and backups remain
        separate.
      </Text>
      {editing && (
        <DocumentEditor
          markdown
          title="Learned memory.md"
          label="Learned memory"
          description="A fact or preference for Zoen to remember in this workspace."
          initialText={editing.text}
          maxLength={8000}
          onClose={() => {
            setEditing(undefined);
          }}
          onSave={async (text) => {
            if (!text.trim()) throw new Error("Write a note before saving.");
            await mutation.mutateAsync(() =>
              data.save(editing.id, text, editing.operationId)
            );
          }}
        />
      )}
      {historyOpen && (
        <MemoryHistory
          load={data.history}
          onClose={() => {
            setHistoryOpen(false);
          }}
        />
      )}
      {relating && memory.data && (
        <MemoryRelations
          key={relating}
          noteId={relating}
          documents={memory.data.documents}
          data={data}
          onSaved={async () => {
            await memory.refetch();
          }}
          onClose={() => {
            setRelating(undefined);
          }}
        />
      )}
      {removing && (
        <CompanionSheet
          title="Remove learned memory"
          onClose={() => {
            if (!mutation.isPending) setRemoving(undefined);
          }}
        >
          <View>
            <Text accessibilityRole="header" style={pageStyles.heading}>
              {removing.id ? "Remove this note?" : "Remove all learned notes?"}
            </Text>
            {mutation.error && (
              <Text accessibilityRole="alert" style={pageStyles.copy}>
                The removal could not be completed. Try again.
              </Text>
            )}
            <Text style={pageStyles.copy}>
              Zoen will stop recalling{" "}
              {removing.id ? "this note" : "these notes"}. This does not erase
              earlier conversations, files, version history or backups.
            </Text>
            <View style={styles.actions}>
              <ActionButton
                quiet
                disabled={mutation.isPending}
                onPress={() => {
                  setRemoving(undefined);
                }}
              >
                Keep notes
              </ActionButton>
              <ActionButton
                disabled={actionsDisabled}
                onPress={() => {
                  mutation.mutate(async () => {
                    if (removing.id)
                      await data.remove(removing.id, removing.operationId);
                    else await data.clear(removing.operationId);
                    setRemoving(undefined);
                  });
                }}
              >
                {mutation.isPending ? "Removing…" : "Remove"}
              </ActionButton>
            </View>
          </View>
        </CompanionSheet>
      )}
    </CompanionPage>
  );
}
const styles = StyleSheet.create({
  actions: {
    flexDirection: "row",
    flexWrap: "wrap",
    gap: 10,
    marginVertical: 18,
  },
});
