import { RoomMessageContext } from "./context";
import { BookmarkX, ChevronRight } from "lucide-react-native";
import { IconButton } from "../icon-button";
import { ClearUnavailableSaved } from "./clear-saved";
import { useState } from "react";
import { useInfiniteQuery, useQueryClient } from "@tanstack/react-query";
import {
  FlatList,
  Text,
  View,
  Pressable,
  ActivityIndicator,
} from "react-native";
import type { z } from "zod";
import { CompanionSheet } from "../sheet";
import { ActionButton } from "../button";
import { systemFont, useColors } from "../theme";
import { SaveRoomMessage } from "./save-message";
import type {
  RoomData,
  savedMessagesPageSchema,
  roomMediaReadSchema,
} from "./schema";

export function SavedRoomMessages({
  data,
  cacheScope,
  onClose,
  onOpenRoom,
}: {
  readonly data: RoomData;
  readonly cacheScope: string;
  readonly onClose: () => void;
  readonly onOpenRoom: (id: string) => void;
}) {
  const colors = useColors();
  const client = useQueryClient();
  const refresh = () =>
    client.resetQueries({
      queryKey: ["matrix-saved", cacheScope],
      exact: true,
    });
  const [selected, setSelected] =
    useState<z.infer<typeof roomMediaReadSchema>>();
  const [removing, setRemoving] =
    useState<z.infer<typeof roomMediaReadSchema>>();
  const result = useInfiniteQuery({
    queryKey: ["matrix-saved", cacheScope],
    initialPageParam: null as z.infer<
      typeof savedMessagesPageSchema
    >["nextCursor"],
    queryFn: ({ pageParam }) => data.savedMessages({ cursor: pageParam }),
    getNextPageParam: (page) => (page.reset ? undefined : page.nextCursor),
    staleTime: 0,
    retry: 1,
  });
  const pages = result.data?.pages ?? [];
  const reset = pages.some((page) => page.reset);
  const items =
    result.isError || reset ? [] : pages.flatMap((page) => page.items);
  if (selected)
    return (
      <RoomMessageContext
        data={data}
        cacheScope={cacheScope}
        reference={selected}
        onClose={() => {
          setSelected(undefined);
        }}
        onOpenRoom={(id) => {
          onOpenRoom(id);
          onClose();
        }}
      />
    );
  return (
    <CompanionSheet title="Mensagens salvas" onClose={onClose}>
      <Text
        style={{
          fontFamily: systemFont,
          color: colors.muted,
          fontSize: 13,
          marginBottom: 16,
        }}
      >
        Só você · até 100 mensagens. As salvas deste espaço aparecem aqui.
      </Text>
      {(result.isError || reset) && (
        <>
          <Text accessibilityRole="alert">
            {reset
              ? "A lista mudou. Atualize para ver a versão atual."
              : "Não foi possível carregar suas mensagens."}
          </Text>
          <ActionButton
            onPress={() => {
              void refresh();
            }}
          >
            Atualizar
          </ActionButton>
        </>
      )}
      {result.isPending && (
        <ActivityIndicator accessibilityLabel="Carregando mensagens salvas" />
      )}
      <FlatList
        data={items}
        keyExtractor={(item) => item.key}
        style={{ maxHeight: 560 }}
        onEndReached={() => {
          if (result.hasNextPage && !result.isFetching && !result.isError)
            void result.fetchNextPage();
        }}
        ListEmptyComponent={
          !result.isPending && !result.isError && !reset ? (
            <Text>Nenhuma mensagem salva neste espaço.</Text>
          ) : null
        }
        ListFooterComponent={
          result.isFetchingNextPage ? (
            <ActivityIndicator accessibilityLabel="Carregando mais mensagens" />
          ) : null
        }
        renderItem={({ item }) => (
          <SavedRow item={item} onSelect={setSelected} onRemove={setRemoving} />
        )}
      />
      <ClearUnavailableSaved data={data} cacheScope={cacheScope} />
      {removing && (
        <SaveRoomMessage
          data={data}
          cacheScope={cacheScope}
          roomId={removing.id}
          messageId={removing.messageId}
          onClose={() => {
            setRemoving(undefined);
            void refresh();
          }}
        />
      )}
    </CompanionSheet>
  );
}

function SavedRow({
  item,
  onSelect,
  onRemove,
}: {
  readonly item: z.infer<typeof savedMessagesPageSchema>["items"][number];
  readonly onSelect: (value: z.infer<typeof roomMediaReadSchema>) => void;
  readonly onRemove: (value: z.infer<typeof roomMediaReadSchema>) => void;
}) {
  const colors = useColors();
  return (
    <View
      style={{
        flexDirection: "row",
        alignItems: "center",
        paddingVertical: 16,
        gap: 8,
        borderBottomWidth: 1,
        borderBottomColor: colors.wash,
      }}
    >
      <Pressable
        accessibilityRole="button"
        disabled={!item.room || !item.message}
        style={({ pressed }) => ({
          flex: 1,
          gap: 6,
          opacity: pressed ? 0.65 : 1,
        })}
        onPress={() => {
          onSelect(item.reference);
        }}
      >
        <View style={{ flexDirection: "row", alignItems: "center", gap: 8 }}>
          <Text
            numberOfLines={1}
            style={{
              fontFamily: systemFont,
              flex: 1,
              fontWeight: "600",
              fontSize: 16,
              color: colors.ink,
            }}
          >
            {item.room?.label ?? "Mensagem indisponível"}
          </Text>
          {item.room && item.message && (
            <ChevronRight size={16} color={colors.muted} />
          )}
        </View>
        <Text
          numberOfLines={3}
          style={{
            fontFamily: systemFont,
            color: colors.ink,
            fontSize: 15,
            lineHeight: 21,
          }}
        >
          {item.message?.text ??
            "O acesso ou a mensagem original não está mais disponível."}
        </Text>
        <Text
          style={{ fontFamily: systemFont, color: colors.muted, fontSize: 12 }}
        >
          Salva em {new Date(item.savedAt).toLocaleDateString()}
        </Text>
      </Pressable>
      <IconButton
        label="Remover das salvas"
        icon={BookmarkX}
        onPress={() => {
          onRemove(item.reference);
        }}
      />
    </View>
  );
}
