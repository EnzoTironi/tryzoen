import { SavedRoomMessages } from "../rooms/saved";
import {
  useContext,
  useDeferredValue,
  useState,
  type ComponentProps,
} from "react";
import { CompanionVisibility } from "../visibility";
import { useInfiniteQuery, useQueryClient } from "@tanstack/react-query";
import {
  ActivityIndicator,
  FlatList,
  Pressable,
  StyleSheet,
  Text,
  TextInput,
  View,
} from "react-native";
import {
  Bookmark,
  Archive,
  Compass,
  Search,
  SquarePen,
  Plus,
  RefreshCw,
} from "lucide-react-native";
import { IconButton } from "../icon-button";
import { ActionButton } from "../button";
import { colors } from "../theme";
import { ConversationRow } from "./row";
import { ConversationAvatar } from "./avatar";
import type {
  InboxData,
  inboxItemSchema,
  inboxNotificationsSchema,
  inboxPageSchema,
  inboxQuerySchema,
} from "./inbox-schema";
import type { ChatData } from "./schema";
import type { RoomData } from "../rooms/schema";
import type { z } from "zod";
import { CreateRoom } from "../rooms/create";
import { CreateConversation } from "./create";
import { useInboxSync } from "./sync";
import { conversationTime } from "./time";

function useConversationInbox(
  inbox: InboxData,
  cacheScope: string,
  input: Omit<z.infer<typeof inboxQuerySchema>, "cursor">
) {
  const client = useQueryClient();
  const visible = useContext(CompanionVisibility);
  const conversations = useInfiniteQuery({
    enabled: visible,
    queryKey: [
      "conversation-inbox",
      cacheScope,
      input.archived,
      input.query,
      input.filter,
    ],
    initialPageParam: null as z.infer<typeof inboxPageSchema>["nextCursor"],
    queryFn: ({ pageParam, signal }) =>
      inbox.list(
        {
          ...input,
          cursor: pageParam,
        },
        signal
      ),
    getNextPageParam: (last, _pages, _cursor, cursors) =>
      last.nextCursor &&
      !cursors.some(
        (cursor) =>
          cursor?.activityAt === last.nextCursor?.activityAt &&
          cursor?.kind === last.nextCursor?.kind &&
          cursor?.id === last.nextCursor?.id
      )
        ? last.nextCursor
        : undefined,
    staleTime: 15_000,
    refetchOnWindowFocus: false,
    refetchOnReconnect: false,
    refetchOnMount: false,
    gcTime: 60_000,
    retry: 1,
  });
  const refresh = () => {
    void client.resetQueries({
      queryKey: [
        "conversation-inbox",
        cacheScope,
        input.archived,
        input.query,
        input.filter,
      ],
      exact: true,
    });
  };
  return { conversations, refresh };
}

