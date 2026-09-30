import { MessageReaders } from "./readers";
import type { roomReadReceiptSchema } from "./schema";
import { MessageInteraction } from "../conversation/interaction";
import { MessageDelivery } from "../conversation/delivery";
import { AttachmentCard } from "../attachments/card";
import { projectOutgoingRoomMessages, type RoomMessageView } from "./outgoing";
import type { useRoomDraft } from "./draft";
import {
  RoomMessageControls,
  RoomMessageDialog,
  RoomThreadAction,
} from "./message-controls";
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
import Svg, { Path } from "react-native-svg";
import type { z } from "zod";
import { ActionButton } from "../button";
import { systemFont, useColors } from "../theme";
import { ConversationAvatar } from "../chats/avatar";
import { AssistantMarkdown } from "../markdown";
import type { roomReactionSummarySchema, roomMemberSchema } from "./schema";
import type { roomMessageSchema } from "./schema";

const messageIntervalMs = 5 * 60_000;

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
  messageLink,
  onReply,
  onProfile,
  members,
  reactions,
  receipts,
  onReact,
  onVisibleMessagesChange,
  topInset = 0,
  bottomInset = 0,
}: {
  readonly topInset?: number;
  readonly bottomInset?: number;
  readonly data: RoomData;
  readonly roomId: string;
  readonly cacheScope: string;
  readonly onCopy?: (text: string) => Promise<void>;
  readonly messageLink?: (id: string) => string;
  readonly onReply: (message: z.infer<typeof roomMessageSchema>) => void;
  readonly onProfile: (person: z.infer<typeof roomMemberSchema>) => void;
  readonly members: z.infer<typeof roomMemberSchema>[];
  readonly receipts: z.infer<typeof roomReadReceiptSchema>[];
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
  const colors = useColors();
  const styles = useMemo(() => createStyles(colors), [colors]);
  // A reviewed message belongs to the conversation, not a recycled list row.
  const [dialog, setDialog] =
    useState<
      Pick<
        ComponentProps<typeof RoomMessageDialog>,
        "action" | "item" | "roomId" | "cacheScope"
      >
    >();
  if (
    dialog &&
    (error || dialog.roomId !== roomId || dialog.cacheScope !== cacheScope)
  )
    setDialog(undefined);
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
        // Inverting the list swaps the visual top and bottom padding.
        contentContainerStyle={[
          styles.content,
          { paddingTop: bottomInset + 8, paddingBottom: topInset + 12 },
        ]}
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
        renderItem={({ item, index }) => {
          const previous = newestFirst[index + 1];
          const startsDay =
            !!item.timestamp &&
            (!previous?.timestamp ||
              new Date(previous.timestamp).toDateString() !==
                new Date(item.timestamp).toDateString());
          const startsTime =
            !!item.timestamp &&
            (startsDay ||
              Math.abs(
                item.timestamp - (previous?.timestamp ?? item.timestamp)
              ) >= messageIntervalMs);
          return (
            <View
              testID="room-message"
              style={
                !grouped(item, newestFirst[index + 1]) && styles.groupStart
              }
            >
              {startsTime && (
                <Text testID="room-message-timestamp" style={styles.day}>
                  {startsDay &&
                    `${new Date(item.timestamp).toLocaleDateString([], { weekday: "long", day: "numeric", month: "short" })}, `}
                  {new Date(item.timestamp).toLocaleTimeString([], {
                    hour: "2-digit",
                    minute: "2-digit",
                  })}
                </Text>
              )}
              <View
                style={[styles.messageGroup, item.mine && styles.outgoingGroup]}
              >
                <RoomMessage
                  onAction={(action) => {
                    setDialog({ action, item, roomId, cacheScope });
                  }}
                  data={data}
                  roomId={roomId}
                  cacheScope={cacheScope}
                  item={item}
                  first={!grouped(item, newestFirst[index + 1])}
                  last={!grouped(item, newestFirst[index - 1])}
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
                  messageLink={messageLink}
                  onReply={onReply}
                  onProfile={onProfile}
                  members={members}
                  onReact={onReact}
                  receipts={receipts.filter(
                    (receipt) =>
                      receipt.messageId === item.id &&
                      receipt.userId !== item.senderId
                  )}
                  reaction={reactions.find(
                    (reaction) => reaction.messageId === item.id
                  )}
                />
              </View>
            </View>
          );
        }}
      />
      {dialog &&
        !error &&
        dialog.roomId === roomId &&
        dialog.cacheScope === cacheScope && (
          <RoomMessageDialog
            {...dialog}
            data={data}
            onProfile={onProfile}
            onClose={() => {
              setDialog(undefined);
            }}
          />
        )}
      <LatestMessagesButton
        bottomInset={bottomInset}
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
// Chronological neighbours determine the visual group, even in the inverted list.
function grouped(message: RoomMessageView, neighbour?: RoomMessageView) {
  return (
    !!neighbour &&
    message.senderId === neighbour.senderId &&
    message.mine === neighbour.mine &&
    message.bot === neighbour.bot &&
    message.rootId === neighbour.rootId &&
    !message.redacted &&
    !neighbour.redacted &&
    !!message.timestamp &&
    !!neighbour.timestamp &&
    Math.abs(message.timestamp - neighbour.timestamp) < messageIntervalMs &&
    new Date(message.timestamp).toDateString() ===
      new Date(neighbour.timestamp).toDateString()
  );
}

function LatestMessagesButton({
  bottomInset,
  visible,
  newer,
  onPress,
}: {
  readonly bottomInset: number;
  readonly visible: boolean;
  readonly newer: number;
  readonly onPress: () => void;
}) {
  const colors = useColors();
  const styles = useMemo(() => createStyles(colors), [colors]);
  if (!visible) return null;
  const label = newer
    ? `${newer} ${newer === 1 ? "nova mensagem" : "novas mensagens"}`
    : "Mais recentes";
  return (
    <Pressable
      accessibilityRole="button"
      accessibilityLabel={`${label}. Ir para o fim da conversa`}
      onPress={onPress}
      style={[styles.latest, { bottom: bottomInset + 12 }]}
    >
      <ArrowDown size={16} color={colors.accent} />
      <Text style={styles.latestText} accessibilityLiveRegion="polite">
        {label}
      </Text>
    </Pressable>
  );
}

function RoomMessage({
  onAction,
  data,
  roomId,
  cacheScope,
  item,
  first,
  last,
  onThread,
  onUnread,
  avatarUri,
  onCopy,
  messageLink,
  onReply,
  onProfile,
  members,
  reaction,
  receipts,
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
  | "messageLink"
  | "onReply"
  | "onProfile"
  | "members"
  | "onReact"
  | "receipts"
> & {
  readonly onAction: ComponentProps<typeof RoomMessageControls>["onAction"];
  readonly onRemoveSend?: (id: string) => void;
  readonly item: RoomMessageView;
  readonly first: boolean;
  readonly last: boolean;
  readonly reaction?: z.infer<typeof roomReactionSummarySchema>;
}) {
  const colors = useColors();
  const styles = useMemo(() => createStyles(colors), [colors]);
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
    <View
      // oxlint-disable-next-line jsx-a11y/prefer-tag-over-role -- React Native View shares message semantics with native platforms.
      role="group"
      accessibilityLabel={
        item.timestamp
          ? `${person.name}, ${new Date(item.timestamp).toLocaleString()}`
          : person.name
      }
      style={[styles.row, item.mine && styles.outgoing]}
    >
      {((first && !item.mine) ||
        item.bot ||
        !!item.forwarded ||
        !!item.editId) && (
        <View
          style={[styles.attribution, !item.mine && styles.incomingMetadata]}
        >
          {first && !item.mine && (
            <Pressable
              accessibilityRole="button"
              accessibilityLabel={`Ver perfil de ${person.name}`}
              disabled={!!item.outgoing}
              onPress={profile}
            >
              <Text style={styles.sender}>{person.name}</Text>
            </Pressable>
          )}
          {item.bot && <Text style={styles.badge}>IA</Text>}
          {item.forwarded && !item.redacted && (
            <Text style={styles.time}>Encaminhada</Text>
          )}
          {item.editId && !item.redacted && (
            <Text style={styles.time}>Editada</Text>
          )}
        </View>
      )}
      <View style={styles.messageLine}>
        {!item.mine &&
          (last ? (
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
          ) : (
            <View style={styles.avatarSpace} />
          ))}
        <View style={styles.messageContent}>
          <MessageInteraction
            outgoing={item.mine}
            reaction={reaction?.mine}
            onQuickReact={(emoji) => onReact(item.id, emoji)}
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
                  onAction={onAction}
                  messageLink={messageLink}
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
            <View style={styles.bubbleWrap}>
              <View
                style={
                  item.media || item.outgoing?.file
                    ? styles.media
                    : [styles.bubble, item.mine && styles.blue]
                }
              >
                {item.reply && (
                  <View style={styles.quote}>
                    <Text
                      style={[styles.sender, item.mine && styles.outgoingText]}
                    >
                      {item.reply.sender}
                    </Text>
                    <Text
                      numberOfLines={3}
                      style={[styles.caption, item.mine && styles.outgoingText]}
                    >
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
                  <AssistantMarkdown
                    text={item.text}
                    compact
                    outgoing={item.mine}
                  />
                )}
              </View>
              {last && !item.media && !item.outgoing?.file && (
                <Svg
                  width={14}
                  height={18}
                  viewBox="0 0 14 18"
                  accessible={false}
                  aria-hidden
                  style={[
                    styles.tail,
                    item.mine ? styles.rightTail : styles.leftTail,
                  ]}
                >
                  <Path
                    d={
                      item.mine
                        ? "M0 0H8C8 9 8 13 14 18C5 17 0 11 0 6Z"
                        : "M14 0H6C6 9 6 13 0 18C9 17 14 11 14 6Z"
                    }
                    fill={item.mine ? colors.outgoing : colors.incoming}
                  />
                </Svg>
              )}
            </View>
            {!item.redacted && !item.media && <MessageLinks text={item.text} />}
          </MessageInteraction>
        </View>
      </View>
      {!outgoing &&
        ((Boolean(onThread) && item.replies > 0) ||
          (!item.redacted && receipts.length > 0)) && (
          <View
            style={[
              styles.metadata,
              item.mine ? styles.outgoingGroup : styles.incomingMetadata,
            ]}
          >
            <RoomThreadAction item={item} onThread={onThread} />
            {!item.redacted && (
              <MessageReaders
                receipts={receipts}
                members={members}
                onProfile={onProfile}
              />
            )}
          </View>
        )}
    </View>
  );
}

function createStyles(colors: ReturnType<typeof useColors>) {
  return StyleSheet.create({
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
    latestText: {
      fontFamily: systemFont,
      fontSize: 13,
      fontWeight: "600",
      color: colors.accent,
    },
    content: { paddingHorizontal: 16, paddingTop: 8, paddingBottom: 12 },
    groupStart: { paddingTop: 10 },
    avatarSpace: { width: 30 },
    messageLine: {
      flexDirection: "row",
      alignItems: "flex-end",
      gap: 10,
      maxWidth: "100%",
    },
    messageGroup: { alignItems: "flex-start" },
    outgoingGroup: { alignItems: "flex-end" },
    messageContent: { flexShrink: 1, minWidth: 0 },
    metadata: { alignItems: "flex-start", gap: 3 },
    incomingMetadata: { marginLeft: 40 },
    day: {
      fontFamily: systemFont,
      textAlign: "center",
      fontSize: 12,
      color: colors.muted,
      marginBottom: 16,
    },
    row: {
      alignItems: "flex-start",
      gap: 3,
      flexShrink: 1,
      maxWidth: "100%",
      marginBottom: 3,
    },
    outgoing: { alignItems: "flex-end", maxWidth: "85%" },
    attribution: { flexDirection: "row", alignItems: "center", gap: 7 },
    sender: {
      fontFamily: systemFont,
      fontSize: 12,
      color: colors.muted,
      fontWeight: "500",
    },
    badge: {
      fontFamily: systemFont,
      fontSize: 10,
      color: "#1661c9",
      backgroundColor: "#e3efff",
      paddingHorizontal: 5,
      paddingVertical: 2,
      borderRadius: 4,
    },
    time: { fontFamily: systemFont, fontSize: 11, color: colors.muted },
    bubbleWrap: { maxWidth: "100%" },
    media: { maxWidth: "100%", overflow: "hidden", borderRadius: 20 },
    tail: { position: "absolute", bottom: -3, pointerEvents: "none" },
    leftTail: { left: -5 },
    rightTail: { right: -5 },
    bubble: {
      maxWidth: "100%",
      backgroundColor: colors.incoming,
      borderRadius: 21,
      paddingHorizontal: 14,
      paddingVertical: 8,
    },
    blue: { backgroundColor: colors.outgoing },
    outgoingText: { color: colors.selectedInk },
    text: {
      fontFamily: systemFont,
      color: colors.ink,
      fontSize: 15,
      lineHeight: 23,
    },
    empty: {
      fontFamily: systemFont,
      fontSize: 15,
      color: colors.muted,
      textAlign: "center",
      padding: 24,
    },
    caption: { fontFamily: systemFont, color: colors.muted, fontSize: 12 },
    error: { padding: 16, gap: 12 },
  });
}
