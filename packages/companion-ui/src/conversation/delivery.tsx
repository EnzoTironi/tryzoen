import { Text, View } from "react-native";
import { ActionButton } from "../button";
import { colors } from "../theme";
import type { OutgoingMessage } from "./outbox";

export function MessageDelivery({
  status,
  onRetry,
  onRemove,
  failureText = "Não foi possível confirmar o envio.",
}: Pick<OutgoingMessage<unknown, unknown>, "status"> & {
  readonly onRetry?: () => void;
  readonly onRemove?: () => void;
  readonly failureText?: string;
}) {
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
          fontSize: 12,
          color: status === "failed" ? colors.danger : colors.muted,
        }}
      >
        {status === "failed"
          ? failureText
          : status === "accepted"
            ? "Sincronizando…"
            : "Enviando…"}
      </Text>
      {status === "failed" && onRemove && (
        <ActionButton quiet onPress={onRemove}>
          Remover deste dispositivo
        </ActionButton>
      )}
      {status === "failed" && onRetry && (
        <ActionButton quiet onPress={onRetry}>
          Reenviar
        </ActionButton>
      )}
    </View>
  );
}
