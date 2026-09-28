import { useEffect, useRef, useState } from "react";
import { useMutation } from "@tanstack/react-query";
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
  Download,
  X,
} from "lucide-react-native";
import type { z } from "zod";
import { IconButton } from "../icon-button";
import { CompanionSheet } from "../sheet";
import { pageStyles } from "../page";
import { ConversationAvatar } from "./avatar";
import { colors } from "../theme";
import { chatTitleSchema, type ChatData, type chatPageSchema } from "./schema";

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
  const [menu, setMenu] = useState(false);
  const [renaming, setRenaming] = useState(false);
  const operation = useMutation({
    mutationFn: async (next: ConversationAction) => {
      if (next === "export") return onExport(chat.sessionId);
      try {
        await onChange({ sessionId: chat.sessionId, change: next });
      } catch {
        throw new Error("Couldn’t save the change. Try again.");
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
      <View
        style={[
          pageStyles.row,
          dense && styles.dense,
          selected && styles.selected,
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
                operation.reset();
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
  return (
    <CompanionSheet title={chat.title} onClose={onClose}>
      {[
        {
          label: chat.pinned ? "Unpin" : "Pin",
          icon: chat.pinned ? PinOff : Pin,
          press: () => {
            onAction({ pinned: !chat.pinned });
          },
        },
        {
          label: "Rename",
          icon: Pencil,
          press: onRename,
        },
        {
          label: "Export conversation archive",
          icon: Download,
          press: () => {
            onAction("export");
          },
        },
        {
          label: chat.archived ? "Restore conversation" : "Archive",
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
        Exports include messages already saved to your private archive.
        Attachments are separate.
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
      {dense && (
        <Text numberOfLines={1} style={pageStyles.copy}>
          Zoen ·{" "}
          {new Date(chat.updatedAt).toLocaleDateString([], {
            day: "numeric",
            month: "short",
          })}
        </Text>
      )}
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
    paddingVertical: 12,
    paddingLeft: 8,
    minHeight: 76,
    gap: 12,
    borderRadius: 12,
  },
  denseTitle: { fontSize: 15, fontWeight: "600" },
  selected: { backgroundColor: "#e8f2ff" },
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
