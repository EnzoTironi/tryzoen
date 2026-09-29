import { ReportRoomMessage } from "./report-message";
import { PinRoomMessage } from "./pins";
import { RoomReactors } from "./reactors";
import { SaveRoomMessage } from "./save-message";
import type { ComponentProps } from "react";
import { Pressable, StyleSheet, Text, View } from "react-native";
import { MessageCircle } from "lucide-react-native";
import type { z } from "zod";
import { MessageActions } from "../message-actions";
import { colors } from "../theme";
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
  return (
    <>
      <RoomReactionSummary
        reaction={item.redacted ? undefined : reaction}
        onOpen={() => {
          onAction("reactors");
        }}
      />
      <View style={[styles.actions, item.mine && styles.outgoing]}>
        {!item.redacted && (
          <MessageActions
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
        <RoomThreadAction item={item} onThread={onThread} />
      </View>
    </>
  );
}

function RoomThreadAction({
  item,
  onThread,
}: Pick<ComponentProps<typeof RoomMessageControls>, "item" | "onThread">) {
  return (
    <>
      {onThread && item.replies > 0 && (
        <Pressable
          accessibilityRole="button"
          accessibilityLabel={`Abrir thread de ${item.sender}: ${item.text.slice(0, 80)}`}
          onPress={() => {
            onThread(item);
          }}
          style={({ pressed }) => [styles.reply, pressed && styles.pressed]}
        >
          <MessageCircle size={14} color={colors.accent} />
          <Text style={styles.replyText}>
            {item.replies
              ? `${item.replies} ${item.replies === 1 ? "resposta" : "respostas"}`
              : "Thread"}
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
  const otherReactions = reaction?.reactions.filter(
    (entry) => entry.emoji !== reaction.mine
  );
  if (!reaction || !otherReactions?.length) return null;
  return (
    <View style={styles.reactions}>
      {otherReactions.map((entry) => (
        <Pressable
          key={entry.emoji}
          style={styles.reaction}
          accessibilityRole="button"
          accessibilityLabel={`Ver quem reagiu com ${entry.emoji}`}
          onPress={onOpen}
        >
          <Text
            accessibilityLabel={`${entry.emoji}: ${entry.count}${reaction.complete ? "" : " ou mais"} reações`}
            style={styles.reactionText}
          >
            {entry.emoji} {entry.count}
            {reaction.complete ? "" : "+"}
          </Text>
        </Pressable>
      ))}
    </View>
  );
}

const styles = StyleSheet.create({
  actions: {
    position: "static",
    flexDirection: "row",
    flexWrap: "wrap",
    alignItems: "center",
    gap: 2,
    maxWidth: "100%",
  },
  outgoing: { justifyContent: "flex-end" },
  reactions: { flexDirection: "row", flexWrap: "wrap", gap: 4 },
  reaction: {
    borderRadius: 16,
    backgroundColor: colors.wash,
    paddingHorizontal: 9,
    paddingVertical: 5,
  },
  reactionText: { fontSize: 13, color: colors.ink },
  reply: {
    flexDirection: "row",
    alignItems: "center",
    gap: 6,
    minHeight: 44,
    paddingHorizontal: 10,
    borderRadius: 22,
  },
  replyText: { color: colors.accent, fontSize: 12 },
  pressed: { backgroundColor: colors.wash },
});

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
