import { useI18n } from "./i18n";
import {
  useMemo,
  lazy,
  Suspense,
  useState,
  type ComponentProps,
  type ReactNode,
} from "react";
import { Pressable, StyleSheet, Text, View } from "react-native";
import {
  Copy,
  Reply,
  Ellipsis,
  Forward,
  Bookmark,
  Pencil,
  Trash2,
  Flag,
  MessageCircle,
  Smile,
  Pin,
  Mail,
  Link,
  type LucideIcon,
} from "lucide-react-native";
import { systemFont, useColors } from "./theme";
import { useMessageInteraction } from "./conversation/interaction";

const ReactionPicker = lazy(() => import("./reactions/picker"));

export function MessageActions({
  text,
  outgoing,
  onCopy,
  onReply,
  reaction,
  reactionCount,
  reactionSummary,
  onReact,
  onDelete,
  onReport,
  onEdit,
  onSave,
  onForward,
  onThread,
  onViewReactions,
  onPin,
  onUnread,
  messageLink,
}: {
  readonly messageLink?: string;
  readonly onForward?: () => void;
  readonly onSave?: () => void;
  readonly onEdit?: () => void;
  readonly onDelete?: () => void;
  readonly onReport?: () => void;
  readonly onThread?: () => void;
  readonly onViewReactions?: () => void;
  readonly onUnread?: () => void;
  readonly onPin?: () => void;
  readonly text: string;
  readonly outgoing: boolean;
  readonly onCopy?: (text: string) => Promise<void>;
  readonly onReply: () => void;
  readonly reaction?: string | null;
  readonly reactionCount?: number;
  readonly reactionSummary?: ReactNode;
  readonly onReact?: (emoji: string | null) => Promise<void>;
}) {
  const { t } = useI18n();
  const colors = useColors();
  const styles = useMemo(() => createStyles(colors), [colors]);
  const interaction = useMessageInteraction();
  const [focused, setFocused] = useState(false);
  const [copyError, setCopyError] = useState(false);
  if (!interaction) return null;
  const { anchor, open, close } = interaction;
  const copy = onCopy
    ? async (value: string) => {
        setCopyError(false);
        try {
          await onCopy(value);
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
        accessibilityLabel={t("Message actions")}
        accessibilityHint={t(
          "Reply, react, copy and more. You can also hold the message or swipe right to reply."
        )}
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
      <View style={styles.reactionDock}>
        {reactionSummary ??
          (reaction && onReact && (
            <Pressable
              accessibilityRole="button"
              accessibilityLabel={t(
                "Your reaction {value1}{value2}. {value3}",
                {
                  value1: reaction,
                  value2: reactionCount ? `, ${reactionCount} reactions` : "",
                  value3: onViewReactions
                    ? t("View reactions")
                    : t("Change or remove reaction"),
                }
              )}
              onPress={onViewReactions ?? open}
              style={styles.reaction}
              hitSlop={{ top: 7, bottom: 7 }}
            >
              <Text style={styles.emoji}>{reaction}</Text>
              {reactionCount !== undefined && (
                <Text style={styles.count}>{reactionCount}</Text>
              )}
            </Pressable>
          ))}
      </View>
      {anchor && (
        <Suspense fallback={null}>
          <ReactionPicker
            anchor={anchor}
            outgoing={outgoing}
            selected={reaction}
            onSelect={
              interaction.react
                ? (emoji) => {
                    interaction.react?.(emoji);
                    return Promise.resolve();
                  }
                : onReact
            }
            onClose={close}
          >
            <MessageMenuGroup
              onClose={close}
              items={[
                {
                  icon: Smile,
                  label: t("Ver reações"),
                  onPress: onViewReactions,
                },
              ]}
            />
            <View style={styles.group}>
              <MessageMenuGroup
                onClose={close}
                items={[
                  { icon: Reply, label: t("Responder"), onPress: onReply },
                  {
                    icon: MessageCircle,
                    label: t("Responder na thread"),
                    onPress: onThread,
                  },
                  { icon: Forward, label: t("Encaminhar"), onPress: onForward },
                ]}
              />
            </View>
            <View style={styles.group}>
              {copy && text.trim() && (
                <MessageMenuItem
                  icon={Copy}
                  label={t("Copiar texto")}
                  onPress={() => {
                    void copy(text);
                  }}
                />
              )}
              {copy && messageLink && (
                <MessageMenuItem
                  icon={Link}
                  label={t("Copiar link da mensagem")}
                  onPress={() => {
                    void copy(messageLink);
                  }}
                />
              )}
              <MessageMenuGroup
                onClose={close}
                items={[
                  {
                    icon: Mail,
                    label: t("Marcar como não lida"),
                    onPress: onUnread,
                  },
                  { icon: Pin, label: t("Fixar / desafixar"), onPress: onPin },
                  {
                    icon: Bookmark,
                    label: t("Salvar mensagem"),
                    onPress: onSave,
                  },
                  {
                    icon: Pencil,
                    label: t("Editar mensagem"),
                    onPress: onEdit,
                  },
                ]}
              />
            </View>
            {(onDelete ?? onReport) && (
              <View style={styles.divider}>
                <MessageMenuGroup
                  onClose={close}
                  items={[
                    {
                      icon: Flag,
                      label: t("Denunciar mensagem"),
                      onPress: onReport,
                      destructive: true,
                    },
                    {
                      icon: Trash2,
                      label: t("Excluir mensagem"),
                      onPress: onDelete,
                      destructive: true,
                    },
                  ]}
                />
              </View>
            )}
            {copyError && (
              <Text accessibilityRole="alert" style={styles.error}>
                {t("Não foi possível copiar. Tente novamente.")}
              </Text>
            )}
          </ReactionPicker>
        </Suspense>
      )}
    </View>
  );
}

function MessageMenuGroup({
  items,
  onClose,
}: {
  readonly items: readonly (Omit<
    ComponentProps<typeof MessageMenuItem>,
    "onPress"
  > & { readonly onPress?: () => void })[];
  readonly onClose: () => void;
}) {
  return items.map(({ onPress, ...item }) =>
    onPress ? (
      <MessageMenuItem
        key={item.label}
        {...item}
        onPress={() => {
          onClose();
          onPress();
        }}
      />
    ) : null
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
  const colors = useColors();
  const styles = useMemo(() => createStyles(colors), [colors]);
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
function createStyles(colors: ReturnType<typeof useColors>) {
  return StyleSheet.create({
    actions: {
      position: "static",
      flexDirection: "row",
      alignItems: "center",
      gap: 4,
    },
    more: {
      position: "absolute",
      right: 2,
      bottom: -4,
      width: 28,
      height: 28,
      borderRadius: 14,
      backgroundColor: colors.surface,
      alignItems: "center",
      justifyContent: "center",
      zIndex: 2,
      boxShadow: "0 1px 5px rgba(0,0,0,0.06)",
    },
    outgoing: { backgroundColor: colors.incoming },
    hidden: { opacity: 0 },
    reactionDock: { position: "absolute", top: -18, right: -4, zIndex: 4 },
    reaction: {
      flexDirection: "row",
      gap: 3,
      paddingHorizontal: 7,
      minHeight: 30,
      borderRadius: 18,
      borderWidth: 2,
      borderColor: colors.canvas,
      backgroundColor: colors.outgoing,
      alignItems: "center",
      justifyContent: "center",
    },
    emoji: { fontFamily: systemFont, fontSize: 17 },
    count: {
      fontFamily: systemFont,
      color: colors.selectedInk,
      fontSize: 12,
      fontWeight: "500",
    },
    item: {
      minHeight: 44,
      flexDirection: "row",
      alignItems: "center",
      justifyContent: "space-between",
      gap: 20,
      paddingHorizontal: 12,
      paddingVertical: 8,
      borderRadius: 12,
    },
    label: {
      fontFamily: systemFont,
      color: colors.ink,
      fontSize: 16,
      lineHeight: 22,
    },
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
    error: { fontFamily: systemFont, fontSize: 13, color: colors.danger },
  });
}
