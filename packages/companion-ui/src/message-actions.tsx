import { lazy, Suspense, useState, type ComponentProps } from "react";
import {
  ActivityIndicator,
  Pressable,
  StyleSheet,
  Text,
  View,
} from "react-native";
import { Check, Copy, Reply, SmilePlus, Ellipsis } from "lucide-react-native";
import { IconButton } from "./icon-button";
import { colors } from "./theme";
import { ActionButton } from "./button";

const ReactionPicker = lazy(() => import("./reactions/picker"));

export function MessageActions({
  text,
  outgoing,
  onCopy,
  onReply,
  reaction,
  reactionCount,
  onReact,
  onDelete,
}: {
  readonly onDelete?: () => void;
  readonly text: string;
  readonly outgoing: boolean;
  readonly onCopy?: (text: string) => Promise<void>;
  readonly onReply: () => void;
  readonly reaction?: string | null;
  readonly reactionCount?: number;
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
            accessibilityLabel={`Your reaction ${reaction}${reactionCount ? `, ${reactionCount} reactions` : ""}. Change or remove reaction`}
            onPress={() => {
              setMenu(true);
            }}
            style={styles.reaction}
          >
            <Text style={styles.emoji}>{reaction}</Text>
            {reactionCount !== undefined && (
              <Text style={styles.count}>{reactionCount}</Text>
            )}
          </Pressable>
        ) : (
          <IconButton
            icon={outgoing ? Ellipsis : SmilePlus}
            label={onDelete ? "Message actions" : "React to message"}
            onPress={() => {
              setMenu(true);
            }}
          />
        ))}
      <TextMessageActions text={text} onCopy={onCopy} onReply={onReply} />
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
              text={text}
              onCopy={onCopy}
              onReply={onReply}
              expanded
              onDone={close}
            />
            {onDelete && (
              <ActionButton
                quiet
                onPress={() => {
                  close();
                  onDelete();
                }}
              >
                Excluir mensagem
              </ActionButton>
            )}
          </ReactionPicker>
        </Suspense>
      )}
    </View>
  );
}
function TextMessageActions({
  text,
  onCopy,
  onReply,
  expanded = false,
  onDone,
}: Pick<
  ComponentProps<typeof MessageActions>,
  "text" | "onCopy" | "onReply"
> & {
  readonly expanded?: boolean;
  readonly onDone?: () => void;
}) {
  const [copied, setCopied] = useState(false);
  const [error, setError] = useState(false);
  if (!text.trim()) return null;
  const reply = () => {
    onReply();
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
  count: { color: colors.ink, fontSize: 12, fontWeight: "500" },
  reaction: {
    flexDirection: "row",
    gap: 4,
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
