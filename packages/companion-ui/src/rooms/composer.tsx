import { StyleSheet, Text, View } from "react-native";
import { Composer } from "../composer";
import { colors } from "../theme";
import type { useRoomDraft } from "./draft";

export function RoomComposer({
  draft,
  disabled,
  paused = false,
  visible = true,
  thread = false,
  direct = false,
  onTyping,
}: {
  readonly draft: ReturnType<typeof useRoomDraft>;
  readonly disabled: boolean;
  readonly paused?: boolean;
  readonly visible?: boolean;
  readonly thread?: boolean;
  readonly direct?: boolean;
  readonly onTyping?: (typing: boolean) => void;
}) {
  const reply = disabled ? undefined : draft.reply;
  return (
    <View style={styles.composer}>
      {paused && visible && !disabled && (
        <Text accessibilityLiveRegion="polite" style={styles.connection}>
          Reconectando… Você pode continuar escrevendo.
        </Text>
      )}
      <Composer
        value={disabled ? "" : draft.text}
        onChangeText={(text) => {
          draft.change(text);
          onTyping?.(text.trim().length > 0);
        }}
        reply={
          reply
            ? {
                id: reply.id,
                text: reply.text,
                role: reply.bot ? "assistant" : "user",
                sender: reply.mine ? "você" : reply.sender,
              }
            : undefined
        }
        onRemoveReply={() => {
          draft.replyTo();
        }}
        selectedFiles={disabled ? [] : (draft.files ?? [])}
        onFilesChange={draft.changeFiles}
        maxLength={8000}
        label={
          thread
            ? "Responder à thread"
            : direct
              ? "Mensagem direta"
              : "Mensagem ao grupo"
        }
        placeholder={thread ? "Responder…" : "Mensagem…"}
        disabled={disabled}
        sendDisabled={!visible}
        onSend={(message) => {
          onTyping?.(false);
          return draft.send(message);
        }}
      />
    </View>
  );
}

const styles = StyleSheet.create({
  composer: { padding: 16 },
  connection: {
    color: colors.muted,
    fontSize: 13,
    lineHeight: 18,
    textAlign: "center",
    marginBottom: 10,
  },
});
