import { RoomSearch } from "./search";
import { useRoomLifecycle } from "./lifecycle";
import { useRoomTyping } from "./typing";
import { RoomTypingIndicator } from "./typing-indicator";
import { useState } from "react";
import { useInfiniteQuery } from "@tanstack/react-query";
import {
  Pressable,
  StyleSheet,
  Text,
  useWindowDimensions,
  View,
} from "react-native";
import { ArrowLeft, Info, Search, X } from "lucide-react-native";
import type { z } from "zod";
import { RoomComposer } from "./composer";
import { useRoomDraft } from "./draft";
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
  const [root, setRoot] = useState<z.infer<typeof roomMessageSchema>>();
  const [details, setDetails] = useState(false);
  const [searching, setSearching] = useState(false);
  const draft = useRoomDraft(data, cacheScope, roomId);
  const [profile, setProfile] = useState<z.infer<typeof roomMemberSchema>>();
  const reactions = useRoomReactions(data, cacheScope, roomId);
  const active = useRoomLifecycle(cacheScope, roomId);
  const wide = useWindowDimensions().width >= 1100;
  const compact = useWindowDimensions().width < 720;
  const messages = useInfiniteQuery({
    queryKey: ["matrix-messages", cacheScope, roomId],
    initialPageParam: undefined as string | undefined,
    queryFn: ({ pageParam, signal }) =>
      data.messages({ id: roomId, from: pageParam }, signal),
    getNextPageParam: (last, _pages, _cursor, cursors) =>
      last.nextCursor && !cursors.includes(last.nextCursor)
        ? last.nextCursor
        : undefined,
    staleTime: 5_000,
    enabled: active,
    refetchInterval: 10_000,
    retry: 1,
  });
  const current = messages.isError ? undefined : messages.data;
  const room = current?.pages[0]?.room;
  const typing = useRoomTyping(
    data,
    cacheScope,
    roomId,
    !!room && !messages.isError && !details && !profile && !searching
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
    !messages.isError && !details && !profile && !searching && (!root || wide)
  );
  return (
    <View style={styles.layout}>
      {(!root || wide || messages.isError) && (
        <View style={styles.main}>
          <RoomHeader
            room={room}
            compact={compact}
            onBack={onBack}
            onProfile={showProfile}
            onSearch={() => {
              setSearching(true);
            }}
          />
          <RoomMessages
            data={data}
            roomId={roomId}
            cacheScope={cacheScope}
            avatarUri={avatarUri}
            onCopy={onCopyText}
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
            avatarUri={avatarUri}
            onCopyText={onCopyText}
            onProfile={setProfile}
            visible={!details && !profile && !searching}
            active={active}
            typing={typing}
          />
        </View>
      )}
      {details && room?.kind === "group" && current?.pages[0] && (
        <RoomDetails
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
          data={data}
          cacheScope={cacheScope}
          onOpenRoom={onOpenRoom}
          direct={room.kind === "direct"}
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
  compact,
  onBack,
  onProfile,
  onSearch,
}: {
  readonly room?: z.infer<typeof roomSchema>;
  readonly compact: boolean;
  readonly onBack: () => void;
  readonly onProfile: () => void;
  readonly onSearch: () => void;
}) {
  return (
    <View style={styles.header}>
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
        <Text style={styles.caption}>
          {room?.kind === "direct"
            ? room.username
              ? `@${room.username} · conversa direta`
              : "Conversa direta"
            : "Pessoas e Zoen · espaço compartilhado"}
        </Text>
      </Pressable>
      <IconButton icon={Search} label="Buscar na conversa" onPress={onSearch} />
      <IconButton
        icon={Info}
        label={
          room?.kind === "direct" ? "Perfil da pessoa" : "Detalhes do grupo"
        }
        onPress={onProfile}
      />
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
}: Pick<
  Parameters<typeof RoomConversation>[0],
  "data" | "cacheScope" | "roomId" | "avatarUri" | "onCopyText"
> & {
  readonly root: z.infer<typeof roomMessageSchema>;
  readonly onProfile: (person: z.infer<typeof roomMemberSchema>) => void;
  readonly visible: boolean;
  readonly active: boolean;
  readonly typing: ReturnType<typeof useRoomTyping>;
}) {
  const draft = useRoomDraft(data, cacheScope, roomId, root.id);
  const reactions = useRoomReactions(data, cacheScope, roomId);
  const result = useInfiniteQuery({
    queryKey: ["matrix-thread", cacheScope, roomId, root.id],
    initialPageParam: undefined as string | undefined,
    queryFn: ({ pageParam, signal }) =>
      data.thread({ id: roomId, rootId: root.id, from: pageParam }, signal),
    getNextPageParam: (last, _pages, _cursor, cursors) =>
      last.nextCursor && !cursors.includes(last.nextCursor)
        ? last.nextCursor
        : undefined,
    refetchInterval: 10_000,
    enabled: active,
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
        data={data}
        roomId={roomId}
        cacheScope={cacheScope}
        avatarUri={avatarUri}
        onCopy={onCopyText}
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
      />
    </>
  );
}

const styles = StyleSheet.create({
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
  title: { fontSize: 17, fontWeight: "600", color: colors.ink },
  caption: { fontSize: 12, color: colors.muted, lineHeight: 18 },
  thread: { width: 320, borderLeftWidth: 1, borderLeftColor: "#ededf0" },
  fullThread: { width: "100%", borderLeftWidth: 0 },
});
