import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { Circle } from "lucide-react-native";
import {
  ActivityIndicator,
  StyleSheet,
  Switch,
  Text,
  View,
} from "react-native";
import type { z } from "zod";
import { ActionButton } from "../button";
import { colors } from "../theme";
import type { RoomData, roomPresenceSchema } from "./schema";

export function PresenceIndicator({
  state,
}: {
  readonly state?: z.infer<typeof roomPresenceSchema>["state"];
}) {
  if (!state || state === "offline") return null;
  return (
    <View style={styles.status}>
      <View
        style={[
          styles.dot,
          { backgroundColor: state === "online" ? "#248a3d" : "#a36b00" },
        ]}
      />
      <Text style={styles.caption}>
        {state === "online" ? "Online" : "Ausente"}
      </Text>
    </View>
  );
}

export function PresenceSettings({
  data,
  cacheScope,
  roomId,
}: {
  readonly data: RoomData;
  readonly cacheScope: string;
  readonly roomId: string;
}) {
  const client = useQueryClient();
  const queryKey = ["matrix-presence-preference", cacheScope];
  const preference = useQuery({
    queryKey,
    queryFn: ({ signal }) => data.presencePreference({ id: roomId }, signal),
    staleTime: 30_000,
    retry: false,
  });
  const change = useMutation({
    scope: { id: JSON.stringify(queryKey) },
    mutationFn: (sharing: boolean) =>
      data.setPresencePreference({ id: roomId, sharing }),
    onSuccess: (result) => {
      client.setQueryData(
        queryKey,
        (current: typeof result | undefined) => current && result
      );
    },
    onError: () => void client.invalidateQueries({ queryKey }),
  });
  const sharing = change.isPending
    ? change.variables
    : preference.data?.sharing;
  return (
    <View style={styles.section}>
      <View style={styles.row}>
        <View style={styles.icon}>
          <Circle size={17} fill="white" color="white" />
        </View>
        <Text style={styles.label}>Mostrar quando estou online</Text>
        {preference.data && !preference.isError ? (
          <Switch
            accessibilityLabel="Mostrar quando estou online"
            accessibilityHint="Compartilha sua presença nas conversas em comum, em todos os seus dispositivos."
            value={sharing}
            onValueChange={(value) => {
              change.mutate(value);
            }}
            trackColor={{ false: "#e5e5ea", true: "#34c759" }}
          />
        ) : preference.isPending ? (
          <ActivityIndicator accessibilityLabel="Carregando preferência de presença" />
        ) : null}
      </View>
      <Text style={styles.caption}>
        Sua presença fica visível para as pessoas nas conversas em comum
        enquanto você usa o chat. Esta escolha vale para todos os seus
        dispositivos.
      </Text>
      {(preference.isError || change.isError) && (
        <View style={styles.section}>
          <Text accessibilityRole="alert" style={styles.caption}>
            Não foi possível confirmar sua preferência.
          </Text>
          <ActionButton
            quiet
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

const styles = StyleSheet.create({
  section: { gap: 10 },
  row: {
    flexDirection: "row",
    alignItems: "center",
    gap: 12,
    minHeight: 64,
    paddingHorizontal: 16,
    paddingVertical: 12,
    borderRadius: 20,
    backgroundColor: colors.surface,
  },
  icon: {
    width: 32,
    height: 32,
    borderRadius: 9,
    backgroundColor: "#248a3d",
    alignItems: "center",
    justifyContent: "center",
  },
  label: { flex: 1, color: colors.ink, fontSize: 16 },
  caption: { fontSize: 13, lineHeight: 18, color: colors.muted },
  status: { flexDirection: "row", alignItems: "center", gap: 5 },
  dot: { width: 7, height: 7, borderRadius: 4 },
});
