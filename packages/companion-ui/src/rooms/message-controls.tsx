import { useI18n } from "./../i18n";
import { useMemo } from "react";
import { ReportRoomMessage } from "./report-message";
import { PinRoomMessage } from "./pins";
import { RoomReactors } from "./reactors";
import { SaveRoomMessage } from "./save-message";
import type { ComponentProps } from "react";
import { Pressable, StyleSheet, Text, View } from "react-native";
import type { z } from "zod";
import { MessageActions } from "../message-actions";
import { systemFont, useColors } from "../theme";
import { EditRoomMessage } from "./edit-message";
import { DeleteRoomMessage } from "./delete-message";
import { ForwardRoomMessage } from "./forward-message";
import type { RoomMessages } from "./messages";
import type { roomMessageSchema, roomReactionSummarySchema } from "./schema";

export function RoomMessageControls({
  onAction,
  item,
  reaction,
  onReact,
  onReply,
  onCopy,
  messageLink,
  onThread,
  onUnread,
}: Pick<
  ComponentProps<typeof RoomMessages>,
  "onReact" | "onReply" | "onCopy" | "messageLink" | "onThread" | "onUnread"
> & {
  readonly onAction: (
    action: ComponentProps<typeof RoomMessageDialog>["action"]
  ) => void;
  readonly item: z.infer<typeof roomMessageSchema>;
  readonly reaction?: z.infer<typeof roomReactionSummarySchema>;
}) {
  const colors = useColors();
  const styles = useMemo(() => createStyles(colors), [colors]);
  return (
    <>
      <View style={[styles.actions, item.mine && styles.outgoing]}>
        {!item.redacted && (
          <MessageActions
            reactionSummary={
              <RoomReactionSummary
                reaction={reaction}
                onOpen={() => {
                  onAction("reactors");
                }}
              />
            }
            messageLink={messageLink?.(item.id)}
            onUnread={onUnread}
            onPin={() => {
              onAction("pin");
            }}
            onViewReactions={
              reaction?.reactions.length
                ? () => {
                    onAction("reactors");
                  }
                : undefined
            }
            onThread={
              onThread
                ? () => {
                    onThread(item);
                  }
                : undefined
            }
            onForward={() => {
              onAction("forward");
            }}
            onSave={() => {
              onAction("save");
            }}
            onEdit={
              item.mine && !item.media
                ? () => {
                    onAction("edit");
                  }
                : undefined
            }
            onReport={
              item.mine
                ? undefined
                : () => {
                    onAction("report");
                  }
            }
            onDelete={
              item.mine
                ? () => {
                    onAction("delete");
                  }
                : undefined
            }
            text={item.text}
            outgoing={item.mine}
            onCopy={onCopy}
            onReply={() => {
              onReply(item);
            }}
            reaction={reaction?.mine}
            reactionCount={
              reaction?.reactions.find((entry) => entry.emoji === reaction.mine)
                ?.count
            }
            onReact={(emoji) => onReact(item.id, emoji)}
          />
        )}
      </View>
    </>
  );
}

export function RoomThreadAction({
  item,
  onThread,
}: Pick<ComponentProps<typeof RoomMessageControls>, "item" | "onThread">) {
  const { t } = useI18n();
  const colors = useColors();
  const styles = useMemo(() => createStyles(colors), [colors]);
  return (
    <>
      {onThread && item.replies > 0 && (
        <Pressable
          accessibilityRole="button"
          accessibilityLabel={t("Abrir thread de {value1}: {value2}", {
            value1: item.sender,
            value2: item.text.slice(0, 80),
          })}
          onPress={() => {
            onThread(item);
          }}
          style={({ pressed }) => [styles.reply, pressed && styles.pressed]}
        >
          <Text style={styles.replyText}>
            {item.replies} {item.replies === 1 ? t("resposta") : t("respostas")}
          </Text>
        </Pressable>
      )}
    </>
  );
}

