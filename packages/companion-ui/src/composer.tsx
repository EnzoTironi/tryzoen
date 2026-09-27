import { useRef, useState } from "react";
import {
  ActivityIndicator,
  Platform,
  Pressable,
  StyleSheet,
  Text,
  TextInput,
  View,
} from "react-native";
import { ArrowUp, Square, X } from "lucide-react-native";
import { IconButton } from "./icon-button";
import type { MessageReply } from "./session/reply";
import { colors } from "./theme";

export function Composer({
  onSend,
  onCancel,
  busy = false,
  disabled = false,
  initialDraft = "",
  reply,
  onRemoveReply,
}: {
  readonly onSend: (message: string) => Promise<void>;
  readonly onCancel?: () => void;
  readonly busy?: boolean;
  readonly disabled?: boolean;
  readonly initialDraft?: string;
  readonly reply?: MessageReply;
  readonly onRemoveReply?: () => void;
}) {
  const [draft, setDraft] = useState(initialDraft);
  const [sending, setSending] = useState(false);
  const [error, setError] = useState<string>();
  const inFlight = useRef(false);
  const canSend = Boolean(draft.trim()) && !disabled && !sending;
  async function submit() {
    if (!canSend || inFlight.current) return;
    inFlight.current = true;
    setSending(true);
    setError(undefined);
    const submitted = draft.trim();
    try {
      await onSend(submitted);
      setDraft((current) => (current.trim() === submitted ? "" : current));
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
      {reply && (
        <View style={styles.quote}>
          <View style={styles.quoteText}>
            <Text style={styles.quoteAuthor}>
              {reply.role === "user" ? "Replying to you" : "Replying to Zoen"}
            </Text>
            <Text numberOfLines={3} style={styles.quoteExcerpt}>
              {reply.text}
            </Text>
          </View>
          <IconButton
            icon={X}
            label="Remove reply"
            onPress={() => {
              onRemoveReply?.();
            }}
          />
        </View>
      )}
      <View style={styles.composer}>
        <TextInput
          accessibilityLabel="Message Zoen"
          placeholder="Message"
          placeholderTextColor={colors.muted}
          value={draft}
          onChangeText={setDraft}
          editable={!disabled && !sending}
          multiline
          style={styles.input}
          onKeyPress={(event) => {
            if (Platform.OS !== "web" || event.nativeEvent.key !== "Enter")
              return;
            if ("shiftKey" in event && event.shiftKey) return;
            if (
              "isComposing" in event.nativeEvent &&
              event.nativeEvent.isComposing
            )
              return;
            event.preventDefault();
            void submit();
          }}
        />
        <View style={styles.footer}>
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
            accessibilityState={{ disabled: !canSend }}
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
      {error && (
        <Text accessibilityRole="alert" style={styles.error}>
          {error}
        </Text>
      )}
    </View>
  );
}

const styles = StyleSheet.create({
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
  wrapper: { width: "100%", gap: 10 },
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
