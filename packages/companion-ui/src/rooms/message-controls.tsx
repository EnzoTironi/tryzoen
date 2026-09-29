import { PinRoomMessage } from "./pins";
import { RoomReactors } from "./reactors";
import { SaveRoomMessage } from "./save-message";
import { useState, type ComponentProps } from "react";
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
  data,
  roomId,
  cacheScope,
  item,
  reaction,
  onReact,
  onReply,
  onCopy,
  onThread,
  onUnread,
  onProfile,
}: Pick<
  ComponentProps<typeof RoomMessages>,
  | "data"
  | "roomId"
  | "cacheScope"
  | "onReact"
  | "onReply"
  | "onCopy"
  | "onThread"
  | "onUnread"
  | "onProfile"
> & {
  readonly item: z.infer<typeof roomMessageSchema>;
  readonly reaction?: z.infer<typeof roomReactionSummarySchema>;
}) {
  const [action, setAction] = useState<
    "save" | "edit" | "delete" | "forward" | "reactors" | "pin"
  >();
  return (
    <>
      <RoomReactionSummary
        reaction={item.redacted ? undefined : reaction}
        onOpen={() => {
          setAction("reactors");
        }}
      />
      <View style={[styles.actions, item.mine && styles.outgoing]}>
        {!item.redacted && (
          <MessageActions
            onUnread={onUnread}
            onPin={() => {
              setAction("pin");
            }}
            onViewReactions={
              reaction?.reactions.length
                ? () => {
                    setAction("reactors");
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
              setAction("forward");
            }}
            onSave={() => {
              setAction("save");
            }}
            onEdit={
              item.mine && !item.media
                ? () => {
                    setAction("edit");
                  }
                : undefined
            }
            onDelete={
              item.mine
                ? () => {
                    setAction("delete");
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
      {action && (
        <RoomMessageDialog
          action={action}
          data={data}
          cacheScope={cacheScope}
          roomId={roomId}
          item={item}
          onProfile={onProfile}
          onClose={() => {
            setAction(undefined);
          }}
        />
      )}
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

function RoomMessageDialog({
  action,
  data,
  cacheScope,
  roomId,
  item,
  onClose,
  onProfile,
}: Pick<
  ComponentProps<typeof RoomMessageControls>,
  "data" | "cacheScope" | "roomId" | "item" | "onProfile"
> & {
  readonly action: "save" | "edit" | "delete" | "forward" | "reactors" | "pin";
  readonly onClose: () => void;
}) {
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
