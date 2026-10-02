import { useI18n } from "./../i18n";
import { useRef, useState } from "react";
import { Text, TextInput } from "react-native";
import { useMutation, useQueryClient } from "@tanstack/react-query";
import { CompanionSheet } from "../sheet";
import { ActionButton } from "../button";
import { usePageStyles } from "../page";
import type { RoomData } from "./schema";

export function CreateRoom({
  data,
  cacheScope,
  onCreated,
  onClose,
}: {
  readonly data: RoomData;
  readonly cacheScope: string;
  readonly onCreated: (id: string) => void;
  readonly onClose: () => void;
}) {
  const { t } = useI18n();
  const pageStyles = usePageStyles();
  const [name, setName] = useState("");
  const operationId = useRef<string | undefined>(undefined);
  const client = useQueryClient();
  const create = useMutation({
    mutationFn: () =>
      data.create({
        operationId: (operationId.current ??= data.operationId()),
        name: name.trim(),
      }),
    onSuccess: async (room) => {
      await client.invalidateQueries({
        queryKey: ["conversation-inbox", cacheScope],
      });
      onCreated(room.id);
    },
  });
  return (
    <CompanionSheet
      title={t("Criar grupo")}
      onClose={() => {
        if (!create.isPending) onClose();
      }}
    >
      <Text style={pageStyles.copy}>
        {t("Um espaço para conversar com as pessoas e o Zoen da sua equipe.")}
      </Text>
      <TextInput
        accessibilityLabel={t("Nome do grupo")}
        placeholder={t("Nome do grupo")}
        value={name}
        onChangeText={(value) => {
          setName(value);
          operationId.current = undefined;
        }}
        editable={!create.isPending}
        maxLength={80}
        style={pageStyles.field}
      />
      <ActionButton
        disabled={!name.trim() || create.isPending}
        onPress={() => {
          create.mutate();
        }}
      >
        {t("Criar grupo")}
      </ActionButton>
      {create.error && (
        <Text accessibilityRole="alert" style={pageStyles.copy}>
          {t("Não foi possível criar o grupo. Tente novamente.")}
        </Text>
      )}
    </CompanionSheet>
  );
}
