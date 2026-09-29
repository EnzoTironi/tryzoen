import { useState } from "react";
import {
  useMutation,
  useQueryClient,
  type InfiniteData,
} from "@tanstack/react-query";
import { Text, TextInput } from "react-native";
import type { z } from "zod";
import { ActionButton } from "../button";
import { pageStyles } from "../page";
import { CompanionSheet } from "../sheet";
import { colors } from "../theme";
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
    <CompanionSheet title="Nome do grupo" onClose={close}>
      <Text style={pageStyles.copy}>Visível para todos os participantes.</Text>
      <TextInput
        accessibilityLabel="Nome do grupo"
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
          Não foi possível confirmar a alteração. O nome digitado foi
          preservado; tente novamente.
        </Text>
      )}
      {conflict && (
        <>
          <Text accessibilityRole="alert" style={pageStyles.copy}>
            O grupo foi renomeado para “{save.data?.room.label}” em outro lugar.
            Confira o nome atual antes de editar.
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
            Carregar nome atual
          </ActionButton>
        </>
      )}
      <ActionButton
        disabled={disabled}
        onPress={() => {
          save.mutate();
        }}
      >
        {save.isPending ? "Salvando…" : "Salvar nome"}
      </ActionButton>
      <ActionButton quiet disabled={save.isPending} onPress={close}>
        Cancelar
      </ActionButton>
    </CompanionSheet>
  );
}
