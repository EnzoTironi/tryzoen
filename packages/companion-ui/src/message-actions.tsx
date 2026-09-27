import { useState } from "react";
import { StyleSheet, Text, View } from "react-native";
import { Check, Copy, Reply } from "lucide-react-native";
import type { EveMessage } from "eve/react";
import { IconButton } from "./icon-button";
import { colors } from "./theme";
import { messageText, type MessageReply } from "./session/reply";

export function MessageActions({
  message,
  onCopy,
  onReply,
}: {
  readonly message: EveMessage;
  readonly onCopy?: (text: string) => Promise<void>;
  readonly onReply: (reply: MessageReply) => void;
}) {
  const [copied, setCopied] = useState(false);
  const [error, setError] = useState(false);
  const text = messageText(message);
  if (!text.trim()) return null;
  return (
    <View style={styles.actions}>
      <IconButton
        icon={Reply}
        label="Reply to message"
        onPress={() => {
          onReply({ id: message.id, role: message.role, text });
        }}
      />
      {onCopy && (
        <IconButton
          icon={copied ? Check : Copy}
          label={copied ? "Message copied" : "Copy message"}
          onPress={() => {
            setError(false);
            void onCopy(text)
              .then(() => {
                setCopied(true);
              })
              .catch(() => {
                setError(true);
              });
          }}
        />
      )}
      {error && (
        <Text accessibilityRole="alert" style={styles.error}>
          Couldn’t copy. Try again.
        </Text>
      )}
    </View>
  );
}
const styles = StyleSheet.create({
  actions: {
    flexDirection: "row",
    alignItems: "center",
    gap: 2,
    paddingHorizontal: 4,
  },
  error: { fontSize: 13, color: colors.danger },
});
