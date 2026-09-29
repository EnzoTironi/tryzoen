import { useEffect, useRef, useState, type ComponentProps } from "react";
import {
  useInfiniteQuery,
  useMutation,
  useQueryClient,
} from "@tanstack/react-query";
import {
  ActivityIndicator,
  FlatList,
  Pressable,
  ScrollView,
  StyleSheet,
  Text,
  TextInput,
  View,
} from "react-native";
import { Check, Search } from "lucide-react-native";
import type { z } from "zod";
import { CompanionSheet } from "../sheet";
import { ActionButton } from "../button";
import { ConversationAvatar } from "../chats/avatar";
import { AssistantMarkdown } from "../markdown";
import { colors } from "../theme";
import { RoomAttachment } from "./attachment";
import type { RoomData, roomMessageSchema, roomSchema } from "./schema";

export function ForwardRoomMessage({
  data,
  cacheScope,
  roomId,
  item,
  onClose,
}: {
  readonly data: Pick<
    RoomData,
    "media" | "operationId" | "forwardMessage" | "forwardDestinations"
  >;
  readonly cacheScope: string;
  readonly roomId: string;
  readonly item: z.infer<typeof roomMessageSchema>;
  readonly onClose: () => void;
}) {
  const flow = useMessageForward({ data, cacheScope, roomId, item });
  const { destination, send } = flow;
  const close = () => {
    if (!send.isPending) onClose();
  };
  return (
    <CompanionSheet
      title="Encaminhar mensagem"
      onClose={close}
      scrollable={false}
    >
      {send.data?.status === "sent" ? (
        <View style={styles.confirmation}>
          <Check size={32} color={colors.accent} />
          <Text accessibilityRole="alert" style={styles.name}>
            Enviada para {destination?.label}
          </Text>
          <ActionButton onPress={onClose}>Concluído</ActionButton>
        </View>
      ) : destination ? (
        <ForwardReview
          flow={flow}
          data={data}
          roomId={roomId}
          cacheScope={cacheScope}
        />
      ) : (
        <ForwardDestinations
          data={data}
          cacheScope={cacheScope}
          roomId={roomId}
          onSelect={flow.choose}
        />
      )}
    </CompanionSheet>
  );
}

function useMessageForward({
  data,
  cacheScope,
  roomId,
  item,
}: Omit<ComponentProps<typeof ForwardRoomMessage>, "onClose">) {
  const client = useQueryClient();
  const [preview, setPreview] = useState(item);
  const [destination, setDestination] = useState<z.infer<typeof roomSchema>>();
  const operation = useRef<{ intent: string; id: string } | null>(null);
  const send = useMutation({
    mutationFn: () => {
      if (!destination) throw new Error("Escolha uma conversa");
      const revision = preview.editId ?? preview.id;
      const intent = JSON.stringify([destination.id, revision]);
      if (operation.current?.intent !== intent)
        operation.current = { intent, id: data.operationId() };
      return data.forwardMessage({
        id: roomId,
        messageId: item.id,
        destinationId: destination.id,
        expectedRevision: revision,
        operationId: operation.current.id,
      });
    },
    onSuccess: (result) => {
      if (result.status !== "sent" || !destination) return;
      void client.invalidateQueries({
        queryKey: ["matrix-messages", cacheScope, destination.id],
      });
      void client.invalidateQueries({
        queryKey: ["conversation-inbox", cacheScope],
      });
    },
  });

  return {
    preview,
    destination,
    send,
    choose: (room: typeof destination) => {
      setDestination(room);
      send.reset();
    },
    reviewCurrent: () => {
      if (send.data?.status === "changed") setPreview(send.data.message);
      send.reset();
    },
  };
}

function ForwardReview({
  flow,
  data,
  roomId,
  cacheScope,
}: Pick<
  ComponentProps<typeof ForwardRoomMessage>,
  "data" | "roomId" | "cacheScope"
> & {
  readonly flow: ReturnType<typeof useMessageForward>;
}) {
  const { preview, destination, send } = flow;
  return (
    <>
      <View style={styles.destination}>
        <ConversationAvatar
          name={destination?.label ?? ""}
          uri={destination?.avatarUri ?? undefined}
          group={destination?.kind === "group"}
        />
        <View style={styles.identity}>
          <Text style={styles.detail}>Para</Text>
          <Text style={styles.name}>{destination?.label ?? ""}</Text>
        </View>
      </View>
      <ScrollView
        style={styles.preview}
        contentContainerStyle={styles.previewContent}
      >
        <Text style={styles.detail}>Encaminhada</Text>
        {preview.media ? (
          <RoomAttachment
            item={preview}
            data={data}
            roomId={roomId}
            cacheScope={cacheScope}
          />
        ) : (
          <AssistantMarkdown text={preview.text} compact />
        )}
      </ScrollView>
      <Text style={styles.detail}>
        Uma cópia será compartilhada nesta conversa. Alterações no original não
        atualizam a cópia.
      </Text>
      {send.isError && (
        <Text accessibilityRole="alert" style={styles.error}>
          Não foi possível confirmar o envio. Seu destino foi mantido; tente
          novamente.
        </Text>
      )}
      {send.data?.status === "changed" && (
        <>
          <Text accessibilityRole="alert" style={styles.error}>
            O original mudou. Confira o destino antes de encaminhar uma nova
            versão.
          </Text>
          <ActionButton
            quiet
            onPress={() => {
              flow.reviewCurrent();
            }}
          >
            Revisar versão atual
          </ActionButton>
        </>
      )}
      <ActionButton
        disabled={send.isPending || send.data?.status === "changed"}
        onPress={() => {
          send.mutate();
        }}
      >
        {send.isPending ? "Enviando…" : "Encaminhar mensagem"}
      </ActionButton>
      <ActionButton
        quiet
        disabled={send.isPending}
        onPress={() => {
          flow.choose(undefined);
        }}
      >
        Alterar destino
      </ActionButton>
    </>
  );
}

