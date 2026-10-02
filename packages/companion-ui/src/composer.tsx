import { useI18n } from "./i18n";
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
  useLayoutEffect,
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
  useWindowDimensions,
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
import { systemFont, useAccessibilityPreferences, useColors } from "./theme";

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
  label,
  placeholder,
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
  const { t, errorText } = useI18n();
  const colors = useColors();
  const preferences = useAccessibilityPreferences();
  const increasedContrast =
    preferences.increasedContrast || preferences.forcedColors;
  const opaque =
    preferences.reduceTransparency ||
    increasedContrast ||
    Platform.OS !== "web" ||
    typeof CSS === "undefined" ||
    !CSS.supports("backdrop-filter", "blur(1px)");
  const width = useWindowDimensions().width;
  const compact = width < 720;
  const styles = useMemo(
    () => createStyles(colors, compact, opaque, increasedContrast),
    [colors, compact, opaque, increasedContrast]
  );
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
  const latestFiles = useRef(files);
  useLayoutEffect(() => {
    latestFiles.current = files;
  }, [files]);
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
  useLayoutEffect(
    () => {
      const target = input.current;
      if (Platform.OS !== "web" || !(target instanceof HTMLTextAreaElement))
        return;
      // Measure from the content so deleting a line also shrinks the field.
      target.style.height = "auto";
      target.style.height = `${Math.max(compact ? 34 : 24, Math.min(180, target.scrollHeight))}px`;
    },
    // oxlint-disable-next-line react/exhaustive-effect-dependencies -- Content and viewport changes alter the DOM measurement.
    [draft, width, compact]
  );
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
          ? errorText(cause.message)
          : t("The files could not be opened. Try again.")
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
    const submittedFiles = files;
    try {
      const submitted = (
        input.current?.read ? await input.current.read() : draft
      ).trim();
      if (!submitted && submittedFiles.length === 0) return;
      if (submitted.length > maxLength) throw new Error(t("Message too long"));
      await onSend({
        text: submitted,
        files: submittedFiles.map(({ file }) => file),
      });
      if (value === undefined)
        setDraft((current) => (current.trim() === submitted ? "" : current));
      changeFiles(
        latestFiles.current.filter(
          ({ file }) => !submittedFiles.some((sent) => sent.file === file)
        )
      );
    } catch {
      setError(
        t(
          "Your message couldn’t be sent. Your draft is still here — try again."
        )
      );
    } finally {
      inFlight.current = false;
      setSending(false);
    }
  }
  return (
    <View pointerEvents="box-none" style={styles.wrapper}>
      {sheet.content}
      {attachments && (
        <AudioMessageRecorder
          triggerRef={audioRecorder}
          disabled={
            sendDisabled ||
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
      <View pointerEvents="box-none" style={styles.composer}>
        {(Boolean(pick) || sheet.source) && (
          <Pressable
            accessibilityRole="button"
            accessibilityLabel={t("Adicionar à mensagem")}
            disabled={disabled || sending || picking || recording}
            onPress={sheet.open}
            style={({ pressed }) => [
              styles.add,
              pressed && styles.pressed,
              (disabled || sending || picking || recording) && styles.disabled,
            ]}
          >
            <Plus
              size={compact ? 24 : 20}
              strokeWidth={1.8}
              color={colors.ink}
            />
          </Pressable>
        )}
        {picking && (
          <ActivityIndicator
            accessibilityLabel={t("Reading attachments")}
            color={colors.muted}
          />
        )}
        <View style={styles.field}>
          {editorAdapter ? (
            <editorAdapter.Input
              ref={input}
              value={draft}
              label={label ?? t("Message Zoen")}
              placeholder={placeholder ?? t("Message")}
              disabled={disabled || recording}
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
              accessibilityLabel={label ?? t("Message Zoen")}
              placeholder={placeholder ?? t("Message")}
              placeholderTextColor={
                increasedContrast || !opaque ? colors.ink : colors.muted
              }
              value={draft}
              ref={(instance) => {
                input.current = instance;
              }}
              selection={sheet.selection}
              onChangeText={sheet.changeText}
              onSelectionChange={({ nativeEvent }) => {
                sheet.setCaret(nativeEvent.selection.start);
              }}
              editable={!disabled && !recording}
              multiline
              numberOfLines={1}
              maxLength={maxLength}
              style={styles.input}
              onKeyPress={(event) => {
                const native = event.nativeEvent;
                if (
                  ("isComposing" in native && native.isComposing) ||
                  ("keyCode" in native && native.keyCode === 229)
                )
                  return;
                if (
                  [event, native].some(
                    (key) =>
                      ("shiftKey" in key && Boolean(key.shiftKey)) ||
                      ("altKey" in key && Boolean(key.altKey)) ||
                      ("ctrlKey" in key && Boolean(key.ctrlKey)) ||
                      ("metaKey" in key && Boolean(key.metaKey))
                  )
                )
                  return;
                if (sheet.key(native.key)) {
                  event.preventDefault();
                  return;
                }
                if (Platform.OS !== "web" || native.key !== "Enter") return;
                event.preventDefault();
                void submit();
              }}
            />
          )}

          <View style={styles.footer}>
            {attachments &&
              attachmentAdapter?.startAudioRecording &&
              !draft.trim() &&
              files.length === 0 && (
                <IconButton
                  icon={Mic}
                  label={t("Record voice message")}
                  disabled={disabled || sending || picking || recording}
                  onPress={() => {
                    audioRecorder.current?.start();
                  }}
                />
              )}

            {busy && onCancel && (
              <Pressable
                accessibilityRole="button"
                accessibilityLabel={t("Stop response")}
                hitSlop={6}
                onPress={onCancel}
                style={styles.stop}
              >
                <Square size={14} color={colors.ink} fill={colors.ink} />
              </Pressable>
            )}
            {(Boolean(draft.trim()) || files.length > 0 || sending) && (
              <Pressable
                accessibilityRole="button"
                accessibilityLabel={t("Send message")}
                hitSlop={6}
                accessibilityState={{ disabled: !canSend, busy: sending }}
                aria-disabled={!canSend}
                disabled={!canSend}
                onPress={() => {
                  void submit();
                }}
                style={[styles.send, !canSend && styles.disabled]}
              >
                {sending ? (
                  <ActivityIndicator size="small" color={colors.selectedInk} />
                ) : (
                  <ArrowUp
                    size={20}
                    strokeWidth={2}
                    color={colors.selectedInk}
                  />
                )}
              </Pressable>
            )}
          </View>
        </View>
      </View>
      {(Boolean(error) || sendStatus === "failed") && (
        <Text accessibilityRole="alert" style={styles.error}>
          {error ??
            t(
              "Your message couldn’t be sent. Your draft is still here — try again."
            )}
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
  const { t } = useI18n();
  const colors = useColors();
  const styles = useMemo(() => createStyles(colors), [colors]);
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
                {file.filename ?? t("Attachment")}
              </Text>
            </>
          )}
          <IconButton
            icon={X}
            label={t("Remove {value1}", {
              value1: file.filename ?? t("attachment"),
            })}
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
  const { t } = useI18n();
  const colors = useColors();
  const styles = useMemo(() => createStyles(colors), [colors]);
  if (!reply) return null;
  return (
    <View style={styles.quote}>
      <View style={styles.quoteText}>
        <Text style={styles.quoteAuthor}>
          {reply.id.startsWith("feed:")
            ? t("Discussing a Feed post")
            : t("Replying to {value1}", {
                value1:
                  reply.sender ??
                  (reply.role === "user" ? t("you") : t("Zoen")),
              })}
        </Text>
        <Text numberOfLines={3} style={styles.quoteExcerpt}>
          {reply.text}
        </Text>
      </View>
      <IconButton
        icon={X}
        label={t("Remove reply")}
        disabled={disabled}
        onPress={() => onRemoveReply?.()}
      />
    </View>
  );
}

const createStyles = (
  palette: ReturnType<typeof useColors>,
  compact = true,
  opaque = true,
  increasedContrast = false
) =>
  StyleSheet.create({
    attachments: { gap: 8 },
    attachment: {
      flexDirection: "row",
      alignItems: "center",
      gap: 8,
      paddingLeft: 14,
      backgroundColor: palette.wash,
      borderRadius: 16,
    },
    attachmentName: {
      flex: 1,
      fontFamily: systemFont,
      fontSize: 14,
      color: palette.ink,
    },
    quote: {
      flexDirection: "row",
      alignItems: "center",
      gap: 10,
      padding: 12,
      borderRadius: 14,
      backgroundColor: palette.wash,
      borderLeftWidth: 3,
      borderLeftColor: palette.accent,
    },
    quoteText: { flex: 1, gap: 3 },
    quoteAuthor: {
      fontFamily: systemFont,
      fontSize: 13,
      fontWeight: "600",
      color: palette.ink,
    },
    quoteExcerpt: {
      fontFamily: systemFont,
      fontSize: 14,
      lineHeight: 20,
      color: palette.muted,
    },
    wrapper: { width: "100%", gap: 8, zIndex: 10 },
    composer: { flexDirection: "row", alignItems: "flex-end", gap: 8 },
    add: {
      width: compact ? 44 : 32,
      height: compact ? 44 : 32,
      alignItems: "center",
      justifyContent: "center",
      borderRadius: 22,
      borderWidth: StyleSheet.hairlineWidth,
      borderColor: increasedContrast
        ? palette.ink
        : opaque
          ? palette.line
          : `${palette.line}70`,
      backgroundColor: opaque ? palette.surface : `${palette.surface}b8`,
      ...(Platform.OS === "web"
        ? { backdropFilter: opaque ? "none" : "blur(20px) saturate(180%)" }
        : {}),
    },
    pressed: { opacity: increasedContrast ? 1 : 0.6 },
    field: {
      flex: 1,
      minWidth: 0,
      minHeight: compact ? 44 : 32,
      backgroundColor: opaque ? palette.surface : `${palette.surface}b8`,
      ...(Platform.OS === "web"
        ? {
            color: palette.ink,
            backdropFilter: opaque ? "none" : "blur(20px) saturate(180%)",
          }
        : {}),
      flexDirection: "row",
      alignItems: "flex-end",
      gap: 6,
      borderWidth: StyleSheet.hairlineWidth,
      borderColor: increasedContrast
        ? palette.ink
        : opaque
          ? palette.line
          : `${palette.line}70`,
      borderRadius: compact ? 22 : 18,
      paddingLeft: 12,
      paddingRight: 5,
      paddingVertical: 4,
    },
    input: {
      flex: 1,
      minWidth: 0,
      minHeight: compact ? 34 : 24,
      maxHeight: 180,
      fontFamily: systemFont,
      fontSize: compact ? 17 : 14,
      lineHeight: compact ? 24 : 20,
      color: palette.ink,
      textAlignVertical: "top",
      paddingVertical: compact ? 5 : 2,
    },
    footer: {
      flexDirection: "row",
      alignItems: "center",
      gap: 4,
      paddingBottom: 1,
    },
    send: {
      width: compact ? 32 : 24,
      height: compact ? 32 : 24,
      borderRadius: 16,
      alignItems: "center",
      justifyContent: "center",
      backgroundColor: palette.accent,
    },
    stop: {
      width: 32,
      height: 32,
      borderRadius: 16,
      alignItems: "center",
      justifyContent: "center",
      backgroundColor: palette.wash,
    },
    disabled: { opacity: 0.4 },
    error: {
      fontFamily: systemFont,
      fontSize: 13,
      lineHeight: 18,
      color: palette.danger,
      paddingHorizontal: 12,
    },
  });
