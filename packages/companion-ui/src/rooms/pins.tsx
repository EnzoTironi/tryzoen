import { useMemo, useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import {
  ActivityIndicator,
  FlatList,
  Pressable,
  StyleSheet,
  Text,
  View,
} from "react-native";
import { Pin } from "lucide-react-native";
import type { z } from "zod";
import { CompanionSheet } from "../sheet";
import { ActionButton } from "../button";
import { systemFont, useColors } from "../theme";
import { RoomMessageContext } from "./context";
import type { RoomData, roomMessageSchema, roomPinsSchema } from "./schema";

export function PinRoomMessage({
  data,
  cacheScope,
  roomId,
  item,
  onClose,
}: {
  readonly data: RoomData;
  readonly cacheScope: string;
  readonly roomId: string;
  readonly item: z.infer<typeof roomMessageSchema>;
  readonly onClose: () => void;
}) {
  const colors = useColors();
  const styles = useMemo(() => createStyles(colors), [colors]);
  const client = useQueryClient();
  const key = ["matrix-pins", cacheScope, roomId];
  const state = useQuery({
    queryKey: key,
    queryFn: ({ signal }) => data.pins({ id: roomId }, signal),
    staleTime: 0,
    gcTime: 60_000,
    retry: 1,
  });
  const change = useMutation({
    mutationFn: (input: Parameters<RoomData["pin"]>[0]) => data.pin(input),
    onMutate: async (input) => {
      await client.cancelQueries({ queryKey: key });
      const before = client.getQueryData<z.infer<typeof roomPinsSchema>>(key);
      if (before)
        client.setQueryData(key, {
          ...before,
          messageIds: input.pinned
            ? [item.id, ...before.messageIds]
            : before.messageIds.filter((id) => id !== item.id),
        });
      return before;
    },
    onError: (_error, _input, before) => {
      if (before) client.setQueryData(key, before);
    },
    onSuccess: (result) => {
      client.setQueryData(key, result.pins);
      if (result.status === "saved") onClose();
    },
    onSettled: () => {
      void client.invalidateQueries({ queryKey: key });
    },
  });
  const pinned = state.data?.messageIds.includes(item.id);
  return (
    <CompanionSheet
      title="Mensagem fixada"
      onClose={() => {
        if (!change.isPending) onClose();
      }}
    >
      <View style={styles.preview}>
        <Pin size={20} color={colors.muted} />
        <Text numberOfLines={4} style={styles.text}>
          {item.media?.filename ?? item.text}
        </Text>
      </View>
      <Text style={styles.caption}>
        As mensagens fixadas ficam disponíveis para todas as pessoas desta
        conversa.
      </Text>
      {state.isPending && (
        <ActivityIndicator accessibilityLabel="Carregando mensagens fixadas" />
      )}
      {state.data && !state.data.mayManage && (
        <Text style={styles.caption}>
          Você não tem permissão para alterar as mensagens fixadas nesta
          conversa.
        </Text>
      )}
      {(state.isError || change.isError) && (
        <Text accessibilityRole="alert">
          Não foi possível atualizar. Tente novamente.
        </Text>
      )}
      {change.data?.status === "conflict" && (
        <Text accessibilityRole="alert">
          A lista mudou em outro dispositivo. Confira o estado atualizado e
          tente novamente.
        </Text>
      )}
      {state.isError ? (
        <ActionButton
          onPress={() => {
            void state.refetch();
          }}
        >
          Tentar novamente
        </ActionButton>
      ) : (
        <ActionButton
          disabled={
            state.isPending || change.isPending || !state.data.mayManage
          }
          onPress={() => {
            if (state.data)
              change.mutate({
                id: roomId,
                messageId: item.id,
                pinned: !pinned,
                expectedRevision: state.data.revision,
              });
          }}
        >
          {change.isPending
            ? "Atualizando…"
            : pinned
              ? "Desafixar mensagem"
              : "Fixar mensagem"}
        </ActionButton>
      )}
    </CompanionSheet>
  );
}

export function RoomPins({
  data,
  cacheScope,
  roomId,
  onClose,
  onOpenRoom,
}: {
  readonly data: RoomData;
  readonly cacheScope: string;
  readonly roomId: string;
  readonly onClose: () => void;
  readonly onOpenRoom: (id: string) => void;
}) {
  const colors = useColors();
  const styles = useMemo(() => createStyles(colors), [colors]);
  const [selected, setSelected] = useState<string>();
  const result = useQuery({
    queryKey: ["matrix-pins", cacheScope, roomId, "messages"],
    queryFn: ({ signal }) =>
      data.pins({ id: roomId, includeMessages: true }, signal),
    staleTime: 0,
    gcTime: 0,
    retry: 1,
  });
  if (selected)
    return (
      <RoomMessageContext
        data={data}
        cacheScope={cacheScope}
        reference={{ id: roomId, messageId: selected }}
        onClose={() => {
          setSelected(undefined);
        }}
        onOpenRoom={onOpenRoom}
      />
    );
  return (
    <CompanionSheet
      title="Mensagens fixadas"
      onClose={onClose}
      scrollable={false}
    >
      <FlatList
        style={styles.list}
        data={result.isError ? [] : (result.data?.messages ?? [])}
        keyExtractor={(item) => item.id}
        renderItem={({ item }) => (
          <Pressable
            accessibilityRole="button"
            accessibilityLabel={`Ver mensagem fixada de ${item.sender}`}
            onPress={() => {
              setSelected(item.id);
            }}
            style={({ pressed }) => [styles.row, pressed && styles.pressed]}
          >
            <Pin size={18} color={colors.muted} />
            <View style={styles.copy}>
              <Text style={styles.name}>{item.sender}</Text>
              <Text numberOfLines={3} style={styles.text}>
                {item.media?.filename ?? item.text}
              </Text>
              <Text style={styles.caption}>
                {new Date(item.timestamp).toLocaleString()}
              </Text>
            </View>
          </Pressable>
        )}
        ListEmptyComponent={
          result.isPending ? (
            <ActivityIndicator accessibilityLabel="Carregando mensagens fixadas" />
          ) : !result.isError ? (
            <Text style={styles.caption}>
              As mensagens que você fixar aparecerão aqui.
            </Text>
          ) : null
        }
      />
      {result.isError && (
        <>
          <Text accessibilityRole="alert">
            Não foi possível carregar as mensagens fixadas.
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
    </CompanionSheet>
  );
}
function createStyles(colors: ReturnType<typeof useColors>) {
  return StyleSheet.create({
    list: { maxHeight: 460, minHeight: 100 },
    row: {
      flexDirection: "row",
      gap: 12,
      paddingVertical: 16,
      paddingHorizontal: 4,
      borderBottomWidth: StyleSheet.hairlineWidth,
      borderBottomColor: colors.line,
    },
    copy: { flex: 1, gap: 6 },
    name: {
      fontFamily: systemFont,
      fontSize: 14,
      fontWeight: "600",
      color: colors.ink,
    },
    text: {
      fontFamily: systemFont,
      fontSize: 16,
      color: colors.ink,
      flexShrink: 1,
    },
    caption: { fontFamily: systemFont, fontSize: 13, color: colors.muted },
    preview: {
      flexDirection: "row",
      gap: 12,
      backgroundColor: colors.wash,
      padding: 16,
      borderRadius: 20,
    },
    pressed: { backgroundColor: colors.wash },
  });
}