function RoomReactionSummary({
  reaction,
  onOpen,
}: Pick<ComponentProps<typeof RoomMessageControls>, "reaction"> & {
  readonly onOpen: () => void;
}) {
  const { t } = useI18n();
  const colors = useColors();
  const styles = useMemo(() => createStyles(colors), [colors]);
  if (!reaction?.reactions.length) return null;
  const count = reaction.reactions.reduce((sum, entry) => sum + entry.count, 0);
  const label = reaction.reactions
    .map(
      (entry) =>
        `${entry.emoji}: ${entry.count}${reaction.complete ? "" : " ou mais"} reações`
    )
    .join(", ");
  return (
    <Pressable
      style={[styles.reaction, reaction.mine && styles.myReaction]}
      hitSlop={{ top: 7, bottom: 7 }}
      accessibilityRole="button"
      accessibilityLabel={t("Ver quem reagiu. {value1}", { value1: label })}
      onPress={onOpen}
    >
      <Text
        accessibilityLabel={label}
        style={[styles.reactionText, reaction.mine && styles.myReactionText]}
      >
        {reaction.reactions
          .slice(0, 2)
          .map((entry) => entry.emoji)
          .join("")}{" "}
        {count}
        {reaction.complete ? "" : "+"}
      </Text>
    </Pressable>
  );
}

function createStyles(colors: ReturnType<typeof useColors>) {
  return StyleSheet.create({
    actions: {
      position: "static",
      flexDirection: "row",
      flexWrap: "wrap",
      alignItems: "center",
      gap: 2,
      maxWidth: "100%",
    },
    outgoing: { justifyContent: "flex-end" },
    reaction: {
      minWidth: 44,
      minHeight: 30,
      alignItems: "center",
      justifyContent: "center",
      borderRadius: 18,
      borderWidth: 2,
      borderColor: colors.canvas,
      backgroundColor: colors.incoming,
      paddingHorizontal: 7,
      paddingVertical: 3,
    },
    reactionText: { fontFamily: systemFont, fontSize: 15, color: colors.ink },
    myReaction: { backgroundColor: colors.outgoing },
    myReactionText: { color: colors.selectedInk },
    reply: {
      flexDirection: "row",
      alignItems: "flex-start",
      minHeight: 44,
      minWidth: 44,
      paddingHorizontal: 6,
      paddingTop: 2,
      borderRadius: 12,
    },
    replyText: {
      fontFamily: systemFont,
      color: colors.accent,
      fontSize: 14,
      lineHeight: 18,
    },
    pressed: { backgroundColor: colors.wash },
  });
}

export function RoomMessageDialog({
  action,
  data,
  cacheScope,
  roomId,
  item,
  onClose,
  onProfile,
}: Pick<
  ComponentProps<typeof RoomMessages>,
  "data" | "cacheScope" | "roomId" | "onProfile"
> & {
  readonly item: z.infer<typeof roomMessageSchema>;
  readonly action:
    | "save"
    | "edit"
    | "delete"
    | "forward"
    | "reactors"
    | "pin"
    | "report";
  readonly onClose: () => void;
}) {
  if (action === "report")
    return (
      <ReportRoomMessage
        data={data}
        roomId={roomId}
        item={item}
        onClose={onClose}
      />
    );
  if (action === "pin")
    return (
      <PinRoomMessage
        data={data}
        cacheScope={cacheScope}
        roomId={roomId}
        item={item}
        onClose={onClose}
      />
    );
  if (action === "reactors")
    return (
      <RoomReactors
        data={data}
        cacheScope={cacheScope}
        roomId={roomId}
        messageId={item.id}
        onProfile={onProfile}
        onClose={onClose}
      />
    );
  if (action === "edit" || action === "forward") {
    const Dialog = action === "edit" ? EditRoomMessage : ForwardRoomMessage;
    return (
      <Dialog
        data={data}
        cacheScope={cacheScope}
        roomId={roomId}
        item={item}
        onClose={onClose}
      />
    );
  }
  const Dialog = action === "save" ? SaveRoomMessage : DeleteRoomMessage;
  return (
    <Dialog
      data={data}
      cacheScope={cacheScope}
      roomId={roomId}
      messageId={item.id}
      onClose={onClose}
    />
  );
}
