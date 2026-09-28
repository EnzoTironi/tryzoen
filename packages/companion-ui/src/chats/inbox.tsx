import { useDeferredValue, useState, type ComponentProps } from "react";
import { useInfiniteQuery, useQuery } from "@tanstack/react-query";
import {
  ActivityIndicator,
  FlatList,
  Pressable,
  StyleSheet,
  Text,
  TextInput,
  View,
} from "react-native";
import { Archive, Compass, Search, SquarePen, Plus } from "lucide-react-native";
import { IconButton } from "../icon-button";
import { ActionButton } from "../button";
import { colors } from "../theme";
import { ConversationRow } from "./row";
import { ConversationAvatar } from "./avatar";
import { useConversationLibrary } from "./library";
import type { ChatData } from "./schema";
import type { RoomData, roomSchema } from "../rooms/schema";
import type { z } from "zod";
import { CreateRoom } from "../rooms/create";
import { CreateConversation } from "./create";

const filters = ["Todas", "Pessoas", "Grupos", "Bots"] as const;
export function ConversationInbox({
  data,
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
  const [query, setQuery] = useState("");
  const search = useDeferredValue(query);
  const [filter, setFilter] = useState<(typeof filters)[number]>("Todas");
  const [archived, setArchived] = useState(false);
  const [creating, setCreating] = useState(false);
  const [composing, setComposing] = useState(false);
  const { chats, items, change } = useConversationLibrary(
    data,
    cacheScope,
    search,
    archived
  );
  const groups = useQuery({
    queryKey: ["matrix-rooms", cacheScope],
    queryFn: () => rooms.list(),
    staleTime: 30_000,
  });
  const directs = useInfiniteQuery({
    queryKey: ["matrix-directs", cacheScope],
    initialPageParam: undefined as string | undefined,
    queryFn: ({ pageParam }) => rooms.directs({ before: pageParam }),
    getNextPageParam: (last) => last.nextCursor ?? undefined,
    enabled: groups.data?.configured === true,
    staleTime: 10_000,
    refetchInterval: 30_000,
  });
  const visibleDirects =
    !archived &&
    (filter === "Todas" || filter === "Pessoas") &&
    !directs.isError
      ? (directs.data?.pages
          .flatMap((page) => page.items)
          .filter((room) =>
            `${room.label} ${room.username ?? ""}`
              .toLocaleLowerCase()
              .includes(search.toLocaleLowerCase())
          ) ?? [])
      : [];
  const visibleGroups =
    !archived && (filter === "Todas" || filter === "Grupos")
      ? (groups.data?.rooms.filter((room) =>
          room.label.toLocaleLowerCase().includes(search.toLocaleLowerCase())
        ) ?? [])
      : [];
  const showBots = filter === "Todas" || filter === "Bots";
  const visibleChats = showBots ? items : [];
  const pinned =
    !search && !archived && showBots
      ? items.filter((chat) => chat.pinned).slice(0, 6)
      : [];
  const rows = [
    ...[...visibleDirects, ...visibleGroups].map((room) => ({
      kind: "room" as const,
      room,
    })),
    ...visibleChats.map((chat) => ({ kind: "agent" as const, chat })),
  ];
  return (
    <View style={styles.inbox}>
      <View style={styles.heading}>
        <Text accessibilityRole="header" style={styles.title}>
          {archived ? "Arquivadas" : "Conversas"}
        </Text>
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
      <FlatList
        data={rows}
        keyExtractor={(item) =>
          item.kind === "room" ? item.room.id : item.chat.sessionId
        }
        style={styles.list}
        keyboardShouldPersistTaps="handled"
        initialNumToRender={12}
        windowSize={5}
        ListHeaderComponent={
          <>
            <PinnedConversations
              chats={pinned}
              avatarUri={avatarUri}
              onOpen={onOpen}
            />
            {filter === "Grupos" &&
              groups.data?.mayManage &&
              groups.data.configured && (
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
              room={item.room}
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
          !chats.isPending && !groups.isPending && !directs.isLoading ? (
            <InboxEmpty
              search={search}
              groups={filter === "Grupos"}
              people={filter === "Pessoas"}
              configured={groups.data?.configured ?? false}
            />
          ) : null
        }
        ListFooterComponent={
          <View style={styles.feedback}>
            <InboxFeedback
              loading={chats.isPending || groups.isPending || directs.isLoading}
              error={Boolean(chats.error ?? groups.error ?? directs.error)}
              onRetry={() => {
                void chats.refetch();
                void groups.refetch();
                if (groups.data?.configured) void directs.refetch();
              }}
            />
            {directs.hasNextPage &&
              (filter === "Todas" || filter === "Pessoas") &&
              !archived && (
                <ActionButton
                  quiet
                  disabled={directs.isFetchingNextPage}
                  onPress={() => {
                    void directs.fetchNextPage();
                  }}
                >
                  Mais conversas com pessoas
                </ActionButton>
              )}
            {chats.hasNextPage && showBots && (
              <ActionButton
                quiet
                disabled={chats.isFetchingNextPage}
                onPress={() => {
                  void chats.fetchNextPage();
                }}
              >
                Carregar mais
              </ActionButton>
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
          configured={groups.data?.configured ?? false}
          mayManage={groups.data?.mayManage ?? false}
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
  room,
  selected,
  onOpen,
}: {
  readonly room: z.infer<typeof roomSchema>;
  readonly selected: boolean;
  readonly onOpen: (id: string) => void;
}) {
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
        <Text style={styles.caption}>
          {room.kind === "group"
            ? "Grupo"
            : room.username
              ? `@${room.username}`
              : "Conversa direta"}
        </Text>
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
  readonly chats: ReturnType<typeof useConversationLibrary>["items"];
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
