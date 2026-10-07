import { useI18n } from "./../i18n";
import { SavedRoomMessages } from "../rooms/saved";
import {
  useContext,
  useDeferredValue,
  useMemo,
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
  useWindowDimensions,
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
  Ellipsis,
  ListFilter,
  Check,
  ChevronRight,
  MessagesSquare,
  SearchX,
  UsersRound,
} from "lucide-react-native";
import { IconButton } from "../icon-button";
import { ActionButton } from "../button";
import { EmptyState } from "../empty-state";
import { systemFont, useColors } from "../theme";
import { useShellChrome } from "../shell-chrome";
import { CompanionSheet } from "../sheet";
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
  const { t } = useI18n();
  const compact = useWindowDimensions().width < 720;
  const colors = useColors();
  const chrome = useShellChrome();
  const styles = useMemo(() => createStyles(colors), [colors]);
  const [menu, setMenu] = useState<"options" | "filters">();
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
  const searchField = (
    <View style={[styles.search, compact && styles.mobileSearch]}>
      <Search size={18} color={colors.muted} />
      <TextInput
        accessibilityLabel={t("Buscar conversas")}
        placeholder={t("Buscar")}
        placeholderTextColor={colors.muted}
        value={query}
        onChangeText={setQuery}
        maxLength={200}
        returnKeyType="search"
        clearButtonMode="while-editing"
        style={styles.input}
      />
    </View>
  );
  return (
    <View style={[styles.inbox, compact && styles.mobileInbox]}>
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
        <IconButton
          quiet
          icon={Ellipsis}
          label={t("Opções das conversas")}
          onPress={() => {
            setMenu("options");
          }}
        />
        <Text
          accessibilityRole="header"
          style={[styles.title, compact && styles.mobileTitle]}
        >
          {archived
            ? t("Arquivadas")
            : filter === "Todas"
              ? t("Conversas")
              : filter}
        </Text>
        <IconButton
          quiet
          icon={ListFilter}
          label={t("Filtrar conversas")}
          selected={filter !== "Todas"}
          onPress={() => {
            setMenu("filters");
          }}
        />
        {!compact && (
          <IconButton
            icon={SquarePen}
            label={t("Nova conversa")}
            onPress={() => {
              setComposing(true);
            }}
          />
        )}
      </View>
      {!compact && searchField}
      {menu && (
        <CompanionSheet
          title={
            menu === "filters"
              ? t("Filtrar conversas")
              : t("Opções das conversas")
          }
          onClose={() => {
            setMenu(undefined);
          }}
        >
          <View style={styles.menu}>
            {menu === "filters"
              ? filters.map((label) => (
                  <Pressable
                    key={label}
                    accessibilityRole="radio"
                    accessibilityState={{ checked: filter === label }}
                    onPress={() => {
                      setFilter(label);
                      setMenu(undefined);
                    }}
                    style={styles.menuRow}
                  >
                    <Text style={styles.menuText}>{label}</Text>
                    {filter === label && (
                      <Check size={20} color={colors.accent} />
                    )}
                  </Pressable>
                ))
              : [
                  {
                    label: t("Mensagens salvas"),
                    icon: Bookmark,
                    press: () => {
                      setSaved(true);
                    },
                  },
                  {
                    label: t("Atualizar conversas"),
                    icon: RefreshCw,
                    press: refresh,
                    disabled: conversations.isFetching,
                  },
                  {
                    label: archived
                      ? t("Ver conversas ativas")
                      : t("Ver arquivadas"),
                    icon: Archive,
                    press: () => {
                      setArchived(!archived);
                    },
                  },
                  {
                    label: t("Descobrir bots"),
                    icon: Compass,
                    press: onDiscover,
                  },
                  {
                    label: t("Nova conversa com Zoen"),
                    icon: Plus,
                    press: onCreate,
                  },
                ].map(({ label, icon: Icon, press, disabled }) => (
                  <Pressable
                    key={label}
                    accessibilityRole="button"
                    disabled={disabled}
                    accessibilityState={{ disabled }}
                    onPress={() => {
                      setMenu(undefined);
                      press();
                    }}
                    style={[styles.menuRow, disabled && styles.dimmed]}
                  >
                    <Icon size={21} color={colors.ink} />
                    <Text style={styles.menuText}>{label}</Text>
                  </Pressable>
                ))}
          </View>
        </CompanionSheet>
      )}
      {sync.pending && (
        <ActionButton quiet onPress={sync.apply}>
          {t("Novas conversas · Atualizar")}
        </ActionButton>
      )}
      {sync.reconnecting && (
        <Text accessibilityLiveRegion="polite" style={styles.caption}>
          {t("Reconectando… As conversas podem estar desatualizadas.")}
        </Text>
      )}
      <FlatList
        onScroll={({ nativeEvent }) => {
          setNearHead(nativeEvent.contentOffset.y < 80);
          chrome.onScroll?.(nativeEvent.contentOffset.y);
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
        keyboardDismissMode="on-drag"
        contentContainerStyle={styles.listContent}
        ItemSeparatorComponent={ConversationSeparator}
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
                {t("Criar grupo")}
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
                {t("Atualizando o histórico das conversas…")}
              </Text>
            )}
          </View>
        }
      />
      {compact && (
        <View
          style={[
            styles.footer,
            // Sit above the floating tab bar rather than under it.
            chrome.bottomInset > 0 && { marginBottom: chrome.bottomInset - 8 },
          ]}
        >
          {searchField}
          <IconButton
            icon={SquarePen}
            label={t("Nova conversa")}
            onPress={() => {
              setComposing(true);
            }}
          />
        </View>
      )}
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
function ConversationSeparator() {
  const colors = useColors();
  return (
    <View
      style={{
        marginLeft: 68,
        marginRight: 10,
        height: StyleSheet.hairlineWidth,
        backgroundColor: colors.line,
      }}
    />
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
  const { t, locale } = useI18n();
  const { room } = item;
  const compact = useWindowDimensions().width < 720;
  const colors = useColors();
  const styles = useMemo(() => createStyles(colors), [colors]);
  const highlighted = selected && !compact;
  const time =
    item.activityAt > 0
      ? conversationTime(item.activityAt, new Date(), locale)
      : null;
  const unread =
    notifications &&
    (notifications.notificationCount > 0 || notifications.markedUnread);
  return (
    <Pressable
      accessibilityRole="button"
      accessibilityState={{ selected: highlighted }}
      onPress={() => {
        onOpen(room.id);
      }}
      style={({ pressed }) => [
        styles.room,
        highlighted && styles.selected,
        pressed && !highlighted && styles.pressed,
      ]}
    >
      <View style={styles.unreadSpace}>
        {unread && (
          <View
            accessible
            accessibilityLabel={
              notifications.notificationCount
                ? t("{value1} notificações não lidas{value2}", {
                    value1: notifications.notificationCount,
                    value2: notifications.highlightCount
                      ? `, ${notifications.highlightCount} destaques`
                      : "",
                  })
                : t("Marcada como não lida")
            }
            style={[styles.unread, highlighted && styles.selectedDot]}
          />
        )}
      </View>
      <ConversationAvatar
        name={room.label}
        uri={room.avatarUri ?? undefined}
        group={room.kind === "group"}
      />
      <View style={styles.copy}>
        <View style={styles.titleLine}>
          <Text
            numberOfLines={1}
            style={[styles.name, highlighted && styles.selectedText]}
          >
            {room.label}
          </Text>
          {time && (
            <Text
              style={[styles.time, highlighted && styles.selectedText]}
              accessibilityLabel={time.description}
            >
              {time.label}
            </Text>
          )}
          {compact && <ChevronRight size={14} color={colors.muted} />}
        </View>
        <Text
          numberOfLines={2}
          style={[styles.caption, highlighted && styles.selectedText]}
        >
          {item.preview ??
            (item.summaryState === "unavailable"
              ? t("Prévia indisponível")
              : room.kind === "group"
                ? t("Grupo")
                : room.username
                  ? `@${room.username}`
                  : t("Conversa direta"))}
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
  const { t } = useI18n();
  return (
    <EmptyState
      compact
      icon={search ? SearchX : groups ? UsersRound : MessagesSquare}
      title={
        search
          ? t("Nenhuma conversa encontrada")
          : groups
            ? t("Seus grupos aparecem aqui")
            : people
              ? t("Suas conversas aparecem aqui")
              : t("Vamos conversar?")
      }
      body={
        groups
          ? configured
            ? t("Crie um grupo no seu espaço compartilhado.")
            : t("O serviço de grupos ainda não está conectado neste ambiente.")
          : people
            ? t(
                "Toque em nova conversa e busque alguém deste espaço pelo nome ou username."
              )
            : t("Comece com o Zoen. Suas conversas ficam salvas aqui.")
      }
    />
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
  const { t } = useI18n();
  const colors = useColors();
  const styles = useMemo(() => createStyles(colors), [colors]);
  return (
    <>
      {loading && (
        <ActivityIndicator accessibilityLabel={t("Carregando conversas")} />
      )}
      {error && (
        <>
          <Text accessibilityRole="alert" style={styles.caption}>
            {t("Não foi possível atualizar todas as conversas.")}
          </Text>
          <ActionButton quiet onPress={onRetry}>
            {t("Tentar novamente")}
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
  const { t } = useI18n();
  const colors = useColors();
  const styles = useMemo(() => createStyles(colors), [colors]);
  return (
    <>
      {chats.length > 0 && (
        <>
          <Text style={styles.sectionLabel}>{t("Fixadas")}</Text>
          <View style={styles.pins}>
            {chats.map((chat) => (
              <Pressable
                key={chat.sessionId}
                accessibilityRole="button"
                accessibilityLabel={t("Abrir {value1}", { value1: chat.title })}
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

const createStyles = (palette: ReturnType<typeof useColors>) =>
  StyleSheet.create({
    inbox: {
      flex: 1,
      minHeight: 0,
      paddingTop: 8,
      paddingHorizontal: 8,
      backgroundColor: palette.sidebar,
    },
    mobileInbox: { backgroundColor: palette.canvas },
    heading: {
      flexDirection: "row",
      alignItems: "center",
      minHeight: 48,
      marginBottom: 8,
    },
    title: {
      flex: 1,
      fontFamily: systemFont,
      color: palette.ink,
      fontSize: 17,
      fontWeight: "600",
      paddingLeft: 4,
    },
    mobileTitle: { textAlign: "center", paddingLeft: 0 },
    search: {
      flexDirection: "row",
      alignItems: "center",
      gap: 7,
      borderRadius: 22,
      backgroundColor: palette.wash,
      paddingHorizontal: 12,
      minHeight: 36,
      marginHorizontal: 6,
      marginBottom: 10,
    },
    mobileSearch: {
      flex: 1,
      minWidth: 0,
      minHeight: 44,
      marginHorizontal: 0,
      marginBottom: 0,
    },
    input: {
      flex: 1,
      minWidth: 0,
      fontFamily: systemFont,
      color: palette.ink,
      fontSize: 16,
      paddingVertical: 7,
    },
    list: { flex: 1, minHeight: 0 },
    listContent: { paddingBottom: 64 },
    sectionLabel: {
      fontFamily: systemFont,
      fontSize: 12,
      fontWeight: "500",
      color: palette.muted,
      marginTop: 8,
      marginBottom: 8,
      paddingHorizontal: 10,
    },
    pins: {
      flexDirection: "row",
      flexWrap: "wrap",
      rowGap: 16,
      paddingBottom: 18,
    },
    pin: {
      width: "33.333%",
      alignItems: "center",
      gap: 7,
      paddingHorizontal: 5,
    },
    pinName: {
      fontFamily: systemFont,
      fontSize: 12,
      color: palette.ink,
      maxWidth: "100%",
    },
    room: {
      flexDirection: "row",
      alignItems: "center",
      gap: 8,
      paddingVertical: 12,
      paddingRight: 12,
      minHeight: 84,
      borderRadius: 9,
    },
    selected: { backgroundColor: palette.selection },
    pressed: { backgroundColor: palette.wash },
    selectedText: { color: palette.selectedInk },
    selectedDot: { backgroundColor: palette.selectedInk },
    unreadSpace: { width: 8, alignItems: "center" },
    unread: {
      width: 7,
      height: 7,
      borderRadius: 4,
      backgroundColor: palette.accent,
    },
    copy: { flex: 1, minWidth: 0, gap: 3 },
    titleLine: { flexDirection: "row", alignItems: "center", gap: 6 },
    name: {
      flex: 1,
      minWidth: 0,
      fontFamily: systemFont,
      color: palette.ink,
      fontSize: 16,
      fontWeight: "600",
    },
    time: { fontFamily: systemFont, color: palette.muted, fontSize: 12 },
    caption: {
      fontFamily: systemFont,
      color: palette.muted,
      fontSize: 15,
      lineHeight: 20,
    },
    feedback: { padding: 14, gap: 10 },
    footer: {
      flexDirection: "row",
      alignItems: "center",
      gap: 8,
      paddingLeft: 52,
      paddingRight: 4,
      paddingTop: 8,
      paddingBottom: 10,
      backgroundColor: palette.canvas,
    },
    menu: { gap: 2 },
    menuRow: {
      flexDirection: "row",
      alignItems: "center",
      gap: 14,
      minHeight: 48,
      paddingHorizontal: 12,
    },
    menuText: {
      flex: 1,
      fontFamily: systemFont,
      fontSize: 17,
      color: palette.ink,
    },
    dimmed: { opacity: 0.4 },
  });
