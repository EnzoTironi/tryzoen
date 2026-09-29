import {
  AudioMessageRecorder,
  type AudioRecorderHandle,
} from "./recording/composer";
import {
  ComposerEditorProvider,
  type ComposerEditorHandle,
} from "./composer/editor";
import type { referenceAt } from "./references/schema";
import { useComposerSheet } from "./references/sheet";
import {
  useContext,
  useEffect,
  useRef,
  useState,
  useMemo,
  type ComponentProps,
} from "react";
import {
  ActivityIndicator,
  Platform,
  Pressable,
  StyleSheet,
  Text,
  TextInput,
  View,
} from "react-native";
import { ArrowUp, Square, X, Plus, FileText, Mic } from "lucide-react-native";
import { useAttachments } from "./attachments/provider";
import {
  requireAttachmentSizes,
  inlineAttachmentBytes,
  attachmentLimits,
} from "./attachments/limits";
import type { ConversationDraft } from "./session/input";
import { IconButton } from "./icon-button";
import type { MessageReply } from "./session/reply";
import { colors } from "./theme";

export function Composer({
  onSend,
  onCancel,
  busy = false,
  disabled = false,
  sendDisabled = false,
  initialDraft,
  value,
  onChangeText,
  sendStatus,
  reply,
  onRemoveReply,
  onDraftChange,
  attachments = true,
  selectedFiles,
  onFilesChange,
  maxLength = 10000,
  label = "Message Zoen",
  placeholder = "Message",
}: {
  readonly onSend: (message: ConversationDraft) => Promise<void>;
  readonly onCancel?: () => void;
  readonly busy?: boolean;
  readonly disabled?: boolean;
  readonly sendDisabled?: boolean;
  readonly initialDraft?: ConversationDraft;
  readonly value?: string;
  readonly onChangeText?: (text: string) => void;
  readonly sendStatus?: "idle" | "sending" | "failed";
  readonly reply?: MessageReply;
  readonly onRemoveReply?: () => void;
  readonly attachments?: boolean;
  readonly selectedFiles?: ConversationDraft["files"];
  readonly onFilesChange?: (files: ConversationDraft["files"]) => void;
  readonly maxLength?: number;
  readonly label?: string;
  readonly placeholder?: string;
  readonly onDraftChange?: (draft: ConversationDraft) => void;
}) {
  const [localDraft, setDraft] = useState(initialDraft?.text ?? "");
  const draft = value ?? localDraft;
  const nextFile = useRef(initialDraft?.files.length ?? 0);
  const [localFiles, setLocalFiles] = useState(() =>
    (initialDraft?.files ?? []).map((file, key) => ({ file, key }))
  );
  const files = useMemo(
    () =>
      selectedFiles
        ? selectedFiles.map((file, key) => ({ file, key }))
        : localFiles,
    [selectedFiles, localFiles]
  );
  const changeFiles = (next: typeof localFiles) => {
    if (selectedFiles) onFilesChange?.(next.map(({ file }) => file));
    else setLocalFiles(next);
  };
  const attachmentAdapter = useAttachments();
  const attachmentPicker = attachmentAdapter?.pick;
  const audioRecorder = useRef<AudioRecorderHandle>(null);
  const pick = attachments ? attachmentPicker : undefined;
  const [picking, setPicking] = useState(false);
  const [recording, setRecording] = useState(false);
  const [localSending, setSending] = useState(false);
  const sending = localSending || sendStatus === "sending";
  const [error, setError] = useState<string>();
  const inFlight = useRef(false);
  const input = useRef<ComposerEditorHandle>(null);
  const editorAdapter = useContext(ComposerEditorProvider);
  const previousReply = useRef(reply?.id);
  useEffect(() => {
    if (reply?.id && reply.id !== previousReply.current) input.current?.focus();
    previousReply.current = reply?.id;
  }, [reply?.id]);
  const [reference, setReference] =
    useState<ReturnType<typeof referenceAt>>(null);
  const change = (text: string) => {
    setDraft(text);
    setError(undefined);
    onChangeText?.(text);
  };
  const sheet = useComposerSheet({
    text: draft,
    reference: editorAdapter ? reference : undefined,
    change,
    input,
    disabled: disabled || sending || picking || recording,
    onPick: pick ? () => void selectFiles() : undefined,
  });
  const canSend =
    (Boolean(draft.trim()) || files.length > 0) &&
    draft.length <= maxLength &&
    !disabled &&
    !sendDisabled &&
    !sending &&
    !picking &&
    !recording;
  useEffect(() => {
    onDraftChange?.({ text: draft, files: files.map(({ file }) => file) });
  }, [draft, files, onDraftChange]);
  function addFiles(picked: ConversationDraft["files"]) {
    const combined = [...files.map(({ file }) => file), ...picked];
    requireAttachmentSizes(
      combined.map((file) => inlineAttachmentBytes(file.url))
    );
    changeFiles([
      ...files,
      ...picked.map((file) => ({
        file,
        key: nextFile.current++ + files.length,
      })),
    ]);
  }
  async function selectFiles() {
    if (!pick || picking || sending || recording) return;
    setPicking(true);
    setError(undefined);
    try {
      const picked = await pick();
      addFiles(picked);
    } catch (cause) {
      setError(
        cause instanceof Error
          ? cause.message
          : "The files could not be opened. Try again."
      );
    } finally {
      setPicking(false);
    }
  }
  async function submit() {
    if (!canSend || inFlight.current) return;
    inFlight.current = true;
    setSending(true);
    setError(undefined);
    try {
      const submitted = (
        input.current?.read ? await input.current.read() : draft
      ).trim();
      if (submitted.length > maxLength) throw new Error("Message too long");
      await onSend({ text: submitted, files: files.map(({ file }) => file) });
      if (value === undefined)
        setDraft((current) => (current.trim() === submitted ? "" : current));
      changeFiles([]);
    } catch {
      setError(
        "Your message couldn’t be sent. Your draft is still here — try again."
      );
    } finally {
      inFlight.current = false;
      setSending(false);
    }
  }
  return (
    <View style={styles.wrapper}>
      {sheet.content}
      {attachments && (
        <AudioMessageRecorder
          triggerRef={audioRecorder}
          disabled={
            disabled ||
            sending ||
            picking ||
            files.length >= attachmentLimits.count
          }
          maxBytes={
            attachmentLimits.bytes -
            files.reduce(
              (sum, { file }) => sum + inlineAttachmentBytes(file.url),
              0
            )
          }
          onActive={setRecording}
          onAttach={(file) => {
            addFiles([file]);
          }}
        />
      )}
      <AttachmentStrip
        files={files}
        disabled={sending || picking || recording}
        onRemove={(key) => {
          changeFiles(files.filter((item) => item.key !== key));
        }}
      />
      <ReplyPreview
        reply={reply}
        disabled={sending}
        onRemoveReply={onRemoveReply}
      />
      <View style={styles.composer}>
        {(Boolean(pick) || sheet.source) && (
          <IconButton
            icon={Plus}
            label="Adicionar à mensagem"
            disabled={disabled || sending || picking || recording}
            onPress={sheet.open}
          />
        )}
        {picking && (
          <ActivityIndicator
            accessibilityLabel="Reading attachments"
            color={colors.muted}
          />
        )}
        {editorAdapter ? (
          <editorAdapter.Input
            ref={input}
            value={draft}
            label={label}
            placeholder={placeholder}
            disabled={disabled || sending}
            maxLength={maxLength}
            onChange={sheet.changeText}
            onReference={setReference}
            onKey={sheet.key}
            onSubmit={() => {
              void submit();
            }}
            onError={setError}
          />
        ) : (
          <TextInput
            accessibilityLabel={label}
            placeholder={placeholder}
            placeholderTextColor={colors.muted}
            value={draft}
            ref={(instance) => {
              input.current = instance;
            }}
            selection={sheet.selection}
            onChangeText={sheet.changeText}
            onSelectionChange={({ nativeEvent }) => {
              sheet.setCaret(nativeEvent.selection.start);
            }}
            editable={!disabled && !sending}
            multiline
            maxLength={maxLength}
            style={styles.input}
            onKeyPress={(event) => {
              if ("shiftKey" in event && event.shiftKey) return;
              if (
                "isComposing" in event.nativeEvent &&
                event.nativeEvent.isComposing
              )
                return;
              if (sheet.key(event.nativeEvent.key)) {
                event.preventDefault();
                return;
              }
              if (Platform.OS !== "web" || event.nativeEvent.key !== "Enter")
                return;
              event.preventDefault();
              void submit();
            }}
          />
        )}

        <View style={styles.footer}>
          {attachments && attachmentAdapter?.startAudioRecording && (
            <IconButton
              icon={Mic}
              label="Record voice message"
              disabled={
                disabled ||
                sending ||
                picking ||
                recording ||
                files.length >= attachmentLimits.count
              }
              onPress={() => {
                audioRecorder.current?.start();
              }}
            />
          )}

          {busy && onCancel && (
            <Pressable
              accessibilityRole="button"
              accessibilityLabel="Stop response"
              onPress={onCancel}
              style={styles.stop}
            >
              <Square size={14} color={colors.ink} fill={colors.ink} />
            </Pressable>
          )}
          <Pressable
            accessibilityRole="button"
            accessibilityLabel="Send message"
            hitSlop={4}
            aria-disabled={!canSend}
            disabled={!canSend}
            onPress={() => {
              void submit();
            }}
            style={[styles.send, !canSend && styles.disabled]}
          >
            {sending ? (
              <ActivityIndicator size="small" color={colors.surface} />
            ) : (
              <ArrowUp size={20} strokeWidth={2} color={colors.surface} />
            )}
          </Pressable>
        </View>
      </View>
      {(Boolean(error) || sendStatus === "failed") && (
        <Text accessibilityRole="alert" style={styles.error}>
          {error ??
            "Your message couldn’t be sent. Your draft is still here — try again."}
        </Text>
      )}
    </View>
  );
}

