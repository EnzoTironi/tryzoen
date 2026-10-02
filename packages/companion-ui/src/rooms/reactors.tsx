import { useMemo } from "react";
import type { ComponentProps } from "react";
import { useInfiniteQuery } from "@tanstack/react-query";
import {
  ActivityIndicator,
  FlatList,
  Pressable,
  StyleSheet,
  Text,
  View,
} from "react-native";
import { CompanionSheet } from "../sheet";
import { ActionButton } from "../button";
import { ConversationAvatar } from "../chats/avatar";
import { systemFont, useColors } from "../theme";
import type { RoomMessages } from "./messages";

export function RoomReactors({
  data,
  cacheScope,
  roomId,
  messageId,
  onProfile,
  onClose,
}: Pick<
  ComponentProps<typeof RoomMessages>,
  "data" | "cacheScope" | "roomId" | "onProfile"
> & {
  readonly messageId: string;
  readonly onClose: () => void;
}) {
  const colors = useColors();
  const styles = useMemo(() => createStyles(colors), [colors]);
  const result = useInfiniteQuery({
    queryKey: ["matrix-reactors", cacheScope, roomId, messageId],
    initialPageParam: undefined as string | undefined,
    queryFn: ({ pageParam, signal }) =>
      data.reactors({ id: roomId, messageId, cursor: pageParam }, signal),
    getNextPageParam: (page, _pages, _cursor, cursors) =>
      page.nextCursor && !cursors.includes(page.nextCursor)
        ? page.nextCursor
        : undefined,
    staleTime: 0,
    gcTime: 0,
    retry: 1,
  });
  const entries = [
    ...new Map(
      (result.data?.pages.flatMap((page) => page.items) ?? []).map((entry) => [
        JSON.stringify([entry.person.id, entry.emoji]),
        entry,
      ])
    ).values(),
  ];
  return (
    <CompanionSheet title="Reações" onClose={onClose} scrollable={false}>
      <FlatList
        style={styles.list}
        data={result.isError ? [] : entries}
        keyExtractor={(entry) => JSON.stringify([entry.person.id, entry.emoji])}
        onEndReachedThreshold={0.4}
        onEndReached={() => {
          if (result.hasNextPage && !result.isFetching && !result.isError)
            void result.fetchNextPage({ cancelRefetch: false });
        }}
        renderItem={({ item }) => (
          <Pressable
            accessibilityRole="button"
            accessibilityLabel={`Ver perfil de ${item.person.name}, reação ${item.emoji}`}
            onPress={() => {
              onClose();
              onProfile(item.person);
            }}
            style={({ pressed }) => [styles.person, pressed && styles.pressed]}
          >
            <ConversationAvatar
              name={item.person.name}
              uri={item.person.avatarUri ?? undefined}
              size={40}
            />
            <View style={styles.copy}>
              <Text style={styles.name}>
                {item.person.mine ? "Você" : item.person.name}
                {item.person.bot ? " · IA" : ""}
              </Text>
              {item.person.username && (
                <Text style={styles.caption}>@{item.person.username}</Text>
              )}
            </View>
            <Text style={styles.emoji}>{item.emoji}</Text>
          </Pressable>
        )}
        ListEmptyComponent={
          result.isPending ? (
            <ActivityIndicator accessibilityLabel="Carregando reações" />
          ) : !result.isError ? (
            <Text style={styles.caption}>Ainda não há reações.</Text>
          ) : null
        }
        ListFooterComponent={
          <>
            {result.isFetchingNextPage && (
              <ActivityIndicator accessibilityLabel="Carregando mais reações" />
            )}
            {result.isError && (
              <>
                <Text accessibilityRole="alert">
                  Não foi possível carregar as reações.
                </Text>
                <ActionButton
                  onPress={() => {
                    void result.refetch();
                  }}
                >
                  Tentar novamente
                </ActionButton>
              </>
            )}
          </>
        }
      />
    </CompanionSheet>
  );
}
function createStyles(colors: ReturnType<typeof useColors>) {
  return StyleSheet.create({
    list: { maxHeight: 460, minHeight: 100 },
    person: {
      flexDirection: "row",
      alignItems: "center",
      gap: 12,
      paddingVertical: 12,
      paddingHorizontal: 4,
      borderRadius: 16,
    },
    pressed: { backgroundColor: colors.wash },
    copy: { flex: 1, gap: 3 },
    name: {
      fontFamily: systemFont,
      fontSize: 16,
      fontWeight: "500",
      color: colors.ink,
    },
    caption: { fontFamily: systemFont, fontSize: 13, color: colors.muted },
    emoji: { fontFamily: systemFont, fontSize: 26 },
  });
}
