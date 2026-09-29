import { MessageInteraction } from "../conversation/interaction";
import { MessageDelivery } from "../conversation/delivery";
import { AttachmentCard } from "../attachments/card";
import { projectOutgoingRoomMessages, type RoomMessageView } from "./outgoing";
import type { useRoomDraft } from "./draft";
import { RoomMessageControls } from "./message-controls";
import { captureMessageAnchor } from "../conversation/scroll-anchor";
import { MessageLinks } from "../cards/link";
import { RoomAttachment } from "./attachment";
import type { RoomData } from "./schema";
import {
  useRef,
  useEffect,
  useMemo,
  useState,
  type ComponentProps,
} from "react";
import {
  ActivityIndicator,
  FlatList,
  Pressable,
  StyleSheet,
  Text,
  View,
  type ViewToken,
} from "react-native";
import { ArrowDown } from "lucide-react-native";
import type { z } from "zod";
import { ActionButton } from "../button";
import { colors } from "../theme";
import { ConversationAvatar } from "../chats/avatar";
import { AssistantMarkdown } from "../markdown";
import type { roomReactionSummarySchema, roomMemberSchema } from "./schema";
import type { roomMessageSchema } from "./schema";

const noOutgoing: ReturnType<typeof useRoomDraft>["outgoing"] = [];

export function RoomMessages({
  data,
  roomId,
  cacheScope,
  messages: confirmedMessages,
  outgoing = noOutgoing,
  onRetrySend,
  onSettleSend,
  onThread,
  onUnread,
  loading,
  error,
  onRetry,
  hasMore,
  loadingMore,
  fetching,
  onMore,
  avatarUri,
  onCopy,
  onReply,
  onProfile,
  members,
  reactions,
  onReact,
  onVisibleMessagesChange,
}: {
  readonly data: RoomData;
  readonly roomId: string;
  readonly cacheScope: string;
  readonly onCopy?: (text: string) => Promise<void>;
  readonly onReply: (message: z.infer<typeof roomMessageSchema>) => void;
  readonly onProfile: (person: z.infer<typeof roomMemberSchema>) => void;
  readonly members: z.infer<typeof roomMemberSchema>[];
  readonly reactions: z.infer<typeof roomReactionSummarySchema>[];
  readonly onReact: (id: string, emoji: string | null) => Promise<void>;
  readonly onVisibleMessagesChange: (ids: string[]) => void;
  readonly avatarUri?: string;
  readonly messages: z.infer<typeof roomMessageSchema>[];
  readonly outgoing?: ReturnType<typeof useRoomDraft>["outgoing"];
  readonly onRetrySend?: (id: string) => void;
  readonly onSettleSend?: (ids: string[]) => void;
  readonly onUnread?: () => void;
  readonly onThread?: (message: z.infer<typeof roomMessageSchema>) => void;
  readonly loading: boolean;
  readonly error: boolean;
  readonly onRetry: () => void;
  readonly hasMore: boolean;
  readonly loadingMore: boolean;
  readonly fetching: boolean;
  readonly onMore: () => void;
}) {
  const projected = useMemo(
    () => projectOutgoingRoomMessages(confirmedMessages, outgoing),
    [confirmedMessages, outgoing]
  );
  const messages = projected.messages;
  useEffect(() => {
    if (projected.settled.length) onSettleSend?.(projected.settled);
  }, [projected, onSettleSend]);
  const list = useRef<FlatList<RoomMessageView>>(null);
  const nearBottom = useRef(true);
  const restoreWebAnchor = useRef<(() => void) | undefined>(undefined);
  const [atHistoryEdge, setAtHistoryEdge] = useState<number>();
  // Keep the newest edge stable: older pages append to the inverted list.
  const newestFirst = useMemo(() => {
    // oxlint-disable-next-line unicorn/no-array-reverse -- ES2022 native target; reverse a fresh copy.
    return [...messages].reverse();
  }, [messages]);
  useEffect(() => {
    if (atHistoryEdge === messages.length && hasMore && !fetching && !error)
      onMore();
  }, [atHistoryEdge, messages.length, hasMore, fetching, error, onMore]);
  const [atBottom, setAtBottom] = useState(true);
  const [lastSeen, setLastSeen] = useState(messages.at(-1)?.id);
  const seenIndex = messages.findIndex((message) => message.id === lastSeen);
  const newer = seenIndex < 0 ? 0 : messages.length - seenIndex - 1;
  const visible = useRef(onVisibleMessagesChange);
  useEffect(() => {
    visible.current = onVisibleMessagesChange;
  }, [onVisibleMessagesChange]);
  const [onViewableItemsChanged] = useState(
    () =>
      ({
        viewableItems,
      }: {
        viewableItems: ViewToken<z.infer<typeof roomMessageSchema>>[];
      }) => {
        visible.current(
          viewableItems
            .filter(({ item }) => !item.id.startsWith("local:"))
            .map(({ item }) => item.id)
        );
      }
  );
  return (
    <View style={styles.list}>
      <FlatList
        ref={list}
        data={newestFirst}
        inverted
        onViewableItemsChanged={onViewableItemsChanged}
        keyExtractor={(item) => item.id}
        style={styles.list}
        contentContainerStyle={styles.content}
        ItemSeparatorComponent={MessageSeparator}
        initialNumToRender={20}
        windowSize={5}
        maintainVisibleContentPosition={{ minIndexForVisible: 0 }}
        onScroll={({
          nativeEvent: { layoutMeasurement, contentOffset, contentSize },
        }) => {
          nearBottom.current = contentOffset.y < 100;
          setAtHistoryEdge(
            contentSize.height - layoutMeasurement.height - contentOffset.y <
              layoutMeasurement.height * 0.5
              ? messages.length
              : undefined
          );
          setAtBottom(nearBottom.current);
          restoreWebAnchor.current = nearBottom.current
            ? undefined
            : captureMessageAnchor(
                list.current?.getScrollableNode(),
                "room-message",
                true
              );
          if (nearBottom.current) setLastSeen(messages.at(-1)?.id);
        }}
        scrollEventThrottle={100}
        onEndReached={() => {
          setAtHistoryEdge(messages.length);
        }}
        onEndReachedThreshold={0.5}
        onContentSizeChange={() => {
          if (nearBottom.current && !loadingMore) {
            list.current?.scrollToOffset({ offset: 0, animated: false });
            setLastSeen(messages.at(-1)?.id);
          } else {
            restoreWebAnchor.current?.();
          }
        }}
        ListFooterComponent={
          loadingMore ? (
            <ActivityIndicator accessibilityLabel="Carregando mensagens anteriores" />
          ) : null
        }
        ListEmptyComponent={
          !loading && !error ? (
            <Text style={styles.empty}>A conversa começa aqui.</Text>
          ) : null
        }
        ListHeaderComponent={
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
          <View testID="room-message">
            {!!item.timestamp &&
              new Date(
                newestFirst[index + 1]?.timestamp ?? 0
              ).toDateString() !== new Date(item.timestamp).toDateString() && (
                <Text style={styles.day}>
                  {new Date(item.timestamp).toLocaleDateString([], {
                    weekday: "long",
                    day: "numeric",
                    month: "short",
                  })}
                </Text>
              )}
            <View
              style={[styles.messageLine, item.mine && styles.outgoingLine]}
            >
              <RoomMessage
                data={data}
                roomId={roomId}
                cacheScope={cacheScope}
                item={item}
                onThread={onThread}
                onUnread={onUnread}
                onRetrySend={onRetrySend}
                onRemoveSend={
                  onSettleSend
                    ? (id) => {
                        onSettleSend([id]);
                      }
                    : undefined
                }
                avatarUri={avatarUri}
                onCopy={onCopy}
                onReply={onReply}
                onProfile={onProfile}
                members={members}
                onReact={onReact}
                reaction={reactions.find(
                  (reaction) => reaction.messageId === item.id
                )}
              />
            </View>
          </View>
        )}
      />
      <LatestMessagesButton
        visible={!atBottom && !error && messages.length > 0}
        newer={newer}
        onPress={() => {
          nearBottom.current = true;
          setAtBottom(true);
          setLastSeen(messages.at(-1)?.id);
          list.current?.scrollToOffset({ offset: 0, animated: false });
        }}
      />
    </View>
  );
}
function MessageSeparator() {
  return <View style={styles.separator} />;
}

