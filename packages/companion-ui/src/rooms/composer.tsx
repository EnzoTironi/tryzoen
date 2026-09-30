import { useMemo } from "react";
import { StyleSheet, Text, useWindowDimensions, View } from "react-native";
import { Composer } from "../composer";
import { systemFont, useColors } from "../theme";
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
  const colors = useColors();
  const compact = useWindowDimensions().width < 720;
  const styles = useMemo(
    () => createStyles(colors, compact),
    [colors, compact]
  );
  const reply = disabled ? undefined : draft.reply;
  return (
    <View pointerEvents="box-none" style={styles.composer}>
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

function createStyles(colors: ReturnType<typeof useColors>, compact = true) {
  return StyleSheet.create({
    composer: {
      paddingHorizontal: compact ? 24 : 10,
      paddingTop: 8,
      paddingBottom: compact ? 10 : 8,
    },
    connection: {
      fontFamily: systemFont,
      color: colors.muted,
      fontSize: 13,
      lineHeight: 18,
      textAlign: "center",
      marginBottom: 10,
    },
  });
}
