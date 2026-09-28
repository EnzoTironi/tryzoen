import { StyleSheet, View } from "react-native";
import { Composer } from "../composer";
import type { useRoomDraft } from "./draft";

export function RoomComposer({
  draft,
  disabled,
  thread = false,
  direct = false,
}: {
  readonly draft: ReturnType<typeof useRoomDraft>;
  readonly disabled: boolean;
  readonly thread?: boolean;
  readonly direct?: boolean;
}) {
  const reply = disabled ? undefined : draft.reply;
  return (
    <View style={styles.composer}>
      <Composer
        value={disabled ? "" : draft.text}
        onChangeText={draft.change}
        sendStatus={draft.status}
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
        onSend={draft.send}
      />
    </View>
  );
}

const styles = StyleSheet.create({
  composer: { padding: 16 },
});
