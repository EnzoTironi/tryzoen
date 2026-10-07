import { useI18n } from "./../i18n";
import {
  useMemo,
  useDeferredValue,
  useState,
  type ComponentProps,
} from "react";
import { useConversationLibrary } from "./library";
import {
  ActivityIndicator,
  FlatList,
  StyleSheet,
  Text,
  View,
} from "react-native";

import { ActionButton } from "../button";
import { EmptyState } from "../empty-state";
import { systemFont, useColors } from "../theme";
import { Archive, MessagesSquare, SearchX } from "lucide-react-native";
import { ConversationToolbar } from "./toolbar";
import { ConversationRow } from "./row";
import type { ChatData } from "./schema";

export function ConversationSearch({
  data,
  cacheScope,
  onOpen,
  onCreate,
  title,
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
  const { t, errorText } = useI18n();
  const colors = useColors();
  const styles = useMemo(() => createStyles(colors), [colors]);
  const [query, setQuery] = useState("");
  const [archived, setArchived] = useState(false);
  const [width, setWidth] = useState(0);
  const search = useDeferredValue(query);
  const { chats, items, change } = useConversationLibrary(
    data,
    cacheScope,
    search,
    archived
  );
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
        title={title ?? t("Conversations")}
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
            <EmptyState
              compact={Boolean(panel)}
              icon={search ? SearchX : archived ? Archive : MessagesSquare}
              title={
                search
                  ? t("No conversations match your search.")
                  : archived
                    ? t(
                        "No archived conversations. Conversations you archive will appear here."
                      )
                    : t("Vamos conversar?")
              }
              body={
                search || archived
                  ? undefined
                  : t(
                      "Start a conversation. You can return to it here anytime."
                    )
              }
              action={
                !search && !archived && onCreate
                  ? { label: t("Começar uma conversa"), onPress: onCreate }
                  : undefined
              }
            />
          ) : null
        }
        ListFooterComponent={
          <View style={styles.feedback}>
            {chats.isFetching && (
              <ActivityIndicator
                accessibilityLabel={t("Loading conversations")}
                color={colors.accent}
              />
            )}
            {chats.error && (
              <>
                <Text accessibilityRole="alert" style={styles.error}>
                  {errorText(chats.error.message)}
                </Text>
                <ActionButton
                  quiet
                  onPress={() => {
                    void chats.refetch();
                  }}
                >
                  {t("Try again")}
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
                {t("Load more")}
              </ActionButton>
            )}
          </View>
        }
      />
    </View>
  );
}
function createStyles(colors: ReturnType<typeof useColors>) {
  return StyleSheet.create({
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
    error: {
      fontFamily: systemFont,
      color: colors.danger,
      fontSize: 14,
      lineHeight: 20,
    },
  });
}