function ForwardDestinations({
  data,
  cacheScope,
  roomId,
  onSelect,
}: {
  readonly data: Pick<RoomData, "forwardDestinations">;
  readonly cacheScope: string;
  readonly roomId: string;
  readonly onSelect: (room: z.infer<typeof roomSchema>) => void;
}) {
  const [text, setText] = useState("");
  const [query, setQuery] = useState("");
  useEffect(() => {
    const timer = setTimeout(() => {
      setQuery(text.trim());
    }, 300);
    return () => {
      clearTimeout(timer);
    };
  }, [text]);
  const results = useInfiniteQuery({
    queryKey: ["matrix-forward-destinations", cacheScope, roomId, query],
    initialPageParam: undefined as string | undefined,
    queryFn: ({ pageParam, signal }) =>
      data.forwardDestinations(
        { id: roomId, query, before: pageParam },
        signal
      ),
    getNextPageParam: (last, _pages, _cursor, cursors) =>
      last.nextCursor && !cursors.includes(last.nextCursor)
        ? last.nextCursor
        : undefined,
    enabled: text.trim() === query,
    staleTime: 0,
    gcTime: 60000,
    retry: 1,
  });
  const items =
    results.isError || text.trim() !== query
      ? []
      : [
          ...new Map(
            results.data?.pages
              .flatMap((page) => page.items)
              .map((room) => [room.id, room])
          ).values(),
        ];
  return (
    <>
      <View style={styles.search}>
        <Search size={18} color={colors.muted} />
        <TextInput
          accessibilityLabel="Buscar destino"
          placeholder="Nome ou username"
          value={text}
          onChangeText={setText}
          maxLength={80}
          style={styles.input}
          autoCorrect={false}
        />
      </View>
      <Text style={styles.detail}>Escolha uma conversa deste espaço.</Text>
      <FlatList
        style={styles.list}
        data={items}
        keyboardShouldPersistTaps="handled"
        keyExtractor={(room) => room.id}
        onEndReachedThreshold={0.5}
        onEndReached={() => {
          if (results.hasNextPage && !results.isFetching && !results.isError)
            void results.fetchNextPage({ cancelRefetch: false });
        }}
        renderItem={({ item: room }) => (
          <Pressable
            accessibilityRole="button"
            accessibilityLabel={`Encaminhar para ${room.label}`}
            onPress={() => {
              onSelect(room);
            }}
            style={({ pressed }) => [
              styles.destination,
              pressed && styles.pressed,
            ]}
          >
            <ConversationAvatar
              name={room.label}
              uri={room.avatarUri ?? undefined}
              group={room.kind === "group"}
            />
            <View style={styles.identity}>
              <Text numberOfLines={1} style={styles.name}>
                {room.label}
              </Text>
              <Text style={styles.detail}>
                {room.kind === "group"
                  ? "Grupo"
                  : room.username
                    ? `@${room.username}`
                    : "Conversa privada"}
              </Text>
            </View>
          </Pressable>
        )}
        ListEmptyComponent={
          !results.isPending && !results.isError && text.trim() === query ? (
            <Text style={styles.detail}>Nenhuma conversa encontrada.</Text>
          ) : null
        }
        ListFooterComponent={
          results.isFetching || text.trim() !== query ? (
            <ActivityIndicator accessibilityLabel="Carregando destinos" />
          ) : null
        }
      />
      {results.isError && (
        <>
          <Text accessibilityRole="alert" style={styles.error}>
            Não foi possível carregar as conversas.
          </Text>
          <ActionButton
            quiet
            onPress={() => {
              void results.refetch();
            }}
          >
            Tentar novamente
          </ActionButton>
        </>
      )}
    </>
  );
}

const styles = StyleSheet.create({
  confirmation: { gap: 20, alignItems: "center", paddingVertical: 32 },
  destination: {
    flexDirection: "row",
    alignItems: "center",
    gap: 12,
    minHeight: 68,
    padding: 10,
    borderRadius: 16,
  },
  identity: { flex: 1, gap: 3, minWidth: 0 },
  name: { fontSize: 16, fontWeight: "600", color: colors.ink },
  detail: { fontSize: 13, lineHeight: 19, color: colors.muted },
  error: { fontSize: 14, lineHeight: 20, color: colors.danger },
  pressed: { backgroundColor: colors.wash },
  preview: {
    maxHeight: 200,
    overflow: "hidden",
    borderRadius: 22,
    backgroundColor: colors.wash,
  },
  previewContent: { padding: 16, gap: 8 },
  search: {
    flexDirection: "row",
    gap: 8,
    alignItems: "center",
    backgroundColor: colors.wash,
    paddingHorizontal: 12,
    borderRadius: 14,
  },
  input: {
    flex: 1,
    minWidth: 0,
    minHeight: 44,
    color: colors.ink,
    fontSize: 16,
  },
  list: { height: 300, flexGrow: 0 },
});
