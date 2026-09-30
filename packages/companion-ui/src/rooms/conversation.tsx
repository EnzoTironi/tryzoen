import { useMarkRoomUnread } from "./unread";
import { ThreadSubscription } from "./thread-subscription";
import { roomMessageUrl } from "./links";
import { RoomMessageContext } from "./context";
import { RoomPins } from "./pins";
import { RoomSearch } from "./search";
import { ConnectionStatus } from "../conversation/connection";
import { PresenceIndicator } from "./presence";
import { useRoomLifecycle } from "./lifecycle";
import { useRoomSync } from "./sync";
import { RoomTypingIndicator } from "./typing-indicator";
import { useMemo, useContext, useState, type ComponentProps } from "react";
import { CompanionVisibility } from "../visibility";
import { useInfiniteQuery } from "@tanstack/react-query";
import {
  Platform,
  Pressable,
  StyleSheet,
  Text,
  useWindowDimensions,
  View,
} from "react-native";
import {
  ArrowLeft,
  Info,
  Search,
  Pin,
  X,
  Ellipsis,
  ChevronRight,
} from "lucide-react-native";
import type { z } from "zod";
import { RoomComposer } from "./composer";
import { useRoomDraft } from "./draft";
import { ActionButton } from "../button";
import { IconButton } from "../icon-button";
import { CompanionSheet } from "../sheet";
import { ConversationAvatar } from "../chats/avatar";
import { systemFont, useColors } from "../theme";
import { RoomMessages } from "./messages";
import { RoomDetails } from "./details";
import { ParticipantProfile } from "./profile";
import { useRoomReactions } from "./reactions";
import { useRoomReadPosition } from "./read-position";
import type {
  RoomData,
  roomMessageSchema,
  roomMemberSchema,
  roomSchema,
} from "./schema";

