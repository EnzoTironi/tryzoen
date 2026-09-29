import { useState, type ComponentProps } from "react";
import {
  useMutation,
  useQueryClient,
  type InfiniteData,
} from "@tanstack/react-query";
import { Text } from "react-native";
import type { z } from "zod";
import { CompanionSheet } from "../sheet";
import { ActionButton } from "../button";
import { colors } from "../theme";
import type { RoomData, roomPageSchema, roomMessageSchema } from "./schema";

export function DeleteRoomMessage({
  data,
  roomId,
  cacheScope,
  messageId,
  onClose,
}: {
  readonly data: RoomData;
  readonly roomId: string;
  readonly cacheScope: string;
  readonly messageId: string;
  readonly onClose: () => void;
}) {
  const deletion = useMessageDeletion({
    data,
    roomId,
    cacheScope,
    messageId,
    onClose,
  });
  return (
    <CompanionSheet
      title="Excluir mensagem?"
      onClose={() => {
        if (!deletion.isPending) onClose();
      }}
    >
      <Text style={{ color: colors.muted, fontSize: 15, lineHeight: 22 }}>
        O conteúdo será removido da conversa. Respostas na thread continuam
        disponíveis. Isso não apaga cópias ou arquivos que outras pessoas já
        salvaram.
      </Text>
      {deletion.isError && (
        <Text accessibilityRole="alert" style={{ color: colors.danger }}>
          Não foi possível excluir. Tente novamente.
        </Text>
      )}
      <ActionButton
        disabled={deletion.isPending}
        onPress={() => {
          deletion.mutate();
        }}
      >
        {deletion.isPending ? "Excluindo…" : "Excluir mensagem"}
      </ActionButton>
      <ActionButton quiet disabled={deletion.isPending} onPress={onClose}>
        Cancelar
      </ActionButton>
    </CompanionSheet>
  );
}

function tombstone(message: z.infer<typeof roomMessageSchema>) {
  return {
    ...message,
    text: "Mensagem removida",
    redacted: true,
    media: undefined,
    reply: null,
  };
}

function useMessageDeletion({
  data,
  roomId,
  cacheScope,
  messageId,
  onClose,
}: ComponentProps<typeof DeleteRoomMessage>) {
  const client = useQueryClient();
  const [operationId] = useState(() => data.operationId());
  return useMutation({
    mutationFn: () =>
      data.deleteMessage({ id: roomId, messageId, operationId }),
    onSuccess: async () => {
      for (const kind of ["matrix-messages", "matrix-thread"]) {
        const queryKey = [kind, cacheScope, roomId];
        await client.cancelQueries({ queryKey });
        client.setQueriesData<
          InfiniteData<
            z.infer<typeof roomPageSchema> & {
              parent?: z.infer<typeof roomMessageSchema>;
            }
          >
        >(
          { queryKey },
          (current) =>
            current && {
              ...current,
              pages: current.pages.map((page) => ({
                ...page,
                messages: page.messages.map((message) =>
                  message.id === messageId ? tombstone(message) : message
                ),
                ...(page.parent?.id === messageId
                  ? { parent: tombstone(page.parent) }
                  : {}),
              })),
            }
        );
        void client.invalidateQueries({ queryKey });
      }
      await client.cancelQueries({
        queryKey: ["matrix-media", cacheScope, roomId, messageId],
      });
      client.removeQueries({
        queryKey: ["matrix-media", cacheScope, roomId, messageId],
      });
      void client.invalidateQueries({
        queryKey: ["conversation-inbox", cacheScope],
      });
      onClose();
    },
  });
}
