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
}: Pick<
  ComponentProps<typeof RoomMessages>,
  | "data"
  | "roomId"
  | "cacheScope"
  | "onReact"
  | "onReply"
  | "onCopy"
  | "onThread"
> & {
  readonly item: z.infer<typeof roomMessageSchema>;
  readonly reaction?: z.infer<typeof roomReactionSummarySchema>;
}) {
  const [action, setAction] = useState<
    "save" | "edit" | "delete" | "forward"
  >();
  return (
    <>
      <RoomReactionSummary reaction={item.redacted ? undefined : reaction} />
      <View style={[styles.actions, item.mine && styles.outgoing]}>
        {!item.redacted && (
          <MessageActions
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
      {onThread && (
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
}: Pick<ComponentProps<typeof RoomMessageControls>, "reaction">) {
  const otherReactions = reaction?.reactions.filter(
    (entry) => entry.emoji !== reaction.mine
  );
  if (!reaction || !otherReactions?.length) return null;
  return (
    <View style={styles.reactions}>
      {otherReactions.map((entry) => (
        <View key={entry.emoji} style={styles.reaction}>
          <Text
            accessibilityLabel={`${entry.emoji}: ${entry.count}${reaction.complete ? "" : " ou mais"} reações`}
            style={styles.reactionText}
          >
            {entry.emoji} {entry.count}
            {reaction.complete ? "" : "+"}
          </Text>
        </View>
      ))}
    </View>
  );
}

const styles = StyleSheet.create({
  actions: {
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
}: Pick<
  ComponentProps<typeof RoomMessageControls>,
  "data" | "cacheScope" | "roomId" | "item"
> & {
  readonly action: "save" | "edit" | "delete" | "forward";
  readonly onClose: () => void;
}) {
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