export function RoomConversation({
  data,
  cacheScope,
  roomId,
  onBack,
  avatarUri,
  onCopyText,
  onOpenRoom,
  linkOrigin,
  selectedMessage,
  onCloseMessage,
}: {
  readonly linkOrigin?: string;
  readonly selectedMessage?: string;
  readonly onCloseMessage?: () => void;
  readonly data: RoomData;
  readonly cacheScope: string;
  readonly roomId: string;
  readonly onBack: () => void;
  readonly onOpenRoom?: (id: string) => void;
  readonly avatarUri?: string;
  readonly onCopyText?: (text: string) => Promise<void>;
}) {
  const colors = useColors();
  const width = useWindowDimensions().width;
  const compact = width < 720;
  const styles = useMemo(
    () => createStyles(colors, compact),
    [colors, compact]
  );
  const [headerHeight, setHeaderHeight] = useState(compact ? 104 : 80);
  const [threadHeaderHeight, setThreadHeaderHeight] = useState(
    compact ? 104 : 80
  );
  const [composerHeight, setComposerHeight] = useState(compact ? 62 : 50);
  const unread = useMarkRoomUnread(data, cacheScope, roomId, onBack);
  const [root, setRoot] = useState<z.infer<typeof roomMessageSchema>>();
  const [details, setDetails] = useState(false);
  const [searching, setSearching] = useState(false);
  const [pins, setPins] = useState(false);
  const [options, setOptions] = useState(false);
  const draft = useRoomDraft(data, cacheScope, roomId);
  const [profile, setProfile] = useState<z.infer<typeof roomMemberSchema>>();
  const exposed = useContext(CompanionVisibility);
  const visible =
    exposed &&
    !details &&
    !profile &&
    !searching &&
    !pins &&
    !options &&
    !selectedMessage;
  const active = useRoomLifecycle(cacheScope, roomId, exposed);
  const wide = width >= 1100;
  const timelineVisible = visible && (!root || wide);
  const reactions = useRoomReactions(
    data,
    cacheScope,
    roomId,
    active && timelineVisible
  );
  const messages = useInfiniteQuery({
    queryKey: ["matrix-messages", cacheScope, roomId],
    initialPageParam: undefined as string | undefined,
    queryFn: ({ pageParam, signal }) =>
      data.messages({ id: roomId, from: pageParam }, signal),
    getNextPageParam: (last, _pages, _cursor, cursors) =>
      last.nextCursor && !cursors.includes(last.nextCursor)
        ? last.nextCursor
        : undefined,
    staleTime: Infinity,
    enabled: active && exposed,
    refetchOnWindowFocus: false,
    refetchOnReconnect: false,
    retry: 1,
  });
  const current = messages.isError ? undefined : messages.data;
  const room = current?.pages[0]?.room;
  const messageLink =
    room && linkOrigin
      ? (messageId: string) =>
          roomMessageUrl(linkOrigin, {
            id: room.id,
            workspaceId: room.workspaceId,
            messageId,
          })
      : undefined;
  const typing = useRoomSync(
    data,
    cacheScope,
    roomId,
    // Keep the authorized, backed-off sync alive so a failed history read can recover.
    exposed && (!!room || messages.isError)
  );
  const showProfile = () => {
    if (room?.kind === "direct")
      setProfile(current?.pages[0]?.members.find((person) => !person.mine));
    else setDetails(true);
  };
  const timeline = Array.from(
    new Map(
      current?.pages
        .reduceRight<z.infer<typeof roomMessageSchema>[]>(
          (items, page) => items.concat(page.messages),
          []
        )
        .map((message) => [message.id, message])
    ).values()
  );
  const showReadMessages = useRoomReadPosition(
    data,
    cacheScope,
    roomId,
    timeline,
    !messages.isError && timelineVisible && !unread.isPending
  );
  if (typing.accessDenied)
    return (
      <View style={styles.unavailable}>
        <Text accessibilityRole="header" style={styles.title}>
          Conversa indisponível
        </Text>
        <Text accessibilityRole="alert" style={styles.caption}>
          Você não tem mais acesso a esta conversa. Um administrador pode
          adicionar você novamente.
        </Text>
        <ActionButton onPress={onBack}>Voltar às conversas</ActionButton>
      </View>
    );
  return (
    <View style={styles.layout}>
      <ConnectionStatus top={headerHeight} reconnecting={typing.reconnecting} />
      <View
        style={[
          styles.main,
          root && !wide && !messages.isError && styles.hidden,
        ]}
      >
        <RoomHeader
          onLayout={({ nativeEvent }) => {
            setHeaderHeight(nativeEvent.layout.height);
          }}
          onOptions={() => {
            setOptions(true);
          }}
          room={room}
          presence={
            room?.kind === "direct" ? typing.presence[0]?.state : undefined
          }
          compact={compact}
          onBack={onBack}
          onProfile={showProfile}
          onSearch={() => {
            setSearching(true);
          }}
        />
        {unread.isError && (
          <Text accessibilityRole="alert" style={styles.caption}>
            Não foi possível marcar como não lida. Tente novamente.
          </Text>
        )}
        <RoomMessages
          topInset={headerHeight}
          bottomInset={composerHeight}
          receipts={typing.receipts.filter(
            (receipt) =>
              receipt.threadId === null || receipt.threadId === "main"
          )}
          onUnread={
            unread.isPending
              ? undefined
              : () => {
                  unread.mutate();
                }
          }
          data={data}
          roomId={roomId}
          cacheScope={cacheScope}
          avatarUri={avatarUri}
          onCopy={onCopyText}
          messageLink={messageLink}
          outgoing={draft.outgoing}
          onRetrySend={draft.retry}
          onSettleSend={draft.settle}
          onReply={draft.replyTo}
          onProfile={setProfile}
          members={current?.pages[0]?.members ?? []}
          reactions={
            reactions.result.isError ? [] : (reactions.result.data ?? [])
          }
          onReact={reactions.setReaction}
          onVisibleMessagesChange={(ids) => {
            reactions.showMessages(ids);
            showReadMessages(ids);
          }}
          messages={timeline.filter((message) => !message.rootId)}
          onThread={setRoot}
          loading={messages.isPending}
          error={Boolean(messages.error)}
          onRetry={() => {
            void messages.refetch();
          }}
          hasMore={messages.hasNextPage}
          loadingMore={messages.isFetchingNextPage}
          fetching={messages.isFetching}
          onMore={() => {
            if (
              timelineVisible &&
              messages.hasNextPage &&
              !messages.isFetching &&
              !messages.isError
            )
              void messages.fetchNextPage({ cancelRefetch: false });
          }}
        />
        <View
          testID="conversation-composer"
          pointerEvents="box-none"
          style={styles.composer}
          onLayout={({ nativeEvent }) => {
            setComposerHeight(nativeEvent.layout.height);
          }}
        >
          <RoomTypingIndicator
            userIds={typing.userIds}
            members={current?.pages[0]?.members ?? []}
          />
          <RoomComposer
            onTyping={typing.change}
            draft={draft}
            disabled={!room || messages.isError}
            paused={!active}
            visible={timelineVisible}
            direct={room?.kind === "direct"}
          />
        </View>
      </View>
      {root && !messages.isError && (
        <View style={[styles.thread, !wide && styles.fullThread]}>
          <View
            testID="thread-header"
            pointerEvents="box-none"
            style={styles.header}
            onLayout={({ nativeEvent }) => {
              setThreadHeaderHeight(nativeEvent.layout.height);
            }}
          >
            <View style={styles.headerSide} />
            <Pressable
              accessibilityRole="button"
              accessibilityLabel={`Voltar à conversa ${room?.label ?? "Thread"}`}
              accessibilityHint={`Thread de ${root.sender}`}
              onPress={() => {
                setRoot(undefined);
              }}
              style={styles.identity}
            >
              <ConversationAvatar
                name={room?.label ?? "Thread"}
                uri={room?.avatarUri ?? undefined}
                group={room?.kind === "group"}
                size={compact ? 56 : 40}
              />
              <View style={styles.nameCapsule}>
                <Text numberOfLines={1} style={styles.title}>
                  {room?.label ?? "Thread"}
                </Text>
                <ChevronRight size={12} color={colors.muted} />
              </View>
            </Pressable>
            <View style={styles.headerSide}>
              <View style={styles.headerControl}>
                <IconButton
                  icon={X}
                  label="Fechar thread"
                  onPress={() => {
                    setRoot(undefined);
                  }}
                />
              </View>
            </View>
          </View>
          <RoomThread
            key={root.id}
            headerInset={threadHeaderHeight}
            data={data}
            cacheScope={cacheScope}
            roomId={roomId}
            root={root}
            onUnread={
              unread.isPending
                ? undefined
                : () => {
                    unread.mutate();
                  }
            }
            avatarUri={avatarUri}
            onCopyText={onCopyText}
            messageLink={messageLink}
            onProfile={setProfile}
            visible={visible}
            active={active}
            typing={typing}
          />
        </View>
      )}
      {options && (
        <CompanionSheet
          title="Conversa"
          onClose={() => {
            setOptions(false);
          }}
        >
          <View style={styles.options}>
            {[
              {
                icon: Search,
                label: "Buscar na conversa",
                run: () => {
                  setSearching(true);
                },
              },
              {
                icon: Pin,
                label: "Mensagens fixadas",
                run: () => {
                  setPins(true);
                },
              },
              {
                icon: Info,
                label:
                  room?.kind === "direct"
                    ? "Perfil da pessoa"
                    : "Detalhes do grupo",
                run: showProfile,
              },
            ].map(({ icon: Icon, label, run }) => (
              <Pressable
                key={label}
                accessibilityRole="button"
                accessibilityLabel={label}
                onPress={() => {
                  setOptions(false);
                  run();
                }}
                style={({ pressed }) => [
                  styles.option,
                  pressed && styles.pressed,
                ]}
              >
                <Icon size={21} color={colors.ink} />
                <Text style={styles.optionText}>{label}</Text>
              </Pressable>
            ))}
          </View>
        </CompanionSheet>
      )}
      {details && room?.kind === "group" && current?.pages[0] && (
        <RoomDetails
          presence={typing.presence}
          onLeft={onBack}
          onChanged={() => messages.refetch()}
          data={data}
          cacheScope={cacheScope}
          page={current.pages[0]}
          onProfile={(person) => {
            setDetails(false);
            setProfile(person);
          }}
          avatarUri={avatarUri}
          onClose={() => {
            setDetails(false);
          }}
          onConversation={() => {
            setDetails(false);
            setRoot(undefined);
          }}
        />
      )}
      {selectedMessage && onCloseMessage && (
        <RoomMessageContext
          key={selectedMessage}
          data={data}
          cacheScope={cacheScope}
          reference={{ id: roomId, messageId: selectedMessage }}
          onClose={onCloseMessage}
          onOpenRoom={(id) => {
            onCloseMessage();
            onOpenRoom?.(id);
          }}
        />
      )}
      {pins && room && (
        <RoomPins
          data={data}
          cacheScope={cacheScope}
          roomId={roomId}
          onClose={() => {
            setPins(false);
          }}
          onOpenRoom={(id) => {
            setPins(false);
            onOpenRoom?.(id);
          }}
        />
      )}
      {searching && room && (
        <RoomSearch
          key={`${cacheScope}:${roomId}`}
          data={data}
          cacheScope={cacheScope}
          roomId={roomId}
          members={current.pages[0]?.members ?? []}
          onClose={() => {
            setSearching(false);
          }}
          onOpenRoom={
            onOpenRoom ??
            (() => {
              setSearching(false);
            })
          }
        />
      )}
      {profile && room && (
        <ParticipantProfile
          person={profile}
          presence={
            typing.presence.find((person) => person.id === profile.id)?.state
          }
          data={data}
          cacheScope={cacheScope}
          onOpenRoom={onOpenRoom}
          direct={room.kind === "direct"}
          roomId={room.id}
          conversationAvatarUri={room.avatarUri ?? undefined}
          groupName={room.label}
          avatarUri={avatarUri}
          onClose={() => {
            setProfile(undefined);
          }}
          onConversation={() => {
            setProfile(undefined);
            setRoot(undefined);
          }}
        />
      )}
    </View>
  );
}

