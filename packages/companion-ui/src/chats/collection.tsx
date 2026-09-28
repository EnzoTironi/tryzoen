import { useDeferredValue, useState } from "react";
import { useInfiniteQuery, useQueryClient } from "@tanstack/react-query";
import { StyleSheet, Text, TextInput, View } from "react-native";
import { Archive, ArrowLeft, Plus } from "lucide-react-native";
import { CompanionPage, pageStyles } from "../page";
import { IconButton } from "../icon-button";
import { ActionButton } from "../button";
import { ConversationRow } from "./row";
import type { ChatData, chatPageSchema } from "./schema";
import type { z } from "zod";

export function ConversationSearch({
  data,
  cacheScope,
  onOpen,
  onCreate,
  title = "Conversations",
  intro,
}: {
  readonly data: ChatData;
  readonly cacheScope: string;
  readonly onOpen: (id: string) => void;
  readonly onCreate?: () => void;
  readonly title?: string;
  readonly intro?: string;
}) {
  const client = useQueryClient();
  const [query, setQuery] = useState("");
  const [archived, setArchived] = useState(false);
  const search = useDeferredValue(query);
  const key = ["conversation-library", cacheScope];
  const chats = useInfiniteQuery({
    queryKey: [...key, archived, search],
    initialPageParam: null as z.infer<typeof chatPageSchema>["nextCursor"],
    queryFn: ({ pageParam }) =>
      data.list({ query: search, archived, cursor: pageParam }),
    getNextPageParam: (last) => last.nextCursor,
  });
  const items = chats.data?.pages.flatMap((page) => page.items) ?? [];
  const change: ChatData["change"] = async (input) => {
    await data.change(input);
    await client.invalidateQueries({ queryKey: key });
  };
  return (
    <CompanionPage
      title={archived ? "Archived conversations" : title}
      loading={chats.isPending || chats.isFetchingNextPage}
      error={chats.error?.message}
      onRetry={() => {
        void chats.refetch();
      }}
      actions={
        <View style={styles.actions}>
          <IconButton
            icon={archived ? ArrowLeft : Archive}
            label={
              archived ? "Back to conversations" : "Show archived conversations"
            }
            onPress={() => {
              setArchived(!archived);
              setQuery("");
            }}
          />
          {!archived && onCreate && (
            <IconButton
              icon={Plus}
              label="New conversation"
              onPress={onCreate}
            />
          )}
        </View>
      }
    >
      {intro && !archived && <Text style={pageStyles.copy}>{intro}</Text>}
      <TextInput
        accessibilityLabel="Search conversations"
        placeholder="Search conversations"
        value={query}
        onChangeText={setQuery}
        maxLength={200}
        style={pageStyles.field}
      />
      {items.map((chat) => (
        <ConversationRow
          key={chat.sessionId}
          chat={chat}
          onOpen={onOpen}
          onChange={change}
        />
      ))}
      {!chats.isPending && !chats.error && items.length === 0 && (
        <Text style={pageStyles.copy}>
          {search
            ? "No conversations match your search."
            : archived
              ? "No archived conversations. Conversations you archive will appear here."
              : "Start a conversation. You can return to it here anytime."}
        </Text>
      )}
      {chats.hasNextPage && (
        <ActionButton
          quiet
          disabled={chats.isFetchingNextPage}
          onPress={() => {
            void chats.fetchNextPage();
          }}
        >
          Load more
        </ActionButton>
      )}
    </CompanionPage>
  );
}
const styles = StyleSheet.create({ actions: { flexDirection: "row", gap: 8 } });
