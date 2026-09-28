import type { ComponentProps } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { Text, ActivityIndicator } from "react-native";
import { CompanionSheet } from "../sheet";
import { ActionButton } from "../button";
import type { RoomData } from "./schema";
export function SaveRoomMessage({
  data,
  cacheScope,
  roomId,
  messageId,
  onClose,
}: {
  readonly data: RoomData;
  readonly cacheScope: string;
  readonly roomId: string;
  readonly messageId: string;
  readonly onClose: () => void;
}) {
  const { state, change } = useSavedMessageChange({
    data,
    cacheScope,
    roomId,
    messageId,
    onClose,
  });
  return (
    <CompanionSheet
      title="Mensagem salva"
      onClose={() => {
        if (!change.isPending) onClose();
      }}
    >
      <Text>
        Somente você vê suas mensagens salvas. O conteúdo continua sujeito ao
        acesso e às alterações da conversa original.
      </Text>
      {state.isPending && (
        <ActivityIndicator accessibilityLabel="Carregando mensagens salvas" />
      )}
      {(state.isError || change.isError) && (
        <Text accessibilityRole="alert">
          Não foi possível atualizar. Tente novamente.
        </Text>
      )}
      {change.data?.status === "conflict" && (
        <Text accessibilityRole="alert">
          Suas mensagens salvas mudaram. Confira o estado atualizado e tente
          novamente.
        </Text>
      )}
      <ActionButton
        disabled={state.isPending || change.isPending}
        onPress={() => {
          if (state.isError) {
            void state.refetch();
          } else change.mutate();
        }}
      >
        {state.isError
          ? "Tentar novamente"
          : state.data?.saved
            ? "Remover das salvas"
            : "Salvar mensagem"}
      </ActionButton>
      <ActionButton quiet disabled={change.isPending} onPress={onClose}>
        Cancelar
      </ActionButton>
    </CompanionSheet>
  );
}

function useSavedMessageChange({
  data,
  cacheScope,
  roomId,
  messageId,
  onClose,
}: ComponentProps<typeof SaveRoomMessage>) {
  const client = useQueryClient();
  const state = useQuery({
    queryKey: ["matrix-saved-state", cacheScope, roomId, messageId],
    queryFn: () => data.savedMessageState({ id: roomId, messageId }),
    staleTime: 0,
    retry: 1,
  });
  const change = useMutation({
    mutationFn: async () => {
      if (!state.data || state.isError) throw new Error("Estado indisponível");
      return data.saveMessage({
        id: roomId,
        messageId,
        saved: !state.data.saved,
        expectedRevision: state.data.revision,
      });
    },
    onSuccess: async (result) => {
      await client.invalidateQueries({
        queryKey: ["matrix-saved", cacheScope],
        refetchType: "none",
      });
      await client.invalidateQueries({
        queryKey: ["matrix-saved-state", cacheScope],
      });
      if (result.status === "saved") onClose();
    },
  });
  return { state, change };
}
