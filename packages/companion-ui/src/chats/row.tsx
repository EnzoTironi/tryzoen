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
}: {
  readonly chat: z.infer<typeof chatPageSchema>["items"][number];
  readonly onOpen: (id: string) => void;
  readonly onChange: ChatData["change"];
}) {
  const [menu, setMenu] = useState(false);
  const [renaming, setRenaming] = useState(false);
  const [title, setTitle] = useState(chat.title);
  const [pending, setPending] = useState(false);
  const [error, setError] = useState<string>();
  const renameInput = useRef<TextInput>(null);
  useEffect(() => {
    // Rename is explicit: place focus in the field only when that action opens it.
    if (renaming) renameInput.current?.focus();
  }, [renaming]);
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
      <View style={pageStyles.row}>
        {chat.pinned ? (
          <Pin size={22} color={colors.ink} />
        ) : (
          <MessageCircle size={22} color={colors.muted} />
        )}
        {renaming ? (
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
                  void change({ title });
              }}
              style={styles.input}
            />
            <IconButton
              icon={X}
              label="Cancel conversation rename"
              disabled={pending}
              onPress={() => {
                setRenaming(false);
                setError(undefined);
              }}
            />
            <IconButton
              icon={Check}
              label="Save conversation name"
              disabled={pending || !chatTitleSchema.safeParse(title).success}
              onPress={() => {
                void change({ title });
              }}
            />
          </View>
        ) : (
          <>
            <Pressable
              accessibilityRole="button"
              onPress={() => {
                onOpen(chat.sessionId);
              }}
              onLongPress={() => {
                setMenu(true);
              }}
              style={pageStyles.rowCopy}
            >
              <Text style={pageStyles.rowTitle} numberOfLines={2}>
                {chat.title}
              </Text>
              <Text style={pageStyles.copy}>
                {new Date(chat.updatedAt).toLocaleString()}
              </Text>
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
                setTitle(chat.title);
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
const styles = StyleSheet.create({
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
