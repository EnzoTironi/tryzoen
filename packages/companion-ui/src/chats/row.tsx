import { useI18n } from "./../i18n";
import {
  useEffect,
  useMemo,
  useRef,
  useState,
  type MouseEvent,
  type KeyboardEvent,
} from "react";
import { useMutation } from "@tanstack/react-query";
import {
  Platform,
  Pressable,
  StyleSheet,
  Text,
  TextInput,
  useWindowDimensions,
  View,
} from "react-native";
import {
  Check,
  Ellipsis,
  MessageCircle,
  Pin,
  PinOff,
  Pencil,
  Archive,
  ArchiveRestore,
  Download,
  X,
  ChevronRight,
} from "lucide-react-native";
import type { z } from "zod";
import { IconButton } from "../icon-button";
import { CompanionSheet } from "../sheet";
import { usePageStyles } from "../page";
import { ConversationAvatar } from "./avatar";
import { systemFont, useColors } from "../theme";
import { chatTitleSchema, type ChatData, type chatPageSchema } from "./schema";
import { conversationTime } from "./time";

type ConversationAction =
  | Parameters<ChatData["change"]>[0]["change"]
  | "export";

export function ConversationRow({
  chat,
  onOpen,
  onChange,
  onExport,
  dense = false,
  avatarUri,
  selected = false,
}: {
  readonly chat: z.infer<typeof chatPageSchema>["items"][number];
  readonly onOpen: (id: string) => void;
  readonly onChange: ChatData["change"];
  readonly onExport: (sessionId: string) => Promise<void>;
  readonly dense?: boolean;
  readonly avatarUri?: string;
  readonly selected?: boolean;
}) {
  const { t } = useI18n();
  const compact = useWindowDimensions().width < 720;
  const pageStyles = usePageStyles();
  const colors = useColors();
  const styles = useMemo(() => createStyles(colors), [colors]);
  const highlighted = selected && !compact;
  const [menu, setMenu] = useState(false);
  const [renaming, setRenaming] = useState(false);
  const operation = useMutation({
    mutationFn: async (next: ConversationAction) => {
      if (next === "export") return onExport(chat.sessionId);
      try {
        await onChange({ sessionId: chat.sessionId, change: next });
      } catch {
        throw new Error(t("Couldn’t save the change. Try again."));
      }
    },
    onSuccess: () => {
      setMenu(false);
      setRenaming(false);
    },
  });
  const pending = operation.isPending;
  const error = operation.error?.message;
  return (
    <View>
      {dense && !renaming ? (
        <Pressable
          accessibilityRole="button"
          accessibilityState={{ selected: highlighted }}
          accessibilityHint={t(
            "Mantenha pressionado para ver as opções da conversa"
          )}
          accessibilityActions={[
            { name: "longpress", label: t("Opções da conversa") },
          ]}
          onAccessibilityAction={({ nativeEvent }) => {
            if (nativeEvent.actionName === "longpress") {
              operation.reset();
              setMenu(true);
            }
          }}
          onPress={() => {
            onOpen(chat.sessionId);
          }}
          onLongPress={() => {
            operation.reset();
            setMenu(true);
          }}
          {...(Platform.OS === "web"
            ? {
                onContextMenu: (event: MouseEvent) => {
                  event.preventDefault();
                  operation.reset();
                  setMenu(true);
                },
                onKeyDown: (event: KeyboardEvent) => {
                  if (
                    (event.shiftKey && event.key === "F10") ||
                    event.key === "ContextMenu"
                  ) {
                    event.preventDefault();
                    operation.reset();
                    setMenu(true);
                  }
                },
              }
            : {})}
          style={({ pressed }) => [
            styles.dense,
            highlighted && styles.selected,
            pressed && !highlighted && styles.pressed,
          ]}
        >
          <View style={styles.leadingSpace} />
          <ConversationAvatar name={chat.title} uri={avatarUri} />
          <View style={styles.preview}>
            <ConversationPreview chat={chat} dense selected={highlighted} />
          </View>
          {compact && <ChevronRight size={14} color={colors.muted} />}
        </Pressable>
      ) : (
        <View
          style={[
            pageStyles.row,
            dense && styles.dense,
            highlighted && styles.selected,
          ]}
        >
          {dense ? (
            <ConversationAvatar name={chat.title} uri={avatarUri} />
          ) : chat.pinned ? (
            <Pin size={22} color={colors.ink} />
          ) : (
            <MessageCircle size={22} color={colors.muted} />
          )}
          {renaming ? (
            <ConversationName
              initialTitle={chat.title}
              pending={pending}
              onSave={(title) => {
                operation.mutate({ title });
              }}
              onCancel={() => {
                setRenaming(false);
                operation.reset();
              }}
            />
          ) : (
            <>
              <Pressable
                accessibilityRole="button"
                accessibilityState={{ selected }}
                onPress={() => {
                  onOpen(chat.sessionId);
                }}
                onLongPress={() => {
                  operation.reset();
                  setMenu(true);
                }}
                style={pageStyles.rowCopy}
              >
                <ConversationPreview
                  chat={chat}
                  dense={dense}
                  selected={highlighted}
                />
              </Pressable>
              <IconButton
                icon={Ellipsis}
                label={t("Options for {value1}", { value1: chat.title })}
                onPress={() => {
                  operation.reset();
                  setMenu(true);
                }}
              />
            </>
          )}
        </View>
      )}
      {error && !menu && (
        <Text accessibilityRole="alert" style={styles.error}>
          {error}
        </Text>
      )}
      {menu && (
        <ConversationMenu
          chat={chat}
          pending={pending}
          error={error}
          onAction={operation.mutate}
          onClose={() => {
            if (!pending) setMenu(false);
          }}
          onRename={() => {
            setMenu(false);
            setRenaming(true);
          }}
        />
      )}
    </View>
  );
}
function ConversationMenu({
  chat,
  pending,
  error,
  onAction,
  onClose,
  onRename,
}: Pick<Parameters<typeof ConversationRow>[0], "chat"> & {
  readonly pending: boolean;
  readonly error?: string;
  readonly onAction: (action: ConversationAction) => void;
  readonly onClose: () => void;
  readonly onRename: () => void;
}) {
  const { t } = useI18n();
  const pageStyles = usePageStyles();
  const colors = useColors();
  const styles = useMemo(() => createStyles(colors), [colors]);
  return (
    <CompanionSheet title={chat.title} onClose={onClose}>
      {[
        {
          label: chat.pinned ? t("Unpin") : t("Pin"),
          icon: chat.pinned ? PinOff : Pin,
          press: () => {
            onAction({ pinned: !chat.pinned });
          },
        },
        {
          label: t("Rename"),
          icon: Pencil,
          press: onRename,
        },
        {
          label: t("Export conversation archive"),
          icon: Download,
          press: () => {
            onAction("export");
          },
        },
        {
          label: chat.archived ? t("Restore conversation") : t("Archive"),
          icon: chat.archived ? ArchiveRestore : Archive,
          press: () => {
            onAction({ archived: !chat.archived });
          },
        },
      ].map(({ label, icon: Icon, press }) => (
        <Pressable
          key={label}
          accessibilityRole="button"
          disabled={pending}
          aria-disabled={pending}
          onPress={press}
          style={({ pressed }) => [
            pageStyles.row,
            (pressed || pending) && styles.dimmed,
          ]}
        >
          <Icon size={24} strokeWidth={1.8} color={colors.ink} />
          <Text style={pageStyles.rowTitle}>{label}</Text>
        </Pressable>
      ))}
      <Text style={pageStyles.copy}>
        {t(
          "Exports include messages already saved to your private archive. Attachments are separate."
        )}
      </Text>
      {error && (
        <Text accessibilityRole="alert" style={styles.error}>
          {error}
        </Text>
      )}
    </CompanionSheet>
  );
}
function ConversationName({
  initialTitle,
  pending,
  onSave,
  onCancel,
}: {
  readonly initialTitle: string;
  readonly pending: boolean;
  readonly onSave: (title: string) => void;
  readonly onCancel: () => void;
}) {
  const { t } = useI18n();
  const colors = useColors();
  const styles = useMemo(() => createStyles(colors), [colors]);
  const [title, setTitle] = useState(initialTitle);
  const renameInput = useRef<TextInput>(null);
  useEffect(() => {
    renameInput.current?.focus();
  }, []);
  return (
    <View style={styles.rename}>
      <TextInput
        ref={renameInput}
        accessibilityLabel={t("Conversation name")}
        value={title}
        onChangeText={setTitle}
        maxLength={240}
        editable={!pending}
        onSubmitEditing={() => {
          if (!pending && chatTitleSchema.safeParse(title).success)
            onSave(title);
        }}
        style={styles.input}
      />
      <IconButton
        icon={X}
        label={t("Cancel conversation rename")}
        disabled={pending}
        onPress={onCancel}
      />
      <IconButton
        icon={Check}
        label={t("Save conversation name")}
        disabled={pending || !chatTitleSchema.safeParse(title).success}
        onPress={() => {
          onSave(title);
        }}
      />
    </View>
  );
}
function ConversationPreview({
  chat,
  dense,
  selected,
}: Pick<Parameters<typeof ConversationRow>[0], "chat" | "dense" | "selected">) {
  const { t, locale } = useI18n();
  const pageStyles = usePageStyles();
  const colors = useColors();
  const styles = useMemo(() => createStyles(colors), [colors]);
  const time = conversationTime(chat.updatedAt, new Date(), locale);
  return dense ? (
    <>
      <View style={styles.titleLine}>
        <Text
          style={[styles.denseTitle, selected && styles.selectedText]}
          numberOfLines={1}
        >
          {chat.title}
        </Text>
        {chat.pinned && (
          <Pin size={12} color={selected ? colors.selectedInk : colors.muted} />
        )}
        {time && (
          <Text
            numberOfLines={1}
            style={[styles.time, selected && styles.selectedText]}
            accessibilityLabel={time.description}
          >
            {time.label}
          </Text>
        )}
      </View>
      <Text
        numberOfLines={2}
        style={[styles.caption, selected && styles.selectedText]}
      >
        {t("Conversa com Zoen")}
      </Text>
    </>
  ) : (
    <>
      <Text style={pageStyles.rowTitle} numberOfLines={2}>
        {chat.title}
      </Text>
      {time && <Text style={pageStyles.copy}>{time.description}</Text>}
    </>
  );
}

