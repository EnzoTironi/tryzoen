import { useI18n } from "./../i18n";
import { Text, View } from "react-native";
import { ActionButton } from "../button";
import { systemFont, useColors } from "../theme";
import type { OutgoingMessage } from "./outbox";
import { useConversationOnline } from "./connection";

export function MessageDelivery({
  status,
  queued,
  onRetry,
  onRemove,
  failureText = "Não foi possível confirmar o envio.",
}: Pick<OutgoingMessage<unknown, unknown>, "status" | "queued"> & {
  readonly onRetry?: () => void;
  readonly onRemove?: () => void;
  readonly failureText?: string;
}) {
  const { t } = useI18n();
  const colors = useColors();
  const online = useConversationOnline();
  let label = online
    ? queued
      ? "Na fila"
      : "Enviando…"
    : "Aguardando conexão";
  if (status === "accepted")
    label = online ? "Sincronizando…" : "Enviado · aguardando sincronização";
  if (status === "failed") label = failureText;
  return (
    <View
      style={{
        alignItems: "flex-end",
        justifyContent: "center",
        minHeight: 44,
        gap: 4,
      }}
    >
      <Text
        accessibilityLiveRegion="polite"
        style={{
          fontFamily: systemFont,
          fontSize: 12,
          color: status === "failed" ? colors.danger : colors.muted,
        }}
      >
        {label}
      </Text>
      {status === "failed" && onRemove && (
        <ActionButton quiet onPress={onRemove}>
          {t("Remover deste dispositivo")}
        </ActionButton>
      )}
      {status === "failed" && onRetry && (
        <ActionButton quiet onPress={onRetry}>
          {t("Reenviar")}
        </ActionButton>
      )}
    </View>
  );
}
