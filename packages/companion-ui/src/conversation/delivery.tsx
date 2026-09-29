import { Text, View } from "react-native";
import { ActionButton } from "../button";
import { colors } from "../theme";
import type { OutgoingMessage } from "./outbox";

export function MessageDelivery({
  status,
  onRetry,
  failureText = "Não foi possível confirmar o envio.",
}: Pick<OutgoingMessage<unknown, unknown>, "status"> & {
  readonly onRetry?: () => void;
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
      {status === "failed" && onRetry && (
        <ActionButton quiet onPress={onRetry}>
          Reenviar
        </ActionButton>
      )}
    </View>
  );
}
