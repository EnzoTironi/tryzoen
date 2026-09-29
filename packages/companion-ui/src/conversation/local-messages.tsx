import { useEffect, useState, type ReactNode } from "react";
import { useQueryClient } from "@tanstack/react-query";
import { ActivityIndicator, Text, View } from "react-native";
import {
  MessagePersistence,
  LocalMessagesContext,
  type MessageStorage,
} from "./persistence";
import { ActionButton } from "../button";
import { colors } from "../theme";

export function LocalMessagesProvider(props: {
  readonly storage: MessageStorage;
  readonly children: ReactNode;
}) {
  const [attempt, setAttempt] = useState(0);
  return (
    <LocalMessagesSession
      key={attempt}
      {...props}
      onRetry={() => {
        setAttempt((current) => current + 1);
      }}
    />
  );
}

function LocalMessagesSession({
  storage,
  children,
  onRetry,
}: {
  readonly storage: MessageStorage;
  readonly children: ReactNode;
  readonly onRetry: () => void;
}) {
  const client = useQueryClient();
  const [persistence, setPersistence] = useState<MessagePersistence>();
  const [error, setError] = useState<string>();
  useEffect(() => {
    let active = true;
    const messages = new MessagePersistence(client, storage, (message) => {
      if (active) setError(message);
    });
    void messages
      .restore()
      .then(() => {
        if (active) setPersistence(messages);
      })
      .catch(() => {
        if (active)
          setError(
            "Não foi possível recuperar os rascunhos deste dispositivo. Reabra o app para tentar novamente."
          );
      });
    return () => {
      active = false;
      messages.close();
    };
  }, [client, storage]);
  return (
    <LocalMessagesContext.Provider value={persistence}>
      {error && (
        <Text
          accessibilityRole="alert"
          style={{ color: colors.danger, padding: 12 }}
        >
          {error}
        </Text>
      )}
      {!persistence && error && (
        <ActionButton onPress={onRetry}>Tentar novamente</ActionButton>
      )}
      {persistence
        ? children
        : !error && (
            <View style={{ flex: 1, justifyContent: "center" }}>
              <ActivityIndicator accessibilityLabel="Recuperando rascunhos" />
            </View>
          )}
    </LocalMessagesContext.Provider>
  );
}

export type { MessageStorage } from "./persistence";
