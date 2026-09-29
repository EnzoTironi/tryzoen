import { useMarkRoomUnread } from "./unread";
import { RoomPins } from "./pins";
import { RoomSearch } from "./search";
import { ConnectionStatus } from "../conversation/connection";
import { PresenceIndicator } from "./presence";
import { useRoomLifecycle } from "./lifecycle";
import { useRoomSync } from "./sync";
import { RoomTypingIndicator } from "./typing-indicator";
import { useContext, useState } from "react";
import { CompanionVisibility } from "../visibility";
import { useInfiniteQuery } from "@tanstack/react-query";
import {
  Pressable,
  StyleSheet,
  Text,
  useWindowDimensions,
  View,
} from "react-native";
import { ArrowLeft, Info, Search, Pin, X } from "lucide-react-native";
import type { z } from "zod";
import { RoomComposer } from "./composer";
import { useRoomDraft } from "./draft";
import { ActionButton } from "../button";
import { IconButton } from "../icon-button";
import { ConversationAvatar } from "../chats/avatar";
import { colors } from "../theme";
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
}: {
  readonly data: RoomData;
  readonly cacheScope: string;
  readonly roomId: string;
  readonly onBack: () => void;
  readonly onOpenRoom?: (id: string) => void;
  readonly avatarUri?: string;
  readonly onCopyText?: (text: string) => Promise<void>;
}) {
  const unread = useMarkRoomUnread(data, cacheScope, roomId, onBack);
  const [root, setRoot] = useState<z.infer<typeof roomMessageSchema>>();
  const [details, setDetails] = useState(false);
  const [searching, setSearching] = useState(false);
  const [pins, setPins] = useState(false);
  const draft = useRoomDraft(data, cacheScope, roomId);
  const [profile, setProfile] = useState<z.infer<typeof roomMemberSchema>>();
  const exposed = useContext(CompanionVisibility);
  const visible = exposed && !details && !profile && !searching && !pins;
  const active = useRoomLifecycle(cacheScope, roomId, exposed);
  const wide = useWindowDimensions().width >= 1100;
  const compact = useWindowDimensions().width < 720;
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
      <ConnectionStatus top={66} reconnecting={typing.reconnecting} />
      {(!root || wide || messages.isError) && (
        <View style={styles.main}>
          <RoomHeader
            onPins={() => {
              setPins(true);
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
                messages.hasNextPage &&
                !messages.isFetching &&
                !messages.isError
              )
                void messages.fetchNextPage({ cancelRefetch: false });
            }}
          />
          <RoomTypingIndicator
            userIds={typing.userIds}
            members={current?.pages[0]?.members ?? []}
          />
          <RoomComposer
            onTyping={typing.change}
            draft={draft}
            disabled={!room || messages.isError}
            paused={!active}
            visible={visible}
            direct={room?.kind === "direct"}
          />
        </View>
      )}
      {root && !messages.isError && (
        <View style={[styles.thread, !wide && styles.fullThread]}>
          <View style={styles.header}>
            {!wide && (
              <IconButton
                icon={ArrowLeft}
                label="Fechar thread"
                onPress={() => {
                  setRoot(undefined);
                }}
              />
            )}
            <View style={styles.headerCopy}>
              <Text style={styles.title}>Thread</Text>
              <Text numberOfLines={1} style={styles.caption}>
                Respostas à mensagem
              </Text>
            </View>
            {wide && (
              <IconButton
                icon={X}
                label="Fechar thread"
                onPress={() => {
                  setRoot(undefined);
                }}
              />
            )}
          </View>
          <RoomThread
            key={root.id}
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
            onProfile={setProfile}
            visible={visible}
            active={active}
            typing={typing}
          />
        </View>
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
  room,
  presence,
  compact,
  onBack,
  onProfile,
  onSearch,
  onPins,
}: {
  readonly room?: z.infer<typeof roomSchema>;
  readonly presence?: Parameters<typeof PresenceIndicator>[0]["state"];
  readonly compact: boolean;
  readonly onBack: () => void;
  readonly onProfile: () => void;
  readonly onSearch: () => void;
  readonly onPins: () => void;
}) {
  return (
    <View style={[styles.header, compact && styles.compactHeader]}>
      {compact && (
        <IconButton
          icon={ArrowLeft}
          label="Voltar às conversas"
          onPress={onBack}
        />
      )}
      <Pressable
        accessibilityRole="button"
        accessibilityLabel="Ver perfil da conversa"
        onPress={onProfile}
      >
        <ConversationAvatar
          name={room?.label ?? "Conversa"}
          uri={room?.avatarUri ?? undefined}
          group={room?.kind === "group"}
          size={38}
        />
      </Pressable>
      <Pressable
        accessibilityRole="button"
        accessibilityLabel={`Detalhes de ${room?.label ?? "conversa"}`}
        onPress={onProfile}
        style={styles.headerCopy}
      >
        <Text accessibilityRole="header" numberOfLines={1} style={styles.title}>
          {room?.label ?? "Conversa"}
        </Text>
        {presence && presence !== "offline" ? (
          <PresenceIndicator state={presence} />
        ) : (
          <Text numberOfLines={1} style={styles.caption}>
            {room?.kind === "direct"
              ? room.username
                ? `@${room.username} · conversa direta`
                : "Conversa direta"
              : "Pessoas e Zoen · espaço compartilhado"}
          </Text>
        )}
      </Pressable>
      <IconButton icon={Pin} label="Mensagens fixadas" onPress={onPins} />
      <IconButton icon={Search} label="Buscar na conversa" onPress={onSearch} />
      {!compact && (
        <IconButton
          icon={Info}
          label={
            room?.kind === "direct" ? "Perfil da pessoa" : "Detalhes do grupo"
          }
          onPress={onProfile}
        />
      )}
    </View>
  );
}

function RoomThread({
  data,
  cacheScope,
  roomId,
  root,
  avatarUri,
  onCopyText,
  onProfile,
  visible,
  active,
  typing,
  onUnread,
}: Pick<
  Parameters<typeof RoomConversation>[0],
  "data" | "cacheScope" | "roomId" | "avatarUri" | "onCopyText"
> & {
  readonly onUnread?: () => void;
  readonly root: z.infer<typeof roomMessageSchema>;
  readonly onProfile: (person: z.infer<typeof roomMemberSchema>) => void;
  readonly visible: boolean;
  readonly active: boolean;
  readonly typing: ReturnType<typeof useRoomSync>;
}) {
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
    <>
      <RoomMessages
        onUnread={onUnread}
        data={data}
        roomId={roomId}
        cacheScope={cacheScope}
        avatarUri={avatarUri}
        onCopy={onCopyText}
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
    </>
  );
}

const styles = StyleSheet.create({
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
    backgroundColor: colors.surface,
  },
  main: { flex: 1, minWidth: 0 },
  header: {
    minHeight: 78,
    flexDirection: "row",
    gap: 10,
    alignItems: "center",
    paddingHorizontal: 18,
    borderBottomWidth: 1,
    borderBottomColor: "#efeff1",
  },
  headerCopy: { flex: 1, minWidth: 0, gap: 4 },
  compactHeader: { paddingHorizontal: 12, gap: 8 },
  title: { fontSize: 17, fontWeight: "600", color: colors.ink },
  caption: { fontSize: 12, color: colors.muted, lineHeight: 18 },
  thread: { width: 320, borderLeftWidth: 1, borderLeftColor: "#ededf0" },
  fullThread: { width: "100%", borderLeftWidth: 0 },
});
