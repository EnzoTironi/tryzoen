import { useEffect, useState, type ComponentProps } from "react";
import { useInfiniteQuery } from "@tanstack/react-query";
import {
  ActivityIndicator,
  FlatList,
  Pressable,
  ScrollView,
  Text,
  TextInput,
  View,
} from "react-native";
import { ChevronRight, Search } from "lucide-react-native";
import type { z } from "zod";
import { CompanionSheet } from "../sheet";
import { ActionButton } from "../button";
import { systemFont, useColors } from "../theme";
import { RoomMessageContext } from "./context";
import type {
  RoomData,
  roomMemberSchema,
  roomMediaReadSchema,
  roomMessageSchema,
} from "./schema";

export function RoomSearch({
  data,
  cacheScope,
  roomId,
  members,
  onClose,
  onOpenRoom,
}: {
  readonly data: RoomData;
  readonly cacheScope: string;
  readonly roomId: string;
  readonly members: z.infer<typeof roomMemberSchema>[];
  readonly onClose: () => void;
  readonly onOpenRoom: (id: string) => void;
}) {
  const colors = useColors();
  const [text, setText] = useState("");
  const [query, setQuery] = useState("");
  const [senderId, setSenderId] = useState<string>();
  const [reference, setReference] =
    useState<z.infer<typeof roomMediaReadSchema>>();
  useEffect(() => {
    const timer = setTimeout(() => {
      setQuery(text.trim());
    }, 300);
    return () => {
      clearTimeout(timer);
    };
  }, [text]);
  const { results, items } = useSearchResults({
    data,
    cacheScope,
    roomId,
    query,
    text,
    senderId,
  });
  if (reference)
    return (
      <RoomMessageContext
        key={reference.messageId}
        data={data}
        cacheScope={cacheScope}
        reference={reference}
        onClose={() => {
          setReference(undefined);
        }}
        onOpenRoom={(id) => {
          onClose();
          onOpenRoom(id);
        }}
      />
    );
  return (
    <CompanionSheet
      title="Buscar na conversa"
      onClose={onClose}
      scrollable={false}
    >
      <View
        style={{
          flexDirection: "row",
          alignItems: "center",
          borderRadius: 14,
          backgroundColor: colors.wash,
          paddingHorizontal: 12,
          gap: 8,
        }}
      >
        <Search size={18} color={colors.muted} />
        <TextInput
          accessibilityLabel="Buscar mensagens"
          placeholder="Palavra ou expressão"
          value={text}
          onChangeText={setText}
          maxLength={200}
          returnKeyType="search"
          style={{
            fontFamily: systemFont,
            flex: 1,
            minHeight: 44,
            color: colors.ink,
            fontSize: 16,
          }}
        />
      </View>
      <SearchAuthors
        members={members}
        senderId={senderId}
        onSelect={setSenderId}
      />
      {results.isError ? (
        <View>
          <Text accessibilityRole="alert">
            Não foi possível buscar nesta conversa.
          </Text>
          <ActionButton
            onPress={() => {
              void results.refetch();
            }}
          >
            Tentar novamente
          </ActionButton>
        </View>
      ) : (
        <FlatList
          data={items}
          keyExtractor={(item) => item.id}
          style={{ maxHeight: 520, flexShrink: 1 }}
          onEndReachedThreshold={0.5}
          onEndReached={() => {
            if (
              results.hasNextPage &&
              !results.isFetching &&
              query === text.trim()
            )
              void results.fetchNextPage({ cancelRefetch: false });
          }}
          ListEmptyComponent={
            <Text style={{ color: colors.muted, paddingVertical: 20 }}>
              {!query
                ? "Encontre uma mensagem nesta conversa."
                : results.isFetching
                  ? "Buscando…"
                  : results.hasNextPage
                    ? "Verificando os próximos resultados…"
                    : "Nenhuma mensagem atual encontrada."}
            </Text>
          }
          ListFooterComponent={
            results.isFetching ? (
              <ActivityIndicator accessibilityLabel="Buscando mensagens" />
            ) : !items.length && results.hasNextPage ? (
              <ActionButton
                quiet
                onPress={() => {
                  void results.fetchNextPage({ cancelRefetch: false });
                }}
              >
                Continuar busca
              </ActionButton>
            ) : null
          }
          renderItem={({ item }) => (
            <SearchResult
              item={item}
              onSelect={() => {
                setReference({ id: roomId, messageId: item.id });
              }}
            />
          )}
        />
      )}
    </CompanionSheet>
  );
}

