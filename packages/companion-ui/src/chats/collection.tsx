import { useDeferredValue, useState, type ComponentProps } from "react";
import { useInfiniteQuery, useQueryClient } from "@tanstack/react-query";
import {
  ActivityIndicator,
  FlatList,
  StyleSheet,
  Text,
  View,
} from "react-native";
import { pageStyles } from "../page";
import { ActionButton } from "../button";
import { colors } from "../theme";
import { ConversationToolbar } from "./toolbar";
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
  selectedId,
  panel,
  onExport,
}: {
  readonly data: ChatData;
  readonly cacheScope: string;
  readonly onOpen: (id: string) => void;
  readonly onCreate?: () => void;
  readonly title?: string;
  readonly intro?: string;
  readonly selectedId?: string;
  readonly panel?: ComponentProps<typeof ConversationToolbar>["panel"];
  readonly onExport: (sessionId: string) => Promise<void>;
}) {
  const client = useQueryClient();
  const [query, setQuery] = useState("");
  const [archived, setArchived] = useState(false);
  const [width, setWidth] = useState(0);
  const search = useDeferredValue(query);
  const key = ["conversation-library", cacheScope];
  const chats = useInfiniteQuery({
    queryKey: [...key, archived, search],
    initialPageParam: null as z.infer<typeof chatPageSchema>["nextCursor"],
    queryFn: ({ pageParam }) =>
      data.list({ query: search, archived, cursor: pageParam }),
    getNextPageParam: (last) => last.nextCursor,
    staleTime: 15_000,
    gcTime: 60_000,
  });
  const items = chats.data?.pages.flatMap((page) => page.items) ?? [];
  const change: ChatData["change"] = async (input) => {
    await data.change(input);
    await client.invalidateQueries({ queryKey: key });
  };
  const toggleArchive = () => {
    setArchived(!archived);
    setQuery("");
  };
  return (
    <View
      onLayout={({ nativeEvent }) => {
        setWidth(nativeEvent.layout.width);
      }}
      style={[styles.page, width >= 720 && styles.wide, panel && styles.panel]}
    >
      <ConversationToolbar
        title={title}
        intro={intro}
        query={query}
        onQuery={setQuery}
        archived={archived}
        onToggleArchive={toggleArchive}
        onCreate={onCreate}
        panel={panel}
      />
      <FlatList
        key={panel ? "panel" : "page"}
        data={items}
        keyExtractor={(chat) => chat.sessionId}
        initialNumToRender={12}
        maxToRenderPerBatch={12}
        windowSize={5}
        keyboardShouldPersistTaps="handled"
        style={styles.list}
        renderItem={({ item }) => (
          <ConversationRow
            chat={item}
            onOpen={onOpen}
            onChange={change}
            onExport={onExport}
            dense={Boolean(panel)}
            selected={item.sessionId === selectedId}
          />
        )}
        ListEmptyComponent={
          !chats.isPending && !chats.error ? (
            <Text style={pageStyles.copy}>
              {search
                ? "No conversations match your search."
                : archived
                  ? "No archived conversations. Conversations you archive will appear here."
                  : "Start a conversation. You can return to it here anytime."}
            </Text>
          ) : null
        }
        ListFooterComponent={
          <View style={styles.feedback}>
            {chats.isFetching && (
              <ActivityIndicator
                accessibilityLabel="Loading conversations"
                color={colors.accent}
              />
            )}
            {chats.error && (
              <>
                <Text accessibilityRole="alert" style={styles.error}>
                  {chats.error.message}
                </Text>
                <ActionButton
                  quiet
                  onPress={() => {
                    void chats.refetch();
                  }}
                >
                  Try again
                </ActionButton>
              </>
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
          </View>
        }
      />
    </View>
  );
}
const styles = StyleSheet.create({
  page: {
    flex: 1,
    minHeight: 0,
    paddingHorizontal: 16,
    paddingTop: 44,
    paddingBottom: 16,
    maxWidth: 1128,
  },
  wide: { paddingHorizontal: 64 },
  panel: { paddingHorizontal: 8, paddingTop: 12, paddingBottom: 0 },
  list: { flex: 1, minHeight: 0 },
  feedback: { paddingVertical: 16, gap: 12, alignItems: "center" },
  error: { color: colors.danger, fontSize: 14, lineHeight: 20 },
});
