import { useState, type ComponentProps } from "react";
import { Pressable, StyleSheet, Text, View } from "react-native";
import { MessageCircle } from "lucide-react-native";
import type { z } from "zod";
import { MessageActions } from "../message-actions";
import { colors } from "../theme";
import { EditRoomMessage } from "./edit-message";
import { DeleteRoomMessage } from "./delete-message";
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
  const [editing, setEditing] = useState(false);
  const [deleting, setDeleting] = useState(false);
  return (
    <>
      <RoomReactionSummary reaction={item.redacted ? undefined : reaction} />
      {!item.redacted && (
        <MessageActions
          onEdit={
            item.mine && !item.media
              ? () => {
                  setEditing(true);
                }
              : undefined
          }
          onDelete={
            item.mine
              ? () => {
                  setDeleting(true);
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
      {editing && (
        <EditRoomMessage
          data={data}
          roomId={roomId}
          cacheScope={cacheScope}
          item={item}
          onClose={() => {
            setEditing(false);
          }}
        />
      )}
      {deleting && (
        <DeleteRoomMessage
          data={data}
          roomId={roomId}
          cacheScope={cacheScope}
          messageId={item.id}
          onClose={() => {
            setDeleting(false);
          }}
        />
      )}
      <RoomThreadAction item={item} onThread={onThread} />
    </>
  );
}

function RoomThreadAction({
  item,
  onThread,
}: Pick<ComponentProps<typeof RoomMessageControls>, "item" | "onThread">) {
  return (
    <>
      {" "}
      {onThread && (
        <Pressable
          accessibilityRole="button"
          accessibilityLabel={`Abrir thread de ${item.sender}: ${item.text.slice(0, 80)}`}
          onPress={() => {
            onThread(item);
          }}
          style={styles.reply}
        >
          <MessageCircle size={14} color={colors.accent} />
          <Text style={styles.replyText}>
            {item.replies
              ? `${item.replies} ${item.replies === 1 ? "resposta" : "respostas"}`
              : "Responder em thread"}
          </Text>
        </Pressable>
      )}
    </>
  );
}

function RoomReactionSummary({
  reaction,
}: Pick<ComponentProps<typeof RoomMessageControls>, "reaction">) {
  if (!reaction?.reactions.length) return null;
  return (
    <View style={styles.reactions}>
      {reaction.reactions
        .filter((entry) => entry.emoji !== reaction.mine)
        .map((entry) => (
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
    paddingVertical: 7,
  },
  replyText: { color: colors.accent, fontSize: 12 },
});