function AttachmentStrip({
  files,
  disabled,
  onRemove,
}: {
  readonly files: { file: ConversationDraft["files"][number]; key: number }[];
  readonly disabled: boolean;
  readonly onRemove: (key: number) => void;
}) {
  const renderMedia = useAttachments()?.renderMedia;
  if (!files.length) return null;
  return (
    <View style={styles.attachments}>
      {files.map(({ file, key }) => (
        <View key={key} style={styles.attachment}>
          {file.mediaType.startsWith("audio/") && renderMedia ? (
            renderMedia(file)
          ) : (
            <>
              <FileText size={20} color={colors.muted} />
              <Text style={styles.attachmentName} numberOfLines={1}>
                {file.filename ?? "Attachment"}
              </Text>
            </>
          )}
          <IconButton
            icon={X}
            label={`Remove ${file.filename ?? "attachment"}`}
            disabled={disabled}
            onPress={() => {
              onRemove(key);
            }}
          />
        </View>
      ))}
    </View>
  );
}

function ReplyPreview({
  reply,
  disabled,
  onRemoveReply,
}: Pick<
  ComponentProps<typeof Composer>,
  "reply" | "disabled" | "onRemoveReply"
>) {
  if (!reply) return null;
  return (
    <View style={styles.quote}>
      <View style={styles.quoteText}>
        <Text style={styles.quoteAuthor}>
          {reply.id.startsWith("feed:")
            ? "Discussing a Feed post"
            : `Replying to ${reply.sender ?? (reply.role === "user" ? "you" : "Zoen")}`}
        </Text>
        <Text numberOfLines={3} style={styles.quoteExcerpt}>
          {reply.text}
        </Text>
      </View>
      <IconButton
        icon={X}
        label="Remove reply"
        disabled={disabled}
        onPress={() => onRemoveReply?.()}
      />
    </View>
  );
}