const createStyles = (palette: ReturnType<typeof useColors>) =>
  StyleSheet.create({
    dense: {
      flexDirection: "row",
      alignItems: "center",
      paddingVertical: 12,
      paddingRight: 12,
      minHeight: 84,
      gap: 8,
      borderRadius: 9,
    },
    leadingSpace: { width: 8 },
    preview: { flex: 1, minWidth: 0, gap: 3 },
    titleLine: { flexDirection: "row", alignItems: "center", gap: 6 },
    denseTitle: {
      flex: 1,
      minWidth: 0,
      fontFamily: systemFont,
      color: palette.ink,
      fontSize: 16,
      fontWeight: "600",
    },
    time: { fontFamily: systemFont, color: palette.muted, fontSize: 12 },
    caption: {
      fontFamily: systemFont,
      color: palette.muted,
      fontSize: 15,
      lineHeight: 20,
    },
    selected: { backgroundColor: palette.selection },
    selectedText: { color: palette.selectedInk },
    pressed: { backgroundColor: palette.wash },
    dimmed: { opacity: 0.5 },
    rename: {
      flex: 1,
      flexDirection: "row",
      alignItems: "center",
      flexWrap: "wrap",
      gap: 4,
    },
    input: {
      minWidth: 120,
      flex: 1,
      fontFamily: systemFont,
      fontSize: 16,
      color: palette.ink,
      backgroundColor: palette.wash,
      padding: 12,
      borderRadius: 12,
    },
    error: {
      fontFamily: systemFont,
      color: palette.danger,
      fontSize: 14,
      marginBottom: 12,
    },
  });