function LatestMessagesButton({
  visible,
  newer,
  onPress,
}: {
  readonly visible: boolean;
  readonly newer: number;
  readonly onPress: () => void;
}) {
  if (!visible) return null;
  const label = newer
    ? `${newer} ${newer === 1 ? "nova mensagem" : "novas mensagens"}`
    : "Mais recentes";
  return (
    <Pressable
      accessibilityRole="button"
      accessibilityLabel={`${label}. Ir para o fim da conversa`}
      onPress={onPress}
      style={styles.latest}
    >
      <ArrowDown size={16} color={colors.accent} />
      <Text style={styles.latestText} accessibilityLiveRegion="polite">
        {label}
      </Text>
    </Pressable>
  );
}

function RoomMessage({
  data,
  roomId,
  cacheScope,
  item,
  onThread,
  onUnread,
  avatarUri,
  onCopy,
  onReply,
  onProfile,
  members,
  reaction,
  onReact,
  onRetrySend,
  onRemoveSend,
}: Pick<
  ComponentProps<typeof RoomMessages>,
  | "data"
  | "roomId"
  | "cacheScope"
  | "onThread"
  | "onUnread"
  | "onRetrySend"
  | "avatarUri"
  | "onCopy"
  | "onReply"
  | "onProfile"
  | "members"
  | "onReact"
> & {
  readonly onRemoveSend?: (id: string) => void;
  readonly item: RoomMessageView;
  readonly reaction?: z.infer<typeof roomReactionSummarySchema>;
}) {
  const outgoing = item.outgoing;
  const person = members.find((member) => member.id === item.senderId) ?? {
    id: item.senderId,
    name: item.sender,
    bot: item.bot,
    mine: item.mine,
  };
  const profile = () => {
    onProfile(person);
  };
  return (
    <>
      {!item.mine && (
        <Pressable
          accessibilityRole="button"
          accessibilityLabel={`Perfil de ${person.name}`}
          onPress={profile}
        >
          <ConversationAvatar
            name={person.name}
            uri={person.bot ? avatarUri : (person.avatarUri ?? undefined)}
            size={30}
          />
        </Pressable>
      )}
      <View style={[styles.row, item.mine && styles.outgoing]}>
        <View style={styles.attribution}>
          <Pressable
            accessibilityRole="button"
            accessibilityLabel={`Ver perfil de ${person.name}`}
            disabled={!!item.outgoing}
            onPress={profile}
          >
            <Text style={styles.sender}>
              {item.mine ? "Você" : person.name}
            </Text>
          </Pressable>
          {item.bot && <Text style={styles.badge}>IA</Text>}
          {item.forwarded && !item.redacted && (
            <Text style={styles.time}>Encaminhada</Text>
          )}
          {item.editId && !item.redacted && (
            <Text style={styles.time}>Editada</Text>
          )}
          <Text style={styles.time}>
            {item.timestamp
              ? new Date(item.timestamp).toLocaleTimeString([], {
                  hour: "2-digit",
                  minute: "2-digit",
                })
              : ""}
          </Text>
        </View>
        <MessageInteraction
          outgoing={item.mine}
          disabled={!!outgoing || !!item.redacted}
          onReply={() => {
            onReply(item);
          }}
          footer={
            outgoing ? (
              <MessageDelivery
                onRemove={
                  onRemoveSend
                    ? () => {
                        onRemoveSend(outgoing.id);
                      }
                    : undefined
                }
                status={outgoing.status}
                queued={outgoing.queued}
                onRetry={
                  onRetrySend
                    ? () => {
                        onRetrySend(outgoing.id);
                      }
                    : undefined
                }
              />
            ) : (
              <RoomMessageControls
                onProfile={onProfile}
                data={data}
                roomId={roomId}
                cacheScope={cacheScope}
                item={item}
                reaction={reaction}
                onReact={onReact}
                onReply={onReply}
                onCopy={onCopy}
                onThread={onThread}
                onUnread={onUnread}
              />
            )
          }
        >
          <View
            style={
              item.media || item.outgoing?.file
                ? { maxWidth: "100%" }
                : [styles.bubble, item.mine && styles.blue]
            }
          >
            {item.reply && (
              <View style={styles.quote}>
                <Text style={styles.sender}>{item.reply.sender}</Text>
                <Text numberOfLines={3} style={styles.caption}>
                  {item.reply.text}
                </Text>
              </View>
            )}
            {item.outgoing?.file ? (
              <AttachmentCard file={item.outgoing.file} />
            ) : item.media ? (
              <RoomAttachment
                item={item}
                data={data}
                roomId={roomId}
                cacheScope={cacheScope}
              />
            ) : (
              <AssistantMarkdown text={item.text} compact />
            )}
          </View>
          {!item.redacted && !item.media && <MessageLinks text={item.text} />}
        </MessageInteraction>
      </View>
    </>
  );
}

