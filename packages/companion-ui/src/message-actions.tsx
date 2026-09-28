import { lazy, Suspense, useState, type ComponentProps } from "react";
import {
  ActivityIndicator,
  Pressable,
  StyleSheet,
  Text,
  View,
} from "react-native";
import { Check, Copy, Reply, SmilePlus, Ellipsis } from "lucide-react-native";
import type { EveMessage } from "eve/react";
import { IconButton } from "./icon-button";
import { colors } from "./theme";
import { messageText, type MessageReply } from "./session/reply";
import { ActionButton } from "./button";

const ReactionPicker = lazy(() => import("./reactions/picker"));

export function MessageActions({
  message,
  onCopy,
  onReply,
  reaction,
  onReact,
}: {
  readonly message: EveMessage;
  readonly onCopy?: (text: string) => Promise<void>;
  readonly onReply: (reply: MessageReply) => void;
  readonly reaction?: string | null;
  readonly onReact?: (emoji: string | null) => Promise<void>;
}) {
  const [menu, setMenu] = useState(false);
  const close = () => {
    setMenu(false);
  };
  return (
    <View style={styles.actions}>
      {onReact &&
        (reaction ? (
          <Pressable
            accessibilityRole="button"
            accessibilityLabel={`Your reaction ${reaction}. Change or remove reaction`}
            onPress={() => {
              setMenu(true);
            }}
            style={styles.reaction}
          >
            <Text style={styles.emoji}>{reaction}</Text>
          </Pressable>
        ) : (
          <IconButton
            icon={message.role === "user" ? Ellipsis : SmilePlus}
            label="React to message"
            onPress={() => {
              setMenu(true);
            }}
          />
        ))}
      <TextMessageActions message={message} onCopy={onCopy} onReply={onReply} />
      {menu && onReact && (
        <Suspense
          fallback={
            <ActivityIndicator accessibilityLabel="Loading reactions" />
          }
        >
          <ReactionPicker
            selected={reaction}
            onSelect={onReact}
            onClose={() => {
              setMenu(false);
            }}
          >
            <TextMessageActions
              message={message}
              onCopy={onCopy}
              onReply={onReply}
              expanded
              onDone={close}
            />
          </ReactionPicker>
        </Suspense>
      )}
    </View>
  );
}
function TextMessageActions({
  message,
  onCopy,
  onReply,
  expanded = false,
  onDone,
}: Pick<
  ComponentProps<typeof MessageActions>,
  "message" | "onCopy" | "onReply"
> & {
  readonly expanded?: boolean;
  readonly onDone?: () => void;
}) {
  const [copied, setCopied] = useState(false);
  const [error, setError] = useState(false);
  const text = messageText(message);
  if (!text.trim()) return null;
  const reply = () => {
    onReply({ id: message.id, role: message.role, text });
    onDone?.();
  };
  const copy = async () => {
    setError(false);
    try {
      await onCopy?.(text);
      setCopied(true);
      onDone?.();
    } catch {
      setError(true);
    }
  };
  return (
    <View style={expanded ? styles.menuActions : styles.actions}>
      {expanded ? (
        <ActionButton quiet onPress={reply}>
          Reply
        </ActionButton>
      ) : (
        <IconButton icon={Reply} label="Reply to message" onPress={reply} />
      )}
      {onCopy &&
        (expanded ? (
          <ActionButton
            quiet
            onPress={() => {
              void copy();
            }}
          >
            {copied ? "Copied" : "Copy"}
          </ActionButton>
        ) : (
          <IconButton
            icon={copied ? Check : Copy}
            label={copied ? "Message copied" : "Copy message"}
            onPress={() => {
              void copy();
            }}
          />
        ))}
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
  menuActions: { gap: 2 },
  error: { fontSize: 13, color: colors.danger },
  reaction: {
    minWidth: 44,
    minHeight: 36,
    paddingHorizontal: 10,
    borderRadius: 22,
    backgroundColor: colors.wash,
    alignItems: "center",
    justifyContent: "center",
  },
  emoji: { fontSize: 22 },
});