function RoomHeader({
  onLayout,
  room,
  presence,
  compact,
  onBack,
  onProfile,
  onSearch,
  onOptions,
}: {
  readonly onLayout: ComponentProps<typeof View>["onLayout"];
  readonly room?: z.infer<typeof roomSchema>;
  readonly presence?: Parameters<typeof PresenceIndicator>[0]["state"];
  readonly compact: boolean;
  readonly onBack: () => void;
  readonly onProfile: () => void;
  readonly onSearch: () => void;
  readonly onOptions: () => void;
}) {
  const colors = useColors();
  const styles = useMemo(
    () => createStyles(colors, compact),
    [colors, compact]
  );
  return (
    <View
      testID="conversation-header"
      pointerEvents="box-none"
      onLayout={onLayout}
      style={styles.header}
    >
      <View style={styles.headerSide}>
        <View style={styles.headerControl}>
          <IconButton
            icon={compact ? ArrowLeft : Search}
            label={compact ? "Voltar às conversas" : "Buscar na conversa"}
            onPress={compact ? onBack : onSearch}
          />
        </View>
      </View>
      <View pointerEvents="box-none" style={styles.identity}>
        <Pressable
          accessibilityRole="button"
          accessibilityLabel="Ver perfil da conversa"
          onPress={onProfile}
        >
          <ConversationAvatar
            name={room?.label ?? "Conversa"}
            uri={room?.avatarUri ?? undefined}
            group={room?.kind === "group"}
            size={compact ? 56 : 40}
          />
        </Pressable>
        <Pressable
          accessibilityRole="button"
          accessibilityLabel={`Detalhes de ${room?.label ?? "conversa"}`}
          accessibilityHint={
            room?.kind === "direct" && room.username
              ? `@${room.username} · conversa direta`
              : undefined
          }
          onPress={onProfile}
          hitSlop={{ top: 9, bottom: 9, left: 4, right: 4 }}
          style={styles.nameCapsule}
        >
          <Text
            accessibilityRole="header"
            numberOfLines={1}
            style={styles.title}
          >
            {room?.label ?? "Conversa"}
          </Text>
          <ChevronRight size={12} color={colors.muted} />
        </Pressable>
        {presence && presence !== "offline" && (
          <PresenceIndicator state={presence} />
        )}
      </View>
      <View style={styles.headerSide}>
        <View style={styles.headerControl}>
          <IconButton
            icon={Ellipsis}
            label="Opções da conversa"
            onPress={onOptions}
          />
        </View>
      </View>
    </View>
  );
}

