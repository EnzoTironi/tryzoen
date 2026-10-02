import { useI18n } from "./../i18n";
import { useState, type ComponentProps } from "react";
import {
  useMutation,
  useQueryClient,
  type InfiniteData,
} from "@tanstack/react-query";
import { Text, View } from "react-native";
import type { z } from "zod";
import { useAttachments } from "../attachments/provider";
import { ConversationAvatar } from "../chats/avatar";
import { ActionButton } from "../button";
import { CompanionSheet } from "../sheet";
import { usePageStyles } from "../page";
import { useColors } from "../theme";
import {
  roomAvatarFileSchema,
  type roomAvatarWriteSchema,
  type roomPageSchema,
} from "./schema";
import type { RenameRoom } from "./rename";

export function EditRoomAvatar({
  data,
  cacheScope,
  room,
  onClose,
}: ComponentProps<typeof RenameRoom>) {
  const { t } = useI18n();
  const colors = useColors();
  const pageStyles = usePageStyles();
  const attachments = useAttachments();
  const client = useQueryClient();
  const [selection, setSelection] =
    useState<
      Pick<z.infer<typeof roomAvatarWriteSchema>, "file" | "operationId">
    >();
  const [expectedRevision, setExpectedRevision] = useState(
    room.avatarRevision ?? null
  );
  const [currentUri, setCurrentUri] = useState(room.avatarUri);
  const [picking, setPicking] = useState(false);
  const [pickError, setPickError] = useState(false);
  const save = useMutation({
    retry: false,
    networkMode: "always",
    scope: { id: `group-avatar:${cacheScope}:${room.id}` },
    mutationFn: (selected: NonNullable<typeof selection>) =>
      data.setAvatar({ id: room.id, expectedRevision, ...selected }),
    onSuccess: async (result) => {
      for (const kind of ["matrix-messages", "matrix-thread"]) {
        const filter = { queryKey: [kind, cacheScope, room.id] };
        await client.cancelQueries(filter);
        client.setQueriesData<InfiniteData<z.infer<typeof roomPageSchema>>>(
          filter,
          (current) =>
            current && {
              ...current,
              pages: current.pages.map((page) => ({
                ...page,
                room: result.room,
              })),
            }
        );
      }
      void client.invalidateQueries({
        queryKey: ["conversation-inbox", cacheScope],
      });
      void client.invalidateQueries({
        queryKey: ["matrix-room-directory", cacheScope],
      });
      if (result.status === "saved") onClose();
    },
  });
  const busy = picking || save.isPending;
  const conflict = save.data?.status === "conflict";
  const close = () => {
    if (!busy) onClose();
  };
  return (
    <CompanionSheet title={t("Foto do grupo")} onClose={close} maxWidth={480}>
      <View style={{ alignItems: "center", paddingVertical: 16 }}>
        <ConversationAvatar
          name={room.label}
          group
          size={112}
          uri={selection ? selection.file?.url : (currentUri ?? undefined)}
        />
      </View>
      <Text style={pageStyles.copy}>
        {t(
          "Visível para todos os participantes. O enquadramento central será usado como foto do grupo."
        )}
      </Text>
      <ActionButton
        quiet
        disabled={busy || conflict || !attachments}
        onPress={() => {
          if (!attachments) return;
          setPicking(true);
          setPickError(false);
          void attachments
            .pick()
            .then((files) => {
              if (!files.length) return;
              const picked =
                files.length === 1
                  ? roomAvatarFileSchema.safeParse(files[0])
                  : undefined;
              if (!picked?.success) {
                setPickError(true);
                return;
              }
              save.reset();
              setSelection({
                file: picked.data,
                operationId: data.operationId(),
              });
            })
            .catch(() => {
              setPickError(true);
            })
            .finally(() => {
              setPicking(false);
            });
        }}
      >
        {picking ? t("Abrindo…") : t("Escolher foto")}
      </ActionButton>
      {(!!currentUri || !!selection?.file) && (
        <ActionButton
          quiet
          disabled={busy || conflict}
          onPress={() => {
            save.reset();
            setSelection({ file: null, operationId: data.operationId() });
          }}
        >
          {t("Remover foto")}
        </ActionButton>
      )}
      <Text style={pageStyles.copy}>
        {t(
          "JPEG, PNG, WebP ou AVIF, até 3 MB e 24 megapixels. A foto será reduzida e seus metadados removidos."
        )}
      </Text>
      {pickError && (
        <Text accessibilityRole="alert" style={{ color: colors.danger }}>
          {t("Selecione uma única imagem nos formatos e limites indicados.")}
        </Text>
      )}
      {save.isError && (
        <Text accessibilityRole="alert" style={{ color: colors.danger }}>
          {t(
            "Não foi possível confirmar a foto. Sua escolha foi preservada. Confira o formato e a conexão e tente novamente."
          )}
        </Text>
      )}
      {conflict && (
        <>
          <Text accessibilityRole="alert" style={pageStyles.copy}>
            {t(
              "Outra pessoa alterou a foto. Confira a versão atual antes de substituir."
            )}
          </Text>
          <ActionButton
            quiet
            onPress={() => {
              setCurrentUri(save.data?.room.avatarUri);
              setExpectedRevision(save.data?.room.avatarRevision ?? null);
              setSelection(undefined);
              save.reset();
            }}
          >
            {t("Ver foto atual")}
          </ActionButton>
        </>
      )}
      <ActionButton
        disabled={busy || conflict || !selection}
        onPress={() => {
          if (selection) save.mutate(selection);
        }}
      >
        {save.isPending ? t("Salvando…") : t("Salvar foto")}
      </ActionButton>
      <ActionButton quiet disabled={busy} onPress={close}>
        {t("Cancelar")}
      </ActionButton>
    </CompanionSheet>
  );
}
