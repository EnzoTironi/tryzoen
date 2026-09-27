import { useState } from "react";
import { StyleSheet, Text, TextInput, View } from "react-native";
import { CompanionPage, pageStyles } from "./page";
import { ActionButton } from "./button";
import { colors } from "./theme";
import { CompanionOverlay } from "./overlay";

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
        <MemoryEditor
          document={editing}
          onSave={onSave}
          onClose={() => {
            setEditing(undefined);
          }}
        />
      )}
    </CompanionPage>
  );
}
function MemoryEditor({
  document,
  onSave,
  onClose,
}: {
  readonly document: MemoryDocumentView;
  readonly onSave: (id: string, text: string) => Promise<void>;
  readonly onClose: () => void;
}) {
  const [text, setText] = useState(document.text);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string>();
  const [confirmDiscard, setConfirmDiscard] = useState(false);
  const dirty = text !== document.text;
  const close = () => {
    if (saving) return;
    if (dirty) setConfirmDiscard(true);
    else onClose();
  };
  const save = async () => {
    if (saving) return;
    setSaving(true);
    setError(undefined);
    try {
      await onSave(document.id, text);
      onClose();
    } catch (cause) {
      setError(
        cause instanceof Error
          ? cause.message
          : "Your notes could not be saved. Try again."
      );
    } finally {
      setSaving(false);
    }
  };
  return (
    <CompanionOverlay title="Edit personal notes" onClose={close}>
      <View style={{ flex: 1, backgroundColor: colors.canvas }}>
        <CompanionPage
          title="Edit personal notes"
          error={error}
          actions={
            <ActionButton quiet disabled={saving} onPress={close}>
              Close
            </ActionButton>
          }
        >
          <Text style={pageStyles.copy}>
            Put each fact or preference on its own line. Saving replaces this
            document’s notes.
          </Text>
          <TextInput
            accessibilityLabel="Personal notes"
            multiline
            value={text}
            onChangeText={setText}
            maxLength={4000}
            editable={!saving}
            style={[pageStyles.field, styles.editor]}
          />
          <Text style={pageStyles.copy}>
            {text.length} characters · Keep each fact short and on its own line.
          </Text>
          <View style={styles.actions}>
            <ActionButton
              disabled={!dirty || saving}
              onPress={() => {
                void save();
              }}
            >
              {saving ? "Saving…" : "Save notes"}
            </ActionButton>
          </View>
          {confirmDiscard && (
            <View style={styles.discard}>
              <Text style={pageStyles.rowTitle}>
                Discard your unsaved changes?
              </Text>
              <View style={styles.actions}>
                <ActionButton
                  quiet
                  onPress={() => {
                    setConfirmDiscard(false);
                  }}
                >
                  Keep editing
                </ActionButton>
                <ActionButton onPress={onClose}>Discard changes</ActionButton>
              </View>
            </View>
          )}
        </CompanionPage>
      </View>
    </CompanionOverlay>
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
  editor: { minHeight: 300, textAlignVertical: "top", lineHeight: 24 },
  discard: {
    gap: 8,
    padding: 20,
    borderRadius: 20,
    backgroundColor: colors.wash,
    marginTop: 24,
  },
});