const filters = ["Todas", "Pessoas", "Grupos", "Bots"] as const;
export function ConversationInbox({
  data,
  inbox,
  rooms,
  cacheScope,
  selectedId,
  selectedRoom,
  avatarUri,
  onOpen,
  onOpenRoom,
  onCreate,
  onDiscover,
  onExport,
}: {
  readonly data: ChatData;
  readonly inbox: InboxData;
  readonly rooms: RoomData;
  readonly cacheScope: string;
  readonly selectedId?: string;
  readonly selectedRoom?: string;
  readonly avatarUri?: string;
  readonly onOpen: (id: string) => void;
  readonly onOpenRoom: (id: string) => void;
  readonly onCreate: () => void;
  readonly onDiscover: () => void;
  readonly onExport: (id: string) => Promise<void>;
}) {
  const [saved, setSaved] = useState(false);
  const [query, setQuery] = useState("");
  const search = useDeferredValue(query);
  const [filter, setFilter] = useState<(typeof filters)[number]>("Todas");
  const [archived, setArchived] = useState(false);
  const [creating, setCreating] = useState(false);
  const [composing, setComposing] = useState(false);
  const [nearHead, setNearHead] = useState(true);
  const client = useQueryClient();
  const filterKind = {
    Todas: "all",
    Pessoas: "people",
    Grupos: "groups",
    Bots: "bots",
  } as const;
  const { conversations, refresh } = useConversationInbox(inbox, cacheScope, {
    query: search,
    archived,
    filter: filterKind[filter],
  });
  const pages = conversations.isError ? [] : (conversations.data?.pages ?? []);
  const page = pages[0];
  const pinned = page?.pinned ?? [];
  const sync = useInboxSync(
    inbox,
    cacheScope,
    { query: search, archived, filter: filterKind[filter] },
    !archived &&
      filter !== "Bots" &&
      conversations.data?.pages[0]?.configured === true,
    nearHead,
    selectedRoom
  );
  const rows = Array.from(
    new Map(
      pages
        .flatMap((entry) => entry.items)
        .map((entry) => [
          entry.kind === "room"
            ? `room:${entry.room.id}`
            : `agent:${entry.chat.sessionId}`,
          entry,
        ])
    ).values()
  );
  const change: ChatData["change"] = async (input) => {
    await data.change(input);
    await Promise.all([
      client.invalidateQueries({
        queryKey: ["conversation-inbox", cacheScope],
      }),
      client.invalidateQueries({
        queryKey: ["conversation-library", cacheScope],
      }),
    ]);
  };
  return (
    <View style={styles.inbox}>
      {saved && (
        <SavedRoomMessages
          data={rooms}
          cacheScope={cacheScope}
          onClose={() => {
            setSaved(false);
          }}
          onOpenRoom={onOpenRoom}
        />
      )}
      <View style={styles.heading}>
        <Text accessibilityRole="header" style={styles.title}>
          {archived ? "Arquivadas" : "Conversas"}
        </Text>
        <IconButton
          icon={Bookmark}
          label="Mensagens salvas"
          onPress={() => {
            setSaved(true);
          }}
        />
        <IconButton
          icon={RefreshCw}
          label="Atualizar conversas"
          disabled={conversations.isFetching}
          onPress={refresh}
        />
        <IconButton
          icon={Archive}
          label={archived ? "Ver conversas ativas" : "Ver arquivadas"}
          selected={archived}
          onPress={() => {
            setArchived(!archived);
          }}
        />
        <IconButton
          icon={SquarePen}
          label="Nova conversa"
          onPress={() => {
            setComposing(true);
          }}
        />
      </View>
      <View style={styles.search}>
        <Search size={17} color={colors.muted} />
        <TextInput
          accessibilityLabel="Buscar conversas"
          placeholder="Buscar"
          value={query}
          onChangeText={setQuery}
          maxLength={200}
          style={styles.input}
        />
      </View>
      <View accessibilityRole="tablist" style={styles.filters}>
        {filters.map((label) => (
          <Pressable
            key={label}
            accessibilityRole="tab"
            accessibilityState={{ selected: filter === label }}
            onPress={() => {
              setFilter(label);
            }}
            style={[styles.filter, filter === label && styles.activeFilter]}
          >
            <Text
              style={[styles.filterText, filter === label && styles.activeText]}
            >
              {label}
            </Text>
          </Pressable>
        ))}
      </View>
      {sync.pending && (
        <ActionButton quiet onPress={sync.apply}>
          Novas conversas · Atualizar
        </ActionButton>
      )}
      {sync.reconnecting && (
        <Text accessibilityLiveRegion="polite" style={styles.caption}>
          Reconectando… As conversas podem estar desatualizadas.
        </Text>
      )}
      <FlatList
        onScroll={({ nativeEvent }) => {
          setNearHead(nativeEvent.contentOffset.y < 80);
        }}
        scrollEventThrottle={100}
        data={rows}
        keyExtractor={(item) =>
          item.kind === "room"
            ? `room:${item.room.id}`
            : `agent:${item.chat.sessionId}`
        }
        style={styles.list}
        keyboardShouldPersistTaps="handled"
        initialNumToRender={12}
        windowSize={5}
        onEndReached={() => {
          if (
            conversations.hasNextPage &&
            !conversations.isFetching &&
            !conversations.isError
          )
            void conversations.fetchNextPage({ cancelRefetch: false });
        }}
        onEndReachedThreshold={0.5}
        refreshing={conversations.isRefetching}
        onRefresh={refresh}
        ListHeaderComponent={
          <>
            <PinnedConversations
              chats={pinned}
              avatarUri={avatarUri}
              onOpen={onOpen}
            />
            {filter === "Grupos" && page?.mayManage && page.configured && (
              <ActionButton
                quiet
                onPress={() => {
                  setCreating(true);
                }}
              >
                Criar grupo
              </ActionButton>
            )}
          </>
        }
        renderItem={({ item }) =>
          item.kind === "room" ? (
            <RoomRow
              item={item}
              notifications={sync.notifications.find(
                (entry) => entry.id === item.room.id
              )}
              selected={selectedRoom === item.room.id}
              onOpen={onOpenRoom}
            />
          ) : (
            <ConversationRow
              chat={item.chat}
              dense
              avatarUri={avatarUri}
              selected={item.chat.sessionId === selectedId && !selectedRoom}
              onOpen={onOpen}
              onChange={change}
              onExport={onExport}
            />
          )
        }
        ListEmptyComponent={
          !conversations.isPending && !conversations.isError ? (
            <InboxEmpty
              search={search}
              groups={filter === "Grupos"}
              people={filter === "Pessoas"}
              configured={page?.configured ?? false}
            />
          ) : null
        }
        ListFooterComponent={
          <View style={styles.feedback}>
            <InboxFeedback
              loading={
                conversations.isPending || conversations.isFetchingNextPage
              }
              error={conversations.isError}
              onRetry={refresh}
            />
            {page?.syncPending && (
              <Text style={styles.caption}>
                Atualizando o histórico das conversas…
              </Text>
            )}
          </View>
        }
      />
      <View style={styles.footer}>
        <Pressable
          accessibilityRole="button"
          onPress={onDiscover}
          style={styles.footerLink}
        >
          <Compass size={19} color={colors.muted} />
          <Text style={styles.footerText}>Descobrir bots</Text>
        </Pressable>
        <Pressable
          accessibilityRole="button"
          onPress={onCreate}
          style={styles.footerLink}
        >
          <Plus size={19} color={colors.accent} />
          <Text style={styles.footerText}>Nova conversa com Zoen</Text>
        </Pressable>
      </View>
      {creating && (
        <CreateRoom
          data={rooms}
          cacheScope={cacheScope}
          onClose={() => {
            setCreating(false);
          }}
          onCreated={(id) => {
            setCreating(false);
            onOpenRoom(id);
          }}
        />
      )}
      {composing && (
        <CreateConversation
          data={rooms}
          cacheScope={cacheScope}
          configured={page?.configured ?? false}
          mayManage={page?.mayManage ?? false}
          avatarUri={avatarUri}
          onClose={() => {
            setComposing(false);
          }}
          onAgent={() => {
            setComposing(false);
            onCreate();
          }}
          onGroup={() => {
            setComposing(false);
            setCreating(true);
          }}
          onOpened={(id) => {
            setComposing(false);
            onOpenRoom(id);
          }}
        />
      )}
    </View>
  );
}
function RoomRow({
  item,
  notifications,
  selected,
  onOpen,
}: {
  readonly item: Extract<z.infer<typeof inboxItemSchema>, { kind: "room" }>;
  readonly notifications?: z.infer<typeof inboxNotificationsSchema>[number];
  readonly selected: boolean;
  readonly onOpen: (id: string) => void;
}) {
  const { room } = item;
  const time = item.activityAt > 0 ? conversationTime(item.activityAt) : null;
  return (
    <Pressable
      accessibilityRole="button"
      accessibilityState={{ selected: selected }}
      onPress={() => {
        onOpen(room.id);
      }}
      style={[styles.room, selected && styles.selected]}
    >
      <ConversationAvatar
        name={room.label}
        uri={room.avatarUri ?? undefined}
        group={room.kind === "group"}
      />
      <View style={styles.copy}>
        <Text numberOfLines={1} style={styles.name}>
          {room.label}
        </Text>
        <Text numberOfLines={1} style={styles.caption}>
          {item.preview ??
            (item.summaryState === "unavailable"
              ? "Prévia indisponível"
              : room.kind === "group"
                ? "Grupo"
                : room.username
                  ? `@${room.username}`
                  : "Conversa direta")}
        </Text>
      </View>
      <View style={styles.rowMeta}>
        {time && (
          <Text style={styles.time} accessibilityLabel={time.description}>
            {time.label}
          </Text>
        )}
        {notifications && notifications.notificationCount > 0 && (
          <Text
            accessibilityLabel={`${notifications.notificationCount} notificações não lidas${notifications.highlightCount ? `, ${notifications.highlightCount} destaques` : ""}`}
            style={styles.unread}
          >
            {notifications.notificationCount > 99
              ? "99+"
              : notifications.notificationCount}
          </Text>
        )}
      </View>
    </Pressable>
  );
}