const styles = StyleSheet.create({
  attachments: { gap: 8 },
  attachment: {
    flexDirection: "row",
    alignItems: "center",
    gap: 8,
    paddingLeft: 14,
    backgroundColor: colors.wash,
    borderRadius: 18,
  },
  attachmentName: { flex: 1, fontSize: 14, color: colors.ink },
  quote: {
    flexDirection: "row",
    alignItems: "center",
    gap: 12,
    padding: 16,
    borderRadius: 18,
    backgroundColor: colors.wash,
    borderLeftWidth: 3,
    borderLeftColor: colors.accent,
  },
  quoteText: { flex: 1, gap: 4 },
  quoteAuthor: { fontSize: 13, fontWeight: "600", color: colors.ink },
  quoteExcerpt: { fontSize: 14, lineHeight: 20, color: colors.muted },
  wrapper: { width: "100%", gap: 10, zIndex: 10 },
  composer: {
    backgroundColor: colors.surface,
    flexDirection: "row",
    alignItems: "center",
    gap: 12,
    borderWidth: 0,
    borderColor: colors.line,
    borderRadius: 32,
    padding: 12,
    boxShadow: "0 4px 28px rgba(0, 0, 0, 0.10)",
  },
  input: {
    flex: 1,
    minHeight: 32,
    maxHeight: 220,
    fontSize: 17,
    lineHeight: 25,
    color: colors.ink,
    textAlignVertical: "top",
    outlineWidth: 0,
    paddingHorizontal: 10,
    paddingVertical: 3,
  },
  footer: { flexDirection: "row", alignItems: "center", gap: 10 },
  send: {
    width: 36,
    height: 36,
    borderRadius: 18,
    alignItems: "center",
    justifyContent: "center",
    backgroundColor: colors.accent,
  },
  stop: {
    width: 36,
    height: 36,
    alignItems: "center",
    justifyContent: "center",
  },
  disabled: { opacity: 0.28 },
  error: {
    fontSize: 13,
    lineHeight: 20,
    color: colors.danger,
    paddingHorizontal: 12,
  },
});