function SearchResult({
  item,
  onSelect,
}: {
  readonly item: z.infer<typeof roomMessageSchema>;
  readonly onSelect: () => void;
}) {
  const colors = useColors();
  return (
    <Pressable
      accessibilityRole="button"
      accessibilityLabel={`Abrir mensagem de ${item.sender}: ${item.text}`}
      onPress={onSelect}
      style={({ pressed }) => ({
        paddingVertical: 16,
        gap: 7,
        borderBottomWidth: 1,
        borderBottomColor: colors.wash,
        opacity: pressed ? 0.6 : 1,
      })}
    >
      <View style={{ flexDirection: "row", alignItems: "center", gap: 8 }}>
        <Text style={{ fontWeight: "600", color: colors.ink, flex: 1 }}>
          {item.mine ? "Você" : item.sender}
        </Text>
        <ChevronRight size={16} color={colors.muted} />
      </View>
      <Text
        numberOfLines={4}
        style={{
          fontFamily: systemFont,
          fontSize: 15,
          lineHeight: 21,
          color: colors.ink,
        }}
      >
        {item.text}
      </Text>
      <Text
        style={{ fontFamily: systemFont, fontSize: 12, color: colors.muted }}
      >
        {new Date(item.timestamp).toLocaleString()}
        {item.editId ? " · Editada" : ""}
        {item.rootId ? " · Thread" : ""}
      </Text>
    </Pressable>
  );
}

function SearchAuthors({
  members,
  senderId,
  onSelect,
}: {
  readonly members: ComponentProps<typeof RoomSearch>["members"];
  readonly senderId: string | undefined;
  readonly onSelect: (id: string | undefined) => void;
}) {
  const colors = useColors();
  return (
    <ScrollView
      horizontal
      showsHorizontalScrollIndicator={false}
      style={{ flexGrow: 0, flexShrink: 0, minHeight: 44, marginVertical: 12 }}
    >
      {[{ id: undefined, name: "Todos" }, ...members].map((person) => (
        <Pressable
          key={person.id ?? "all"}
          accessibilityRole="button"
          accessibilityLabel={`Mensagens de ${person.name}`}
          accessibilityState={{ selected: person.id === senderId }}
          onPress={() => {
            onSelect(person.id);
          }}
          style={{
            paddingHorizontal: 14,
            paddingVertical: 10,
            marginRight: 6,
            borderRadius: 18,
            backgroundColor:
              person.id === senderId ? colors.wash : "transparent",
          }}
        >
          <Text
            style={{
              color: person.id === senderId ? colors.accent : colors.muted,
            }}
          >
            {person.name}
          </Text>
        </Pressable>
      ))}
    </ScrollView>
  );
}

function useSearchResults({
  data,
  cacheScope,
  roomId,
  query,
  text,
  senderId,
}: Pick<ComponentProps<typeof RoomSearch>, "data" | "cacheScope" | "roomId"> & {
  readonly query: string;
  readonly text: string;
  readonly senderId: string | undefined;
}) {
  const results = useInfiniteQuery({
    queryKey: ["matrix-search", cacheScope, roomId, query, senderId],
    initialPageParam: undefined as string | undefined,
    queryFn: ({ pageParam, signal }) =>
      data.search({ id: roomId, query, senderId, cursor: pageParam }, signal),
    getNextPageParam: (last, _pages, _cursor, cursors) =>
      last.nextCursor && !cursors.includes(last.nextCursor)
        ? last.nextCursor
        : undefined,
    enabled: query.length > 0 && query === text.trim(),
    staleTime: 0,
    gcTime: 0,
    retry: 1,
  });
  const items =
    results.isError || query !== text.trim()
      ? []
      : Array.from(
          new Map(
            results.data?.pages
              .flatMap((page) => page.items)
              .map((item) => [item.id, item])
          ).values()
        );

  return { results, items };
}
