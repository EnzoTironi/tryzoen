import { useContext, useRef, useState, type ComponentProps } from "react";
import {
  useMutation,
  useQueryClient,
  type InfiniteData,
  type QueryClient,
} from "@tanstack/react-query";
import { Text, View } from "react-native";
import type { z } from "zod";
import {
  MarkdownEditorProvider,
  type MarkdownEditorHandle,
} from "../markdown-editor";
import { CompanionSheet } from "../sheet";
import { ActionButton } from "../button";
import { useColors } from "../theme";
import {
  roomEditSchema,
  type RoomData,
  type roomPageSchema,
  type roomMessageSchema,
} from "./schema";

export function EditRoomMessage({
  data,
  roomId,
  cacheScope,
  item,
  onClose,
}: {
  readonly data: RoomData;
  readonly roomId: string;
  readonly cacheScope: string;
  readonly item: z.infer<typeof roomMessageSchema>;
  readonly onClose: () => void;
}) {
  const colors = useColors();
  const renderEditor = useContext(MarkdownEditorProvider);
  const { editor, baseline, error, setError, save, close, reload } =
    useMessageEdit({ data, roomId, cacheScope, item, onClose });
  return (
    <CompanionSheet title="Editar mensagem" onClose={close}>
      <View key={baseline.editId ?? baseline.id} style={{ height: 280 }}>
        {renderEditor?.({
          initialMarkdown: baseline.text,
          label: "Mensagem",
          description: "Edite sua mensagem",
          editable: !save.isPending,
          ref: editor,
          onChange: () => {
            setError(null);
          },
          onDirty: () => {
            setError(null);
          },
          onError: setError,
        })}
      </View>
      {(!renderEditor || error !== null || save.isError) && (
        <Text accessibilityRole="alert" style={{ color: colors.danger }}>
          {error ??
            (!renderEditor
              ? "Editor indisponível"
              : "Não foi possível salvar. Seu texto foi preservado; tente novamente.")}
        </Text>
      )}
      {save.data?.status === "conflict" && (
        <>
          <Text accessibilityRole="alert">
            Esta mensagem mudou em outro lugar. Seu rascunho foi preservado.
          </Text>
          <ActionButton
            quiet
            onPress={() => {
              reload();
            }}
          >
            Carregar versão atual
          </ActionButton>
        </>
      )}
      <ActionButton
        disabled={
          !renderEditor || save.isPending || save.data?.status === "conflict"
        }
        onPress={() => {
          save.mutate();
        }}
      >
        {save.isPending ? "Salvando…" : "Salvar alterações"}
      </ActionButton>
      <ActionButton quiet disabled={save.isPending} onPress={close}>
        Cancelar
      </ActionButton>
    </CompanionSheet>
  );
}

function useMessageEdit({
  data,
  roomId,
  cacheScope,
  item,
  onClose,
}: ComponentProps<typeof EditRoomMessage>) {
  const editor = useRef<MarkdownEditorHandle>(null);
  const operation = useRef<{ text: string; id: string } | null>(null);
  const [baseline, setBaseline] = useState(item);
  const [error, setError] = useState<string | null>(null);
  const client = useQueryClient();
  const save = useMutation({
    mutationFn: async () => {
      if (!editor.current) throw new Error("Editor indisponível");
      const text = (await editor.current.read()).trim();
      if (operation.current?.text !== text)
        operation.current = { text, id: data.operationId() };
      return data.editMessage(
        roomEditSchema.parse({
          id: roomId,
          messageId: item.id,
          text,
          expectedRevision: baseline.editId ?? baseline.id,
          operationId: operation.current.id,
        })
      );
    },
    onSuccess: async (result) => {
      if (result.status !== "saved") return;
      await updateEditedMessage(client, cacheScope, roomId, result.message);
      void client.invalidateQueries({
        queryKey: ["conversation-inbox", cacheScope],
      });
      onClose();
    },
  });
  const close = () => {
    if (!save.isPending) onClose();
  };
  const reload = () => {
    if (save.data) {
      setBaseline(save.data.message);
      operation.current = null;
      save.reset();
    }
  };
  return { editor, baseline, error, setError, save, close, reload };
}

async function updateEditedMessage(
  client: QueryClient,
  cacheScope: string,
  roomId: string,
  edited: z.infer<typeof roomMessageSchema>
) {
  for (const kind of ["matrix-messages", "matrix-thread"]) {
    const queryKey = [kind, cacheScope, roomId];
    await client.cancelQueries({ queryKey });
    const replace = (message: z.infer<typeof roomMessageSchema>) =>
      message.id === edited.id
        ? {
            ...message,
            text: edited.text,
            editId: edited.editId,
            editedAt: edited.editedAt,
            redacted: edited.redacted,
            reply: edited.reply,
          }
        : message;
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
            messages: page.messages.map(replace),
            ...(page.parent ? { parent: replace(page.parent) } : {}),
          })),
        }
    );
    void client.invalidateQueries({ queryKey, refetchType: "none" });
  }
}