function RoomThread({
  headerInset,
  data,
  cacheScope,
  roomId,
  root,
  avatarUri,
  onCopyText,
  messageLink,
  onProfile,
  visible,
  active,
  typing,
  onUnread,
}: Pick<
  Parameters<typeof RoomConversation>[0],
  "data" | "cacheScope" | "roomId" | "avatarUri" | "onCopyText"
> & {
  readonly headerInset: number;
  readonly onUnread?: () => void;
  readonly messageLink?: (id: string) => string;
  readonly root: z.infer<typeof roomMessageSchema>;
  readonly onProfile: (person: z.infer<typeof roomMemberSchema>) => void;
  readonly visible: boolean;
  readonly active: boolean;
  readonly typing: ReturnType<typeof useRoomSync>;
}) {
  const colors = useColors();
  const compact = useWindowDimensions().width < 720;
  const styles = useMemo(
    () => createStyles(colors, compact),
    [colors, compact]
  );
  const [composerHeight, setComposerHeight] = useState(compact ? 62 : 50);
  const [subscriptionHeight, setSubscriptionHeight] = useState(44);
  const draft = useRoomDraft(data, cacheScope, roomId, root.id);
  const reactions = useRoomReactions(
    data,
    cacheScope,
    roomId,
    active && visible
  );
  const result = useInfiniteQuery({
    queryKey: ["matrix-thread", cacheScope, roomId, root.id],
    initialPageParam: undefined as string | undefined,
    queryFn: ({ pageParam, signal }) =>
      data.thread({ id: roomId, rootId: root.id, from: pageParam }, signal),
    getNextPageParam: (last, _pages, _cursor, cursors) =>
      last.nextCursor && !cursors.includes(last.nextCursor)
        ? last.nextCursor
        : undefined,
    staleTime: Infinity,
    enabled: active && visible,
    refetchOnWindowFocus: false,
    refetchOnReconnect: false,
    retry: 1,
  });
  const replies = Array.from(
    new Map(
      result.data?.pages
        .reduceRight<z.infer<typeof roomMessageSchema>[]>(
          (items, page) => items.concat(page.messages),
          []
        )
        .map((message) => [message.id, message])
    ).values()
  );
  const showReadMessages = useRoomReadPosition(
    data,
    cacheScope,
    roomId,
    replies,
    visible && !result.isError,
    root.id
  );
  return (
    <View style={styles.main}>
      <View
        testID="thread-subscription"
        style={[styles.subscription, { top: headerInset }]}
        onLayout={({ nativeEvent }) => {
          setSubscriptionHeight(nativeEvent.layout.height);
        }}
      >
        <ThreadSubscription
          data={data}
          cacheScope={cacheScope}
          roomId={roomId}
          rootId={root.id}
          active={active && visible && !result.isError}
        />
      </View>
      <RoomMessages
        topInset={headerInset + subscriptionHeight + 8}
        bottomInset={composerHeight}
        receipts={typing.receipts.filter(
          (receipt) => receipt.threadId === null || receipt.threadId === root.id
        )}
        onUnread={onUnread}
        data={data}
        roomId={roomId}
        cacheScope={cacheScope}
        avatarUri={avatarUri}
        onCopy={onCopyText}
        messageLink={messageLink}
        outgoing={draft.outgoing}
        onRetrySend={draft.retry}
        onSettleSend={draft.settle}
        onReply={draft.replyTo}
        onProfile={onProfile}
        members={result.isError ? [] : (result.data?.pages[0]?.members ?? [])}
        reactions={
          reactions.result.isError ? [] : (reactions.result.data ?? [])
        }
        onReact={reactions.setReaction}
        onVisibleMessagesChange={(ids) => {
          reactions.showMessages(ids);
          showReadMessages(ids);
        }}
        messages={
          result.isError
            ? []
            : [result.data?.pages[0]?.parent ?? root, ...replies]
        }
        loading={result.isPending}
        error={Boolean(result.error)}
        onRetry={() => {
          void result.refetch();
        }}
        hasMore={result.hasNextPage}
        loadingMore={result.isFetchingNextPage}
        fetching={result.isFetching}
        onMore={() => {
          if (result.hasNextPage && !result.isFetching && !result.isError)
            void result.fetchNextPage({ cancelRefetch: false });
        }}
      />
      <View
        testID="thread-composer"
        pointerEvents="box-none"
        style={styles.composer}
        onLayout={({ nativeEvent }) => {
          setComposerHeight(nativeEvent.layout.height);
        }}
      >
        <RoomTypingIndicator
          userIds={typing.userIds}
          members={result.isError ? [] : (result.data?.pages[0]?.members ?? [])}
        />
        <RoomComposer
          onTyping={typing.change}
          draft={draft}
          thread
          disabled={!result.data || result.isError}
          paused={!active}
          visible={visible}
        />
      </View>
    </View>
  );
}

