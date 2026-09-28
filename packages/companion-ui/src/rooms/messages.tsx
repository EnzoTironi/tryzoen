import { useRef, type ComponentProps } from "react";
import {
  ActivityIndicator,
  FlatList,
  Pressable,
  StyleSheet,
  Text,
  View,
} from "react-native";
import { MessageCircle } from "lucide-react-native";
import type { z } from "zod";
import { ActionButton } from "../button";
import { colors } from "../theme";
import { ConversationAvatar } from "../chats/avatar";
import { reactionTextFor } from "../session/reaction";
import type { roomMessageSchema } from "./schema";

export function RoomMessages({
  messages,
  onThread,
  loading,
  error,
  onRetry,
  hasMore,
  loadingMore,
  onMore,
  avatarUri,
}: {
  readonly avatarUri?: string;
  readonly messages: z.infer<typeof roomMessageSchema>[];
  readonly onThread?: (message: z.infer<typeof roomMessageSchema>) => void;
  readonly loading: boolean;
  readonly error: boolean;
  readonly onRetry: () => void;
  readonly hasMore: boolean;
  readonly loadingMore: boolean;
  readonly onMore: () => void;
}) {
  const list = useRef<FlatList<z.infer<typeof roomMessageSchema>>>(null);
  const nearBottom = useRef(true);
  return (
    <FlatList
      ref={list}
      data={messages}
      keyExtractor={(item) => item.id}
      style={styles.list}
      contentContainerStyle={styles.content}
      initialNumToRender={20}
      windowSize={5}
      onScroll={({
        nativeEvent: { layoutMeasurement, contentOffset, contentSize },
      }) => {
        nearBottom.current =
          layoutMeasurement.height + contentOffset.y >=
          contentSize.height - 100;
      }}
      scrollEventThrottle={100}
      onContentSizeChange={() => {
        if (nearBottom.current && !loadingMore)
          list.current?.scrollToEnd({ animated: false });
      }}
      ListHeaderComponent={
        hasMore ? (
          <ActionButton quiet disabled={loadingMore} onPress={onMore}>
            Mensagens anteriores
          </ActionButton>
        ) : null
      }
      ListEmptyComponent={
        !loading && !error ? (
          <Text style={styles.empty}>A conversa começa aqui.</Text>
        ) : null
      }
      ListFooterComponent={
        <>
          {loading && (
            <ActivityIndicator accessibilityLabel="Carregando mensagens" />
          )}
          {error && (
            <View style={styles.error}>
              <Text accessibilityRole="alert" style={styles.caption}>
                Não foi possível atualizar a conversa.
              </Text>
              <ActionButton quiet onPress={onRetry}>
                Tentar novamente
              </ActionButton>
            </View>
          )}
        </>
      }
      renderItem={({ item, index }) => (
        <>
          {!!item.timestamp &&
            new Date(messages[index - 1]?.timestamp ?? 0).toDateString() !==
              new Date(item.timestamp).toDateString() && (
              <Text style={styles.day}>
                {new Date(item.timestamp).toLocaleDateString([], {
                  weekday: "long",
                  day: "numeric",
                  month: "short",
                })}
              </Text>
            )}
          <View style={[styles.messageLine, item.mine && styles.outgoingLine]}>
            {!item.mine && (
              <ConversationAvatar
                name={item.sender}
                uri={item.bot ? avatarUri : undefined}
                size={30}
              />
            )}
            <RoomMessage item={item} onThread={onThread} />
          </View>
        </>
      )}
    />
  );
}
function RoomMessage({
  item,
  onThread,
}: {
  readonly item: z.infer<typeof roomMessageSchema>;
  readonly onThread: ComponentProps<typeof RoomMessages>["onThread"];
}) {
  return (
    <View style={[styles.row, item.mine && styles.outgoing]}>
      <View style={styles.attribution}>
        <Text style={styles.sender}>{item.mine ? "Você" : item.sender}</Text>
        {item.bot && <Text style={styles.badge}>IA</Text>}
        <Text style={styles.time}>
          {item.timestamp
            ? new Date(item.timestamp).toLocaleTimeString([], {
                hour: "2-digit",
                minute: "2-digit",
              })
            : ""}
        </Text>
      </View>
      <View style={[styles.bubble, item.mine && styles.blue]}>
        <Text selectable style={styles.text}>
          {item.text}
        </Text>
      </View>
      {item.reactions.length > 0 && (
        <Text accessibilityLabel="Reações" style={styles.caption}>
          {item.reactions
            .map(
              (reaction) =>
                `${reactionTextFor(reaction.type)} ${reaction.count}`
            )
            .join(" · ")}
        </Text>
      )}
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
    </View>
  );
}

const styles = StyleSheet.create({
  list: { flex: 1, minHeight: 0 },
  content: { paddingHorizontal: 24, paddingVertical: 24, gap: 20 },
  messageLine: { flexDirection: "row", alignItems: "flex-start", gap: 10 },
  outgoingLine: { justifyContent: "flex-end" },
  day: {
    textAlign: "center",
    fontSize: 12,
    color: colors.muted,
    marginBottom: 24,
  },
  row: { alignItems: "flex-start", gap: 6, flexShrink: 1, maxWidth: "92%" },
  outgoing: { alignItems: "flex-end" },
  attribution: { flexDirection: "row", alignItems: "center", gap: 7 },
  sender: { fontSize: 12, color: colors.muted, fontWeight: "500" },
  badge: {
    fontSize: 10,
    color: "#1661c9",
    backgroundColor: "#e3efff",
    paddingHorizontal: 5,
    paddingVertical: 2,
    borderRadius: 4,
  },
  time: { fontSize: 10, color: colors.muted },
  bubble: {
    maxWidth: "100%",
    backgroundColor: "#f0f0f2",
    borderRadius: 19,
    paddingHorizontal: 16,
    paddingVertical: 11,
  },
  blue: { backgroundColor: "#cfe7ff" },
  text: { color: colors.ink, fontSize: 15, lineHeight: 23 },
  reply: {
    flexDirection: "row",
    alignItems: "center",
    gap: 6,
    paddingVertical: 7,
  },
  replyText: { color: colors.accent, fontSize: 12 },
  empty: {
    fontSize: 15,
    color: colors.muted,
    textAlign: "center",
    padding: 24,
  },
  caption: { color: colors.muted, fontSize: 12 },
  error: { padding: 16, gap: 12 },
});
