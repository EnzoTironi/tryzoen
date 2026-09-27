import { useState } from "react";
import { StyleSheet, Text, View } from "react-native";
import { CompanionPage, pageStyles } from "./page";
import { ActionButton } from "./button";
import { colors } from "./theme";
import { DocumentEditor } from "./document-editor";

export interface MemoryDocumentView {
  readonly id: string;
  readonly title: string;
  readonly text: string;
  readonly updated: string;
}
export function PersonalMemory({
  profile,
  documents,
  unresolved,
  loading,
  error,
  onRetry,
  onSave,
  onCorrectProfile,
}: {
  readonly profile: readonly { label: string; value: string }[];
  readonly documents: readonly MemoryDocumentView[];
  readonly unresolved: boolean;
  readonly loading?: boolean;
  readonly error?: string;
  readonly onRetry: () => void;
  readonly onSave: (id: string, text: string) => Promise<void>;
  readonly onCorrectProfile: () => void;
}) {
  const [editing, setEditing] = useState<MemoryDocumentView>();
  return (
    <CompanionPage
      title="Identity & memory"
      loading={loading}
      error={error}
      onRetry={onRetry}
      actions={
        <ActionButton quiet disabled={loading} onPress={onRetry}>
          Refresh
        </ActionButton>
      }
    >
      <Text style={pageStyles.copy}>
        Your saved profile and personal notes. These belong to your account,
        across your workspaces.
      </Text>
      <View style={pageStyles.section}>
        <Text accessibilityRole="header" style={pageStyles.heading}>
          Your profile
        </Text>
        {profile.map((field) => (
          <View key={field.label} style={styles.profileRow}>
            <Text style={pageStyles.copy}>{field.label}</Text>
            <Text selectable style={pageStyles.rowTitle}>
              {field.value}
            </Text>
          </View>
        ))}
        {!loading && !error && profile.length === 0 && (
          <Text style={pageStyles.copy}>No profile details saved yet.</Text>
        )}
        <View style={styles.actions}>
          <ActionButton quiet onPress={onCorrectProfile}>
            Update my profile
          </ActionButton>
        </View>
      </View>
      <View style={pageStyles.section}>
        <Text accessibilityRole="header" style={pageStyles.heading}>
          Personal notes
        </Text>
        {documents.map((document) => (
          <View key={document.id} style={styles.document}>
            <Text style={pageStyles.rowTitle}>{document.title}</Text>
            <Text style={pageStyles.copy}>Updated {document.updated}</Text>
            <Text selectable style={styles.note}>
              {document.text || "No notes in this document."}
            </Text>
            <View style={styles.actions}>
              <ActionButton
                quiet
                onPress={() => {
                  setEditing(document);
                }}
              >
                Edit notes
              </ActionButton>
            </View>
          </View>
        ))}
        {!loading && !error && documents.length === 0 && (
          <Text style={pageStyles.copy}>
            {unresolved
              ? "Personal notes have not been located yet. Continue a private conversation with Zoen, then refresh."
              : "No personal notes saved yet."}
          </Text>
        )}
      </View>
      <Text style={[pageStyles.copy, pageStyles.section]}>
        This view includes your profile and personal notes. Learned workspace
        memories, conversations, files, connected accounts and schedules are
        separate. Editing notes does not erase earlier conversations.
      </Text>
      {editing && (
        <DocumentEditor
          title="Edit personal notes"
          label="Personal notes"
          description="Put each fact or preference on its own line. Saving replaces this document’s notes."
          initialText={editing.text}
          maxLength={4000}
          saveLabel="Save notes"
          onSave={(text) => onSave(editing.id, text)}
          onClose={() => {
            setEditing(undefined);
          }}
        />
      )}
    </CompanionPage>
  );
}
const styles = StyleSheet.create({
  profileRow: { paddingVertical: 10, gap: 4 },
  actions: { flexDirection: "row", flexWrap: "wrap", gap: 12, marginTop: 16 },
  document: {
    paddingVertical: 20,
    gap: 10,
    borderBottomWidth: StyleSheet.hairlineWidth,
    borderBottomColor: colors.line,
  },
  note: { fontSize: 16, lineHeight: 25, color: colors.ink },
});