function InboxEmpty({
  search,
  groups,
  people,
  configured,
}: {
  readonly search: string;
  readonly groups: boolean;
  readonly people: boolean;
  readonly configured: boolean;
}) {
  return (
    <View style={styles.empty}>
      <Text style={styles.emptyTitle}>
        {search
          ? "Nenhuma conversa encontrada"
          : groups
            ? "Seus grupos aparecem aqui"
            : people
              ? "Suas conversas aparecem aqui"
              : "Vamos conversar?"}
      </Text>
      <Text style={styles.caption}>
        {groups
          ? configured
            ? "Crie um grupo no seu espaço compartilhado."
            : "O serviço de grupos ainda não está conectado neste ambiente."
          : people
            ? "Toque em nova conversa e busque alguém deste espaço pelo nome ou username."
            : "Comece com o Zoen. Suas conversas ficam salvas aqui."}
      </Text>
    </View>
  );
}

function InboxFeedback({
  loading,
  error,
  onRetry,
}: {
  readonly loading: boolean;
  readonly error: boolean;
  readonly onRetry: () => void;
}) {
  return (
    <>
      {loading && (
        <ActivityIndicator accessibilityLabel="Carregando conversas" />
      )}
      {error && (
        <>
          <Text accessibilityRole="alert" style={styles.caption}>
            Não foi possível atualizar todas as conversas.
          </Text>
          <ActionButton quiet onPress={onRetry}>
            Tentar novamente
          </ActionButton>
        </>
      )}
    </>
  );
}