function createStyles(colors: ReturnType<typeof useColors>, compact: boolean) {
  return StyleSheet.create({
    unavailable: {
      flex: 1,
      padding: 32,
      gap: 16,
      alignItems: "center",
      justifyContent: "center",
    },
    layout: {
      flex: 1,
      flexDirection: "row",
      minWidth: 0,
      backgroundColor: colors.canvas,
    },
    main: { flex: 1, minWidth: 0, minHeight: 0 },
    composer: {
      position: "absolute",
      bottom: 0,
      left: 0,
      right: 0,
      zIndex: 20,
    },
    subscription: {
      position: "absolute",
      right: 8,
      zIndex: 20,
      maxWidth: "100%",
      borderRadius: 22,
      backgroundColor: `${colors.surface}b8`,
      ...(Platform.OS === "web"
        ? { backdropFilter: "blur(20px) saturate(180%)" }
        : {}),
    },
    hidden: { display: "none" },
    header: {
      position: "absolute",
      top: 0,
      left: 0,
      right: 0,
      zIndex: 30,
      minHeight: compact ? 104 : 80,
      flexDirection: "row",
      alignItems: "center",
      justifyContent: "space-between",
      paddingHorizontal: 12,
      paddingVertical: compact ? 8 : 4,
    },
    headerSide: { width: 44, alignItems: "center" },
    headerControl: {
      borderRadius: 22,
      borderWidth: StyleSheet.hairlineWidth,
      borderColor: `${colors.line}70`,
      backgroundColor: `${colors.surface}b8`,
      ...(Platform.OS === "web"
        ? { backdropFilter: "blur(20px) saturate(180%)" }
        : {}),
      boxShadow: "0 2px 12px rgba(0,0,0,0.06)",
    },
    identity: { maxWidth: "70%", minWidth: 0, alignItems: "center", gap: 4 },
    nameCapsule: {
      maxWidth: "100%",
      flexDirection: "row",
      alignItems: "center",
      gap: 3,
      minHeight: 26,
      paddingHorizontal: 10,
      paddingVertical: 3,
      borderRadius: 16,
      borderWidth: StyleSheet.hairlineWidth,
      borderColor: `${colors.line}70`,
      backgroundColor: `${colors.surface}b8`,
      ...(Platform.OS === "web"
        ? { backdropFilter: "blur(20px) saturate(180%)" }
        : {}),
    },
    options: { gap: 2 },
    option: {
      minHeight: 48,
      flexDirection: "row",
      alignItems: "center",
      gap: 14,
      paddingHorizontal: 12,
      borderRadius: 10,
    },
    optionText: { fontFamily: systemFont, fontSize: 17, color: colors.ink },
    pressed: { backgroundColor: colors.wash },
    title: {
      fontFamily: systemFont,
      fontSize: compact ? 17 : 13,
      fontWeight: "600",
      color: colors.ink,
    },
    caption: {
      fontFamily: systemFont,
      fontSize: 12,
      color: colors.muted,
      lineHeight: 18,
    },
    thread: { width: 320, borderLeftWidth: 1, borderLeftColor: colors.line },
    fullThread: { width: "100%", borderLeftWidth: 0 },
  });
}
