import { useI18n } from "./../i18n";
import { useMemo, useSyncExternalStore } from "react";
import { onlineManager } from "@tanstack/react-query";
import { WifiOff, RefreshCw } from "lucide-react-native";
import { StyleSheet, Text, View } from "react-native";
import { systemFont, useColors } from "../theme";

const subscribe = (notify: () => void) => onlineManager.subscribe(notify);
const current = () => onlineManager.isOnline();
const server = () => true;

export function useConversationOnline() {
  return useSyncExternalStore(subscribe, current, server);
}

/** Overlay connection changes so the transcript and composer never jump. */
export function ConnectionStatus({
  reconnecting = false,
  top = 8,
}: {
  readonly reconnecting?: boolean;
  readonly top?: number;
}) {
  const { t } = useI18n();
  const colors = useColors();
  const styles = useMemo(() => createStyles(colors), [colors]);
  const online = useConversationOnline();
  if (online && !reconnecting) return null;
  const Icon = online ? RefreshCw : WifiOff;
  return (
    <View pointerEvents="none" style={[styles.position, { top }]}>
      <View style={styles.pill}>
        <Icon size={13} color={colors.muted} />
        <Text accessibilityLiveRegion="polite" style={styles.label}>
          {online ? t("Reconectando…") : t("Sem conexão · envios na fila")}
        </Text>
      </View>
    </View>
  );
}

function createStyles(colors: ReturnType<typeof useColors>) {
  return StyleSheet.create({
    position: {
      position: "absolute",
      left: 12,
      right: 12,
      alignItems: "center",
      zIndex: 5,
    },
    pill: {
      flexDirection: "row",
      alignItems: "center",
      gap: 7,
      paddingHorizontal: 12,
      paddingVertical: 7,
      borderRadius: 20,
      backgroundColor: "#f2f2f7",
      borderWidth: StyleSheet.hairlineWidth,
      borderColor: "#d9d9df",
      maxWidth: "100%",
    },
    label: {
      fontFamily: systemFont,
      fontSize: 12,
      lineHeight: 16,
      color: colors.muted,
      flexShrink: 1,
    },
  });
}