function PinnedConversations({
  chats,
  avatarUri,
  onOpen,
}: Pick<ComponentProps<typeof ConversationInbox>, "avatarUri" | "onOpen"> & {
  readonly chats: z.infer<typeof inboxPageSchema>["pinned"];
}) {
  return (
    <>
      {chats.length > 0 && (
        <>
          <Text style={styles.sectionLabel}>Fixadas</Text>
          <View style={styles.pins}>
            {chats.map((chat) => (
              <Pressable
                key={chat.sessionId}
                accessibilityRole="button"
                accessibilityLabel={`Abrir ${chat.title}`}
                onPress={() => {
                  onOpen(chat.sessionId);
                }}
                style={styles.pin}
              >
                <ConversationAvatar
                  name={chat.title}
                  uri={avatarUri}
                  size={64}
                />
                <Text numberOfLines={1} style={styles.pinName}>
                  {chat.title}
                </Text>
              </Pressable>
            ))}
          </View>
        </>
      )}
    </>
  );
}

const styles = StyleSheet.create({
  inbox: {
    flex: 1,
    minHeight: 0,
    paddingTop: 20,
    paddingHorizontal: 14,
    backgroundColor: colors.surface,
  },
  heading: { flexDirection: "row", alignItems: "center", marginBottom: 16 },
  title: {
    flex: 1,
    color: colors.ink,
    fontSize: 25,
    fontWeight: "700",
    letterSpacing: -0.7,
  },
  search: {
    flexDirection: "row",
    alignItems: "center",
    gap: 8,
    borderRadius: 12,
    backgroundColor: "#f3f3f5",
    paddingHorizontal: 12,
    minHeight: 38,
  },
  input: {
    flex: 1,
    outlineWidth: 0,
    color: colors.ink,
    fontSize: 15,
    paddingVertical: 8,
  },
  filters: { flexDirection: "row", gap: 6, paddingVertical: 15 },
  filter: {
    flex: 1,
    minHeight: 34,
    borderRadius: 18,
    alignItems: "center",
    justifyContent: "center",
  },
  activeFilter: { backgroundColor: "#e8effa" },
  filterText: { fontSize: 13, color: colors.muted },
  activeText: { color: colors.accent, fontWeight: "600" },
  list: { flex: 1, minHeight: 0 },
  sectionLabel: {
    fontSize: 13,
    fontWeight: "500",
    color: colors.ink,
    marginTop: 12,
  },
  pins: {
    flexDirection: "row",
    flexWrap: "wrap",
    rowGap: 16,
    paddingBottom: 22,
  },
  pin: { width: "33.333%", alignItems: "center", gap: 7, paddingHorizontal: 5 },
  pinName: { fontSize: 12, color: colors.ink, maxWidth: "100%" },
  room: {
    flexDirection: "row",
    alignItems: "center",
    gap: 12,
    padding: 10,
    minHeight: 76,
    borderRadius: 13,
  },
  selected: { backgroundColor: "#e8f2ff" },
  copy: { flex: 1, minWidth: 0, gap: 5 },
  name: { color: colors.ink, fontSize: 15, fontWeight: "600" },
  rowMeta: { alignItems: "flex-end", gap: 7 },
  time: { color: colors.muted, fontSize: 11 },
  unread: {
    color: "#fff",
    backgroundColor: colors.accent,
    borderRadius: 12,
    minWidth: 22,
    paddingHorizontal: 6,
    paddingVertical: 2,
    textAlign: "center",
    fontSize: 12,
  },
  caption: { color: colors.muted, fontSize: 13, lineHeight: 20 },
  empty: { padding: 18, gap: 9 },
  emptyTitle: { color: colors.ink, fontSize: 16, fontWeight: "600" },
  feedback: { padding: 14, gap: 10 },
  footer: {
    gap: 4,
    paddingVertical: 12,
    borderTopWidth: 1,
    borderTopColor: "#f0f0f1",
  },
  footerLink: {
    flexDirection: "row",
    alignItems: "center",
    gap: 10,
    minHeight: 40,
    paddingHorizontal: 8,
  },
  footerText: { fontSize: 14, color: colors.ink },
});
