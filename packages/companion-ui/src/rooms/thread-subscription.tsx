import { useMemo } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { Bell, BellRing } from "lucide-react-native";
import { Pressable, StyleSheet, Text, View } from "react-native";
import { systemFont, useColors } from "../theme";
import type { RoomData } from "./schema";

export function ThreadSubscription({
  data,
  cacheScope,
  roomId,
  rootId,
  active,
}: {
  readonly data: RoomData;
  readonly cacheScope: string;
  readonly roomId: string;
  readonly rootId: string;
  readonly active: boolean;
}) {
  const colors = useColors();
  const styles = useMemo(() => createStyles(colors), [colors]);
  const client = useQueryClient();
  const queryKey = ["matrix-thread-subscription", cacheScope, roomId, rootId];
  const current = useQuery({
    queryKey,
    queryFn: ({ signal }) =>
      data.threadSubscription({ id: roomId, rootId }, signal),
    enabled: active,
    staleTime: 15_000,
    retry: false,
  });
  const change = useMutation({
    mutationKey: queryKey,
    scope: { id: JSON.stringify(queryKey) },
    networkMode: "always",
    retry: false,
    mutationFn: (following: boolean) =>
      data.setThreadSubscription({ id: roomId, rootId, following }),
    onSuccess: (result) =>
      client.setQueryData(
        queryKey,
        (previous: typeof result | undefined) => previous && result
      ),
  });
  if (current.data?.status === "unsupported") return null;
  const following = change.isPending
    ? change.variables
    : current.data?.status === "ready" && current.data.following;
  const Icon = following ? BellRing : Bell;
  const failed =
    current.isError || change.isError || current.data?.status === "unconfirmed";
  return (
    <View style={styles.section}>
      <Pressable
        accessibilityRole="button"
        accessibilityLabel={
          failed
            ? "Conferir assinatura da thread"
            : following
              ? "Deixar de acompanhar thread"
              : "Acompanhar thread"
        }
        aria-pressed={following}
        aria-disabled={!active || current.isPending}
        disabled={!active || current.isPending}
        onPress={() => {
          if (failed) {
            change.reset();
            void current.refetch();
          } else change.mutate(!following);
        }}
        style={({ pressed }) => [styles.control, pressed && styles.pressed]}
      >
        <Icon size={18} color={colors.ink} />
        <Text style={styles.label}>
          {failed
            ? "Conferir novamente"
            : following
              ? "Acompanhando"
              : "Acompanhar thread"}
        </Text>
        <Text style={styles.caption}>
          {change.isPending ? "Salvando…" : ""}
        </Text>
      </Pressable>
      {failed && (
        <Text accessibilityRole="alert" style={styles.error}>
          {current.data?.status === "unconfirmed"
            ? "Resposta enviada. Confira os alertas desta thread."
            : "Não foi possível confirmar os alertas desta thread."}
        </Text>
      )}
    </View>
  );
}

function createStyles(colors: ReturnType<typeof useColors>) {
  return StyleSheet.create({
    section: { paddingHorizontal: 16 },
    control: {
      minHeight: 44,
      flexDirection: "row",
      alignItems: "center",
      gap: 8,
    },
    pressed: { opacity: 0.65 },
    label: { fontFamily: systemFont, fontSize: 13, color: colors.ink },
    caption: { fontFamily: systemFont, fontSize: 12, color: colors.muted },
    error: {
      fontFamily: systemFont,
      fontSize: 12,
      color: colors.muted,
      paddingBottom: 8,
    },
  });
}
