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
import { ArrowUp, Square } from "lucide-react-native";
import { colors } from "./theme";

export function Composer({
  onSend,
  onCancel,
  busy = false,
  disabled = false,
  initialDraft = "",
}: {
  readonly onSend: (message: string) => Promise<void>;
  readonly onCancel?: () => void;
  readonly busy?: boolean;
  readonly disabled?: boolean;
  readonly initialDraft?: string;
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
      <View style={styles.composer}>
        <TextInput
          accessibilityLabel="Message Zoen"
          placeholder="What’s on your mind?"
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
          <Text style={styles.hint}>
            {busy
              ? "You can add a follow-up"
              : "A little less to do. A little more room for you."}
          </Text>
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
  wrapper: { width: "100%", gap: 10 },
  composer: {
    backgroundColor: colors.surface,
    borderWidth: 1,
    borderColor: colors.line,
    borderRadius: 25,
    padding: 16,
    boxShadow: "0 4px 28px rgba(40, 40, 25, 0.035)",
  },
  input: {
    minHeight: 68,
    maxHeight: 220,
    fontSize: 17,
    lineHeight: 25,
    color: colors.ink,
    textAlignVertical: "top",
    outlineWidth: 0,
    padding: 4,
  },
  footer: { flexDirection: "row", alignItems: "center", gap: 10 },
  hint: {
    flex: 1,
    fontSize: 11,
    lineHeight: 16,
    color: colors.muted,
    paddingLeft: 4,
  },
  send: {
    width: 36,
    height: 36,
    borderRadius: 18,
    alignItems: "center",
    justifyContent: "center",
    backgroundColor: colors.ink,
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
