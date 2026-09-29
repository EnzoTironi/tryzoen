import { lazy, Suspense, useState } from "react";
import { Pressable, StyleSheet, Text, View } from "react-native";
import {
  Copy,
  Reply,
  Ellipsis,
  Forward,
  Bookmark,
  Pencil,
  Trash2,
  MessageCircle,
  type LucideIcon,
} from "lucide-react-native";
import { colors } from "./theme";
import { useMessageInteraction } from "./conversation/interaction";

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
  onEdit,
  onSave,
  onForward,
  onThread,
}: {
  readonly onForward?: () => void;
  readonly onSave?: () => void;
  readonly onEdit?: () => void;
  readonly onDelete?: () => void;
  readonly onThread?: () => void;
  readonly text: string;
  readonly outgoing: boolean;
  readonly onCopy?: (text: string) => Promise<void>;
  readonly onReply: () => void;
  readonly reaction?: string | null;
  readonly reactionCount?: number;
  readonly onReact?: (emoji: string | null) => Promise<void>;
}) {
  const interaction = useMessageInteraction();
  const [focused, setFocused] = useState(false);
  const [copyError, setCopyError] = useState(false);
  if (!interaction) return null;
  const { anchor, open, close } = interaction;
  const copy =
    onCopy && text.trim()
      ? async () => {
          setCopyError(false);
          try {
            await onCopy(text);
            close();
          } catch {
            setCopyError(true);
          }
        }
      : undefined;
  return (
    <View style={styles.actions}>
      <Pressable
        accessibilityRole="button"
        accessibilityLabel="Message actions"
        accessibilityHint="Reply, react, copy and more. You can also hold the message or swipe right to reply."
        onFocus={() => {
          setFocused(true);
        }}
        onBlur={() => {
          setFocused(false);
        }}
        onPress={open}
        hitSlop={8}
        style={[
          styles.more,
          outgoing && styles.outgoing,
          !(interaction.active || focused) && styles.hidden,
        ]}
      >
        <Ellipsis size={18} color={colors.muted} />
      </Pressable>
      {reaction && onReact && (
        <Pressable
          accessibilityRole="button"
          accessibilityLabel={`Your reaction ${reaction}${reactionCount ? `, ${reactionCount} reactions` : ""}. Change or remove reaction`}
          onPress={open}
          style={styles.reaction}
        >
          <Text style={styles.emoji}>{reaction}</Text>
          {reactionCount !== undefined && (
            <Text style={styles.count}>{reactionCount}</Text>
          )}
        </Pressable>
      )}
      {anchor && (
        <Suspense fallback={null}>
          <ReactionPicker
            anchor={anchor}
            outgoing={outgoing}
            selected={reaction}
            onSelect={onReact}
            onClose={close}
          >
            <View style={styles.group}>
              <MessageMenuItem
                icon={Reply}
                label="Responder"
                onPress={() => {
                  close();
                  onReply();
                }}
              />
              {onThread && (
                <MessageMenuItem
                  icon={MessageCircle}
                  label="Responder na thread"
                  onPress={() => {
                    close();
                    onThread();
                  }}
                />
              )}
              {onForward && (
                <MessageMenuItem
                  icon={Forward}
                  label="Encaminhar"
                  onPress={() => {
                    close();
                    onForward();
                  }}
                />
              )}
            </View>
            <View style={styles.group}>
              {copy && (
                <MessageMenuItem
                  icon={Copy}
                  label="Copiar texto"
                  onPress={() => {
                    void copy();
                  }}
                />
              )}
              {onSave && (
                <MessageMenuItem
                  icon={Bookmark}
                  label="Salvar mensagem"
                  onPress={() => {
                    close();
                    onSave();
                  }}
                />
              )}
              {onEdit && (
                <MessageMenuItem
                  icon={Pencil}
                  label="Editar mensagem"
                  onPress={() => {
                    close();
                    onEdit();
                  }}
                />
              )}
            </View>
            {onDelete && (
              <View style={styles.divider}>
                <MessageMenuItem
                  icon={Trash2}
                  label="Excluir mensagem"
                  destructive
                  onPress={() => {
                    close();
                    onDelete();
                  }}
                />
              </View>
            )}
            {copyError && (
              <Text accessibilityRole="alert" style={styles.error}>
                Não foi possível copiar. Tente novamente.
              </Text>
            )}
          </ReactionPicker>
        </Suspense>
      )}
    </View>
  );
}

function MessageMenuItem({
  icon: Icon,
  label,
  onPress,
  destructive = false,
}: {
  readonly icon: LucideIcon;
  readonly label: string;
  readonly onPress: () => void;
  readonly destructive?: boolean;
}) {
  return (
    <Pressable
      accessibilityRole="button"
      accessibilityLabel={label}
      onPress={onPress}
      style={({ pressed }) => [styles.item, pressed && styles.pressed]}
    >
      <Text style={[styles.label, destructive && styles.error]}>{label}</Text>
      <Icon
        size={18}
        strokeWidth={1.7}
        color={destructive ? colors.danger : colors.ink}
      />
    </Pressable>
  );
}
const styles = StyleSheet.create({
  actions: {
    position: "static",
    flexDirection: "row",
    alignItems: "center",
    gap: 4,
  },
  more: {
    position: "absolute",
    right: 4,
    top: 4,
    width: 28,
    height: 28,
    borderRadius: 14,
    backgroundColor: "rgba(250,250,250,0.95)",
    alignItems: "center",
    justifyContent: "center",
    zIndex: 2,
    boxShadow: "0 1px 5px rgba(0,0,0,0.06)",
  },
  outgoing: { backgroundColor: "rgba(220,234,255,0.97)" },
  hidden: { opacity: 0 },
  reaction: {
    flexDirection: "row",
    gap: 4,
    paddingHorizontal: 7,
    height: 26,
    borderRadius: 14,
    backgroundColor: colors.wash,
    alignItems: "center",
    justifyContent: "center",
    marginTop: 3,
  },
  emoji: { fontSize: 17 },
  count: { color: colors.ink, fontSize: 12, fontWeight: "500" },
  item: {
    minHeight: 44,
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
    gap: 20,
    paddingHorizontal: 12,
    paddingVertical: 8,
    borderRadius: 8,
  },
  label: { color: colors.ink, fontSize: 15, lineHeight: 20 },
  pressed: { backgroundColor: colors.wash },
  group: {
    borderTopWidth: StyleSheet.hairlineWidth,
    borderColor: colors.line,
    paddingVertical: 4,
  },
  divider: {
    borderTopWidth: StyleSheet.hairlineWidth,
    borderColor: colors.line,
    marginTop: 4,
    paddingTop: 4,
  },
  error: { fontSize: 13, color: colors.danger },
});
