import { useEffect, useRef, useState } from "react";
import { Pressable, StyleSheet, Text, TextInput, View } from "react-native";
import {
  Check,
  Ellipsis,
  MessageCircle,
  Pin,
  PinOff,
  Pencil,
  Archive,
  ArchiveRestore,
  X,
} from "lucide-react-native";
import type { z } from "zod";
import { IconButton } from "../icon-button";
import { CompanionSheet } from "../sheet";
import { pageStyles } from "../page";
import { colors } from "../theme";
import { chatTitleSchema, type ChatData, type chatPageSchema } from "./schema";

export function ConversationRow({
  chat,
  onOpen,
  onChange,
  dense = false,
  selected = false,
}: {
  readonly chat: z.infer<typeof chatPageSchema>["items"][number];
  readonly onOpen: (id: string) => void;
  readonly onChange: ChatData["change"];
  readonly dense?: boolean;
  readonly selected?: boolean;
}) {
  const [menu, setMenu] = useState(false);
  const [renaming, setRenaming] = useState(false);
  const [pending, setPending] = useState(false);
  const [error, setError] = useState<string>();
  const change = async (next: Parameters<ChatData["change"]>[0]["change"]) => {
    setPending(true);
    setError(undefined);
    try {
      await onChange({ sessionId: chat.sessionId, change: next });
      setMenu(false);
      setRenaming(false);
    } catch {
      setError("Couldn’t save the change. Try again.");
    } finally {
      setPending(false);
    }
  };
  return (
    <View>
      <View
        style={[
          pageStyles.row,
          dense && styles.dense,
          selected && styles.selected,
        ]}
      >
        {chat.pinned ? (
          <Pin size={22} color={colors.ink} />
        ) : !dense ? (
          <MessageCircle size={22} color={colors.muted} />
        ) : null}
        {renaming ? (
          <ConversationName
            initialTitle={chat.title}
            pending={pending}
            onSave={(title) => {
              void change({ title });
            }}
            onCancel={() => {
              setRenaming(false);
              setError(undefined);
            }}
          />
        ) : (
          <>
            <Pressable
              accessibilityRole="button"
              aria-pressed={selected}
              onPress={() => {
                onOpen(chat.sessionId);
              }}
              onLongPress={() => {
                setMenu(true);
              }}
              style={pageStyles.rowCopy}
            >
              <ConversationPreview chat={chat} dense={dense} />
            </Pressable>
            <IconButton
              icon={Ellipsis}
              label={`Options for ${chat.title}`}
              onPress={() => {
                setError(undefined);
                setMenu(true);
              }}
            />
          </>
        )}
      </View>
      {error && !menu && (
        <Text accessibilityRole="alert" style={styles.error}>
          {error}
        </Text>
      )}
      {menu && (
        <CompanionSheet
          title={chat.title}
          onClose={() => {
            if (!pending) setMenu(false);
          }}
        >
          {[
            {
              label: chat.pinned ? "Unpin" : "Pin",
              icon: chat.pinned ? PinOff : Pin,
              press: () => {
                void change({ pinned: !chat.pinned });
              },
            },
            {
              label: "Rename",
              icon: Pencil,
              press: () => {
                setMenu(false);
                setRenaming(true);
              },
            },
            {
              label: chat.archived ? "Restore conversation" : "Archive",
              icon: chat.archived ? ArchiveRestore : Archive,
              press: () => {
                void change({ archived: !chat.archived });
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
          {error && (
            <Text accessibilityRole="alert" style={styles.error}>
              {error}
            </Text>
          )}
        </CompanionSheet>
      )}
    </View>
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
  const [title, setTitle] = useState(initialTitle);
  const renameInput = useRef<TextInput>(null);
  useEffect(() => {
    renameInput.current?.focus();
  }, []);
  return (
    <View style={styles.rename}>
      <TextInput
        ref={renameInput}
        accessibilityLabel="Conversation name"
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
        label="Cancel conversation rename"
        disabled={pending}
        onPress={onCancel}
      />
      <IconButton
        icon={Check}
        label="Save conversation name"
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
}: Pick<Parameters<typeof ConversationRow>[0], "chat" | "dense">) {
  return (
    <>
      <Text
        style={[pageStyles.rowTitle, dense && styles.denseTitle]}
        numberOfLines={dense ? 1 : 2}
      >
        {chat.title}
      </Text>
      {!dense && (
        <Text style={pageStyles.copy}>
          {new Date(chat.updatedAt).toLocaleString()}
        </Text>
      )}
    </>
  );
}

const styles = StyleSheet.create({
  dense: {
    paddingVertical: 0,
    paddingLeft: 8,
    minHeight: 44,
    gap: 6,
    borderRadius: 12,
  },
  denseTitle: { fontSize: 14, fontWeight: "400" },
  selected: { backgroundColor: colors.wash },
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
    fontSize: 16,
    color: colors.ink,
    backgroundColor: colors.wash,
    padding: 12,
    borderRadius: 12,
  },
  error: { color: colors.danger, fontSize: 14, marginBottom: 12 },
});
