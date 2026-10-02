import { useI18n, Translated } from "./../i18n";

import { useState } from "react";
import {
  useMutation,
  useQueryClient,
  type InfiniteData,
} from "@tanstack/react-query";
import { Text, TextInput } from "react-native";
import type { z } from "zod";
import { ActionButton } from "../button";
import { usePageStyles } from "../page";
import { CompanionSheet } from "../sheet";
import { useColors } from "../theme";
import {
  roomRenameSchema,
  type RoomData,
  type roomSchema,
  type roomPageSchema,
} from "./schema";

export function RenameRoom({
  data,
  cacheScope,
  room,
  onClose,
}: {
  readonly data: RoomData;
  readonly cacheScope: string;
  readonly room: z.infer<typeof roomSchema>;
  readonly onClose: () => void;
}) {
  const { t } = useI18n();
  const colors = useColors();
  const pageStyles = usePageStyles();
  const [name, setName] = useState(room.label);
  const [expectedName, setExpectedName] = useState(room.label);
  const client = useQueryClient();
  const save = useMutation({
    mutationFn: () =>
      data.rename(roomRenameSchema.parse({ id: room.id, name, expectedName })),
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
      if (result.status === "saved") onClose();
    },
  });
  const conflict = save.data?.status === "conflict";
  const disabled =
    save.isPending || conflict || !name.trim() || name.trim() === expectedName;
  const close = () => {
    if (!save.isPending) onClose();
  };
  return (
    <CompanionSheet title={t("Nome do grupo")} onClose={close}>
      <Text style={pageStyles.copy}>
        {t("Visível para todos os participantes.")}
      </Text>
      <TextInput
        accessibilityLabel={t("Nome do grupo")}
        value={name}
        onChangeText={setName}
        editable={!save.isPending}
        maxLength={80}
        returnKeyType="done"
        onSubmitEditing={() => {
          if (!disabled) save.mutate();
        }}
        style={pageStyles.field}
      />
      {save.isError && (
        <Text accessibilityRole="alert" style={{ color: colors.danger }}>
          {t(
            "Não foi possível confirmar a alteração. O nome digitado foi preservado; tente novamente."
          )}
        </Text>
      )}
      {conflict && (
        <>
          <Text accessibilityRole="alert" style={pageStyles.copy}>
            <Translated
              message="O grupo foi renomeado para “{value1}” em outro lugar. Confira o nome atual antes de editar."
              values={{ value1: save.data?.room.label }}
            />
          </Text>
          <ActionButton
            quiet
            onPress={() => {
              const currentName = save.data?.room.label;
              if (currentName) {
                setName(currentName);
                setExpectedName(currentName);
                save.reset();
              }
            }}
          >
            {t("Carregar nome atual")}
          </ActionButton>
        </>
      )}
      <ActionButton
        disabled={disabled}
        onPress={() => {
          save.mutate();
        }}
      >
        {save.isPending ? t("Salvando…") : t("Salvar nome")}
      </ActionButton>
      <ActionButton quiet disabled={save.isPending} onPress={close}>
        {t("Cancelar")}
      </ActionButton>
    </CompanionSheet>
  );
}
