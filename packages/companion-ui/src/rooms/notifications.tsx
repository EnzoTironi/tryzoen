import { useMemo } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { BellOff } from "lucide-react-native";
import {
  ActivityIndicator,
  StyleSheet,
  Switch,
  Text,
  View,
} from "react-native";
import { ActionButton } from "../button";
import { systemFont, useColors } from "../theme";
import type { RoomData } from "./schema";

export function RoomNotificationSettings({
  data,
  cacheScope,
  roomId,
}: {
  readonly data: RoomData;
  readonly cacheScope: string;
  readonly roomId: string;
}) {
  const colors = useColors();
  const styles = useMemo(() => createStyles(colors), [colors]);
  const client = useQueryClient();
  const queryKey = ["matrix-room-notifications", cacheScope, roomId];
  const preference = useQuery({
    queryKey,
    queryFn: ({ signal }) => data.notifications({ id: roomId }, signal),
    retry: false,
    staleTime: 30_000,
  });
  const change = useMutation({
    scope: { id: JSON.stringify(queryKey) },
    mutationFn: (muted: boolean) =>
      data.setNotifications({ id: roomId, muted }),
    onSuccess: (result) => {
      client.setQueryData(
        queryKey,
        (current: typeof result | undefined) => current && result
      );
    },
  });
  const failed = preference.isError || change.isError;
  const busy = preference.isPending;
  const displayedMuted = change.isPending
    ? change.variables
    : preference.data?.muted;
  return (
    <View style={styles.section}>
      <View style={styles.row}>
        <View style={styles.icon}>
          <BellOff size={20} color={colors.surface} />
        </View>
        <Text style={styles.label}>Silenciar conversa</Text>
        {preference.data && !preference.isError ? (
          <Switch
            accessibilityLabel="Silenciar conversa"
            accessibilityHint="Silencia novos alertas e menções desta conversa para você."
            value={displayedMuted}
            onValueChange={(muted) => {
              change.mutate(muted);
            }}
            disabled={busy || preference.isError}
            trackColor={{ false: "#e5e5ea", true: "#34c759" }}
          />
        ) : busy ? (
          <ActivityIndicator accessibilityLabel="Carregando notificações da conversa" />
        ) : null}
      </View>
      <Text style={styles.caption}>
        {displayedMuted && !preference.isError
          ? "Silenciada até você reativar. Você continua recebendo as mensagens, sem novos alertas nem menções."
          : "Silencie novos alertas, inclusive menções. As mensagens continuam na conversa."}
      </Text>
      {failed && (
        <View style={styles.error}>
          <Text accessibilityRole="alert" style={styles.caption}>
            Não foi possível confirmar a preferência. Confira novamente antes de
            alterar.
          </Text>
          <ActionButton
            quiet
            disabled={busy}
            onPress={() => {
              change.reset();
              void preference.refetch();
            }}
          >
            Conferir novamente
          </ActionButton>
        </View>
      )}
    </View>
  );
}
function createStyles(colors: ReturnType<typeof useColors>) {
  return StyleSheet.create({
    section: { gap: 10 },
    row: {
      flexDirection: "row",
      alignItems: "center",
      gap: 12,
      minHeight: 64,
      paddingHorizontal: 16,
      borderRadius: 20,
      backgroundColor: colors.surface,
    },
    icon: {
      width: 32,
      height: 32,
      borderRadius: 9,
      backgroundColor: "#ad68d8",
      alignItems: "center",
      justifyContent: "center",
    },
    label: { fontFamily: systemFont, flex: 1, fontSize: 16, color: colors.ink },
    caption: {
      fontFamily: systemFont,
      fontSize: 12,
      lineHeight: 18,
      color: colors.muted,
      paddingHorizontal: 14,
    },
    error: { gap: 8 },
  });
}
