import { useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { Text, Pressable } from "react-native";
import { colors } from "../theme";
import { CompanionSheet } from "../sheet";
import { ActionButton } from "../button";
import type { RoomData } from "./schema";

export function ClearUnavailableSaved({
  data,
  cacheScope,
}: {
  readonly data: RoomData;
  readonly cacheScope: string;
}) {
  const [open, setOpen] = useState(false);
  const client = useQueryClient();
  const state = useQuery({
    queryKey: ["matrix-saved-cleanup", cacheScope],
    queryFn: () => data.savedCleanupState(),
    staleTime: 0,
    retry: 1,
  });
  const clear = useMutation({
    mutationFn: async () => {
      if (!state.data || state.isError) throw new Error("Estado indisponível");
      return data.clearUnavailableSavedMessages({
        revision: state.data.revision,
      });
    },
    onSuccess: async (result) => {
      await client.resetQueries({
        queryKey: ["matrix-saved", cacheScope],
        exact: true,
      });
      await state.refetch();
      if (result.status === "saved") setOpen(false);
    },
  });
  return (
    <>
      <Pressable
        accessibilityRole="button"
        style={({ pressed }) => ({
          alignSelf: "flex-start",
          minHeight: 44,
          justifyContent: "center",
          marginTop: 8,
          opacity: pressed ? 0.65 : 1,
        })}
        onPress={() => {
          setOpen(true);
          void state.refetch();
        }}
      >
        <Text style={{ color: colors.muted, fontSize: 13 }}>
          Limpar referências sem acesso
        </Text>
      </Pressable>
      {open && (
        <CompanionSheet
          title="Limpar referências sem acesso?"
          onClose={() => {
            if (!clear.isPending) setOpen(false);
          }}
        >
          <Text>
            {state.data && !state.isError
              ? `${state.data.count} referências sem acesso serão removidas das suas mensagens salvas, incluindo espaços dos quais você saiu.`
              : "Conferindo acesso às referências…"}{" "}
            As mensagens originais não serão alteradas.
          </Text>
          {(state.isError ||
            clear.isError ||
            clear.data?.status === "conflict") && (
            <Text accessibilityRole="alert">
              Não foi possível concluir ou a lista mudou. Atualize antes de
              tentar novamente.
            </Text>
          )}
          <ActionButton
            quiet
            onPress={() => {
              void state.refetch();
            }}
          >
            Atualizar contagem
          </ActionButton>
          <ActionButton
            disabled={
              state.isPending ||
              state.isError ||
              clear.isPending ||
              !state.data.count
            }
            onPress={() => {
              clear.mutate();
            }}
          >
            Remover referências sem acesso
          </ActionButton>
          <ActionButton
            quiet
            disabled={clear.isPending}
            onPress={() => {
              setOpen(false);
            }}
          >
            Cancelar
          </ActionButton>
        </CompanionSheet>
      )}
    </>
  );
}