const styles = StyleSheet.create({
  quote: {
    borderLeftWidth: 2,
    borderLeftColor: colors.accent,
    paddingLeft: 10,
    paddingVertical: 4,
    marginBottom: 10,
    gap: 4,
  },
  list: { flex: 1, minHeight: 0 },
  latest: {
    position: "absolute",
    alignSelf: "center",
    bottom: 12,
    flexDirection: "row",
    alignItems: "center",
    gap: 7,
    paddingHorizontal: 16,
    minHeight: 40,
    borderRadius: 22,
    borderWidth: 1,
    borderColor: colors.line,
    backgroundColor: colors.surface,
    boxShadow: "0 3px 14px rgba(0,0,0,0.10)",
  },
  latestText: { fontSize: 13, fontWeight: "600", color: colors.accent },
  content: { paddingHorizontal: 24, paddingVertical: 24 },
  separator: { height: 12 },
  messageLine: { flexDirection: "row", alignItems: "flex-start", gap: 10 },
  outgoingLine: { justifyContent: "flex-end" },
  day: {
    textAlign: "center",
    fontSize: 12,
    color: colors.muted,
    marginBottom: 24,
  },
  row: { alignItems: "flex-start", gap: 4, flexShrink: 1, maxWidth: "92%" },
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
  time: { fontSize: 11, color: colors.muted },
  bubble: {
    maxWidth: "100%",
    backgroundColor: "#f0f0f2",
    borderRadius: 21,
    paddingHorizontal: 16,
    paddingVertical: 10,
  },
  blue: { backgroundColor: "#cfe7ff" },
  text: { color: colors.ink, fontSize: 15, lineHeight: 23 },
  empty: {
    fontSize: 15,
    color: colors.muted,
    textAlign: "center",
    padding: 24,
  },
  caption: { color: colors.muted, fontSize: 12 },
  error: { padding: 16, gap: 12 },
});
