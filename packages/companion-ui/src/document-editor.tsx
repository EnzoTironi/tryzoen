import {
  createContext,
  Fragment,
  useContext,
  useEffect,
  useRef,
  useState,
} from "react";
import { StyleSheet, Text, TextInput, View } from "react-native";
import { CompanionPage, pageStyles } from "./page";
import { ActionButton } from "./button";
import { CompanionOverlay } from "./overlay";
import { colors } from "./theme";
import { DocumentHistory, type DocumentHistoryData } from "./document-history";
import {
  MarkdownEditorProvider,
  type MarkdownEditorHandle,
} from "./markdown-editor";

// Keep an editor mounted when its surrounding panel changes presentation.
export const DocumentEditing = createContext<
  ((editing: boolean) => void) | undefined
>(undefined);

export function DocumentEditor({
  title,
  label,
  description,
  initialText,
  maxLength,
  saveLabel = "Save changes",
  readOnly = false,
  allowUnchanged = false,
  markdown = false,
  history,
  onSave,
  onClose,
}: {
  readonly title: string;
  readonly label: string;
  readonly description: string;
  readonly initialText: string;
  readonly maxLength: number;
  readonly saveLabel?: string;
  readonly readOnly?: boolean;
  readonly allowUnchanged?: boolean;
  readonly markdown?: boolean;
  readonly history?: DocumentHistoryData;
  readonly onSave: (text: string) => Promise<void>;
  readonly onClose: () => void;
}) {
  const reportEditing = useContext(DocumentEditing);
  const renderMarkdown = useContext(MarkdownEditorProvider);
  const editor = useRef<MarkdownEditorHandle>(null);
  useEffect(() => {
    reportEditing?.(true);
    return () => {
      reportEditing?.(false);
    };
  }, [reportEditing]);
  const [text, setText] = useState(initialText);
  const [editorSeed, setEditorSeed] = useState({
    text: initialText,
    revision: 0,
  });
  const [showHistory, setShowHistory] = useState(false);
  const [unreadChanges, setUnreadChanges] = useState(false);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string>();
  const [confirmDiscard, setConfirmDiscard] = useState(false);
  const dirty = unreadChanges || text !== initialText;
  const close = () => {
    if (saving) return;
    if (dirty) setConfirmDiscard(true);
    else onClose();
  };
  const save = async () => {
    if (saving || readOnly) return;
    setSaving(true);
    setError(undefined);
    try {
      const content =
        markdown && renderMarkdown ? await editor.current?.read() : text;
      if (content === undefined)
        throw new Error("The editor is still loading. Try again.");
      if (content.length > maxLength)
        throw new Error(
          `Keep this document under ${maxLength.toLocaleString()} characters.`
        );
      await onSave(content);
      onClose();
    } catch (cause) {
      setError(
        cause instanceof Error
          ? cause.message
          : "Changes could not be saved. Try again."
      );
    } finally {
      setSaving(false);
    }
  };
  const discardConfirmation = confirmDiscard && (
    <View style={styles.discard}>
      <Text style={pageStyles.rowTitle}>Discard your unsaved changes?</Text>
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
  );
  return (
    <CompanionOverlay title={title} onClose={close}>
      <View style={styles.surface}>
        {markdown && renderMarkdown ? (
          <>
            <View style={styles.documentHeader}>
              <Text
                accessibilityRole="header"
                numberOfLines={1}
                style={styles.filename}
              >
                {title}
              </Text>
              <View style={styles.headerActions}>
                {history && (
                  <ActionButton
                    quiet
                    disabled={saving}
                    onPress={() => {
                      setShowHistory(!showHistory);
                    }}
                  >
                    {showHistory ? "Hide history" : "History"}
                  </ActionButton>
                )}
                {!readOnly && (
                  <ActionButton
                    quiet
                    disabled={(!dirty && !allowUnchanged) || saving}
                    onPress={() => {
                      void save();
                    }}
                  >
                    {saving ? "Saving…" : "Save"}
                  </ActionButton>
                )}
                <ActionButton quiet disabled={saving} onPress={close}>
                  Close
                </ActionButton>
              </View>
            </View>
            {error && (
              <Text accessibilityRole="alert" style={styles.error}>
                {error}
              </Text>
            )}
            {discardConfirmation}
            {showHistory && history && (
              <DocumentHistory
                data={history}
                readOnly={readOnly || saving}
                onRestore={(value) => {
                  setText(value);
                  setUnreadChanges(false);
                  setEditorSeed((current) => ({
                    text: value,
                    revision: current.revision + 1,
                  }));
                  setShowHistory(false);
                }}
              />
            )}
            <Fragment key={editorSeed.revision}>
              {renderMarkdown({
                ref: editor,
                filename: title,
                initialMarkdown: editorSeed.text,
                label,
                description,
                editable: !saving && !readOnly,
                onChange: (value) => {
                  setText(value);
                  setUnreadChanges(false);
                },
                onDirty: () => {
                  setUnreadChanges(true);
                },
                onError: setError,
              })}
            </Fragment>
          </>
        ) : (
          <CompanionPage
            title={title}
            error={error}
            actions={
              <ActionButton quiet disabled={saving} onPress={close}>
                Close
              </ActionButton>
            }
          >
            <Text style={pageStyles.copy}>{description}</Text>
            <TextInput
              accessibilityLabel={label}
              multiline
              value={text}
              onChangeText={setText}
              maxLength={maxLength}
              editable={!saving && !readOnly}
              style={[pageStyles.field, styles.editor]}
            />
            <Text style={pageStyles.copy}>{text.length} characters</Text>
            {!readOnly && (
              <View style={styles.actions}>
                <ActionButton
                  disabled={(!dirty && !allowUnchanged) || saving}
                  onPress={() => {
                    void save();
                  }}
                >
                  {saving ? "Saving…" : saveLabel}
                </ActionButton>
              </View>
            )}
            {discardConfirmation}
          </CompanionPage>
        )}
      </View>
    </CompanionOverlay>
  );
}
const styles = StyleSheet.create({
  surface: { flex: 1, backgroundColor: colors.canvas },
  documentHeader: {
    minHeight: 64,
    padding: 12,
    paddingHorizontal: 24,
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
    borderBottomWidth: StyleSheet.hairlineWidth,
    borderBottomColor: colors.line,
    gap: 16,
  },
  filename: {
    fontSize: 17,
    fontWeight: "600",
    color: colors.ink,
    flexShrink: 1,
  },
  headerActions: { flexDirection: "row", gap: 8 },
  error: { color: colors.danger, padding: 16 },
  editor: {
    marginTop: 20,
    minHeight: 300,
    textAlignVertical: "top",
    lineHeight: 24,
  },
  actions: { flexDirection: "row", flexWrap: "wrap", gap: 12, marginTop: 16 },
  discard: {
    gap: 8,
    padding: 20,
    borderRadius: 20,
    backgroundColor: colors.wash,
    marginTop: 24,
  },
});
