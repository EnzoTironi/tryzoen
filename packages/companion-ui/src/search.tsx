import type { ComponentProps } from "react";
import { Pressable, Text, TextInput, View } from "react-native";
import { MessageCircle, Plus } from "lucide-react-native";
import { CompanionPage, pageStyles } from "./page";
import { IconButton } from "./icon-button";
import { ActionButton } from "./button";
import { colors } from "./theme";
export function ConversationSearch({
  items,
  query,
  onQuery,
  onOpen,
  onCreate,
  onLoadMore,
  ...state
}: Omit<ComponentProps<typeof CompanionPage>, "title" | "children"> & {
  readonly items: readonly { id: string; title: string; description: string }[];
  readonly query: string;
  readonly onQuery: (query: string) => void;
  readonly onOpen: (id: string) => void;
  readonly onCreate: () => void;
  readonly onLoadMore?: () => void;
}) {
  return (
    <CompanionPage
      title="Conversations"
      actions={
        <IconButton icon={Plus} label="New conversation" onPress={onCreate} />
      }
      {...state}
    >
      <TextInput
        accessibilityLabel="Search conversations"
        placeholder="Search conversations"
        value={query}
        onChangeText={onQuery}
        style={pageStyles.field}
      />
      {items.map((item) => (
        <Pressable
          accessibilityRole="button"
          key={item.id}
          onPress={() => {
            onOpen(item.id);
          }}
          style={pageStyles.row}
        >
          <MessageCircle size={22} color={colors.muted} />
          <View style={pageStyles.rowCopy}>
            <Text style={pageStyles.rowTitle}>{item.title}</Text>
            <Text style={pageStyles.copy}>{item.description}</Text>
          </View>
        </Pressable>
      ))}
      {!state.loading && !state.error && items.length === 0 && (
        <Text style={pageStyles.copy}>
          {query
            ? "No conversations match your search."
            : "Start a conversation. You can return to it here anytime."}
        </Text>
      )}
      {onLoadMore && (
        <ActionButton quiet onPress={onLoadMore}>
          Load more
        </ActionButton>
      )}
    </CompanionPage>
  );
}
