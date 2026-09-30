import { useMemo } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { CheckCheck, Circle } from "lucide-react-native";
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

export function RoomPrivacySettings({
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
  return (
    <View style={styles.section}>
      <PrivacyPreference
        cacheKey="matrix-presence-preference"
        cacheScope={cacheScope}
        label="Mostrar quando estou online"
        icon={Circle}
        description="Sua presença fica visível para as pessoas nas conversas em comum enquanto você usa o chat. Esta escolha vale para todos os seus dispositivos."
        read={async (signal) =>
          (await data.presencePreference({ id: roomId }, signal)).sharing
        }
        save={async (sharing) =>
          (await data.setPresencePreference({ id: roomId, sharing })).sharing
        }
      />
      <PrivacyPreference
        cacheKey="matrix-read-receipt-preference"
        cacheScope={cacheScope}
        label="Confirmações de leitura"
        icon={CheckCheck}
        description="Mostra quando você lê mensagens, em todas as suas conversas e dispositivos. Desativar interrompe novas confirmações; as já compartilhadas continuam visíveis."
        read={async (signal) =>
          (await data.readReceiptPreference({ id: roomId }, signal)).enabled
        }
        save={async (enabled) =>
          (await data.setReadReceiptPreference({ id: roomId, enabled })).enabled
        }
      />
    </View>
  );
}

function PrivacyPreference({
  cacheKey,
  cacheScope,
  label,
  description,
  icon: Icon,
  read,
  save,
}: {
  readonly cacheKey: string;
  readonly cacheScope: string;
  readonly label: string;
  readonly description: string;
  readonly icon: typeof Circle;
  readonly read: (signal: AbortSignal) => Promise<boolean>;
  readonly save: (enabled: boolean) => Promise<boolean>;
}) {
  const colors = useColors();
  const styles = useMemo(() => createStyles(colors), [colors]);
  const client = useQueryClient();
  const queryKey = [cacheKey, cacheScope];
  const preference = useQuery({
    queryKey,
    queryFn: ({ signal }) => read(signal),
    staleTime: 30_000,
    retry: false,
  });
  const change = useMutation({
    scope: { id: JSON.stringify(queryKey) },
    networkMode: "always",
    retry: false,
    mutationFn: save,
    onMutate: () => client.cancelQueries({ queryKey }),
    onSuccess: (result) =>
      client.setQueryData(queryKey, (current: boolean | undefined) =>
        current === undefined ? current : result
      ),
    onError: () => void client.invalidateQueries({ queryKey }),
  });
  return (
    <View style={styles.section}>
      <View style={styles.row}>
        <View style={styles.icon}>
          <Icon size={18} color="white" />
        </View>
        <Text style={styles.label}>{label}</Text>
        {preference.data !== undefined && !preference.isError ? (
          <Switch
            accessibilityLabel={label}
            accessibilityHint={description}
            value={change.isPending ? change.variables : preference.data}
            onValueChange={(value) => {
              change.mutate(value);
            }}
            trackColor={{ false: "#e5e5ea", true: "#34c759" }}
            thumbColor="white"
          />
        ) : preference.isPending ? (
          <ActivityIndicator accessibilityLabel={`Carregando: ${label}`} />
        ) : null}
      </View>
      <Text style={styles.caption}>{description}</Text>
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

function createStyles(colors: ReturnType<typeof useColors>) {
  return StyleSheet.create({
    section: { gap: 12 },
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
    label: { fontFamily: systemFont, flex: 1, color: colors.ink, fontSize: 16 },
    caption: {
      fontFamily: systemFont,
      fontSize: 13,
      lineHeight: 18,
      color: colors.muted,
    },
  });
}
