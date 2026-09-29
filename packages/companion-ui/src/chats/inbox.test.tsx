import type { ComponentProps } from "react";
import type { ChatData } from "./schema";
import type { InboxData, inboxNotificationsSchema } from "./inbox-schema";
import type { z } from "zod";
import { renderToStaticMarkup } from "react-dom/server";
import {
  QueryClient,
  QueryClientProvider,
  type useInfiniteQuery,
} from "@tanstack/react-query";
import { beforeEach, expect, it, vi } from "vitest";
import { ConversationInbox } from "./inbox";
import type { useInboxSync } from "./sync";
import type { RoomData } from "../rooms/schema";

vi.mock("react-native", () => import("react-native-web"));
vi.mock("lucide-react-native", () => import("lucide-react"));
const state = vi.hoisted(() => ({
  failed: false,
  scope: "account-a",
  notifications: [] as z.infer<typeof inboxNotificationsSchema>,
  options: undefined as Parameters<typeof useInfiniteQuery>[0] | undefined,
}));
vi.mock("./sync", () => ({
  useInboxSync: () => ({
    pending: false,
    reconnecting: false,
    apply: vi.fn<ReturnType<typeof useInboxSync>["apply"]>(),
    notifications: state.notifications,
  }),
}));
vi.mock("@tanstack/react-query", async (original) => ({
  ...(await original<typeof import("@tanstack/react-query")>()),
  useInfiniteQuery: (options: Parameters<typeof useInfiniteQuery>[0]) => {
    state.options = options;
    return {
      isError: state.failed,
      isPending: false,
      isFetching: false,
      isRefetching: false,
      data: {
        pages: [
          {
            configured: true,
            mayManage: false,
            syncPending: false,
            pinned: [],
            nextCursor: null,
            items: [
              {
                kind: "agent",
                activityAt: 3,
                chat: {
                  sessionId: "new-agent",
                  title: "Recent agent",
                  updatedAt: "2026-09-28T12:00:00Z",
                  pinned: false,
                  archived: false,
                },
              },
              {
                kind: "room",
                activityAt: 2,
                room: {
                  id: "direct",
                  label: "Ana",
                  kind: "direct",
                  username: "ana",
                  roomId: "!a:test",
                  epoch: "one",
                },
                preview: "Private preview",
                summaryState: "ready",
              },
              {
                kind: "agent",
                activityAt: 1,
                chat: {
                  sessionId: "old-agent",
                  title: "Older agent",
                  updatedAt: "2026-09-27T12:00:00Z",
                  pinned: false,
                  archived: false,
                },
              },
            ],
          },
        ],
      },
    };
  },
}));
const rooms: RoomData = {
  notifications: vi.fn<RoomData["notifications"]>(),
  rename: vi.fn<RoomData["rename"]>(),
  changeMembership: vi.fn<RoomData["changeMembership"]>(),
  setNotifications: vi.fn<RoomData["setNotifications"]>(),
  setTyping: vi.fn<RoomData["setTyping"]>(),
  readSync: vi.fn<RoomData["readSync"]>(),
  search: vi.fn<RoomData["search"]>(),
  markRead: vi.fn<RoomData["markRead"]>(),
  savedCleanupState: vi.fn<RoomData["savedCleanupState"]>(),
  clearUnavailableSavedMessages:
    vi.fn<RoomData["clearUnavailableSavedMessages"]>(),
  savedMessageState: vi.fn<RoomData["savedMessageState"]>(),
  savedMessages: vi.fn<RoomData["savedMessages"]>(),
  saveMessage: vi.fn<RoomData["saveMessage"]>(),
  context: vi.fn<RoomData["context"]>(),
  editMessage: vi.fn<RoomData["editMessage"]>(),
  deleteMessage: vi.fn<RoomData["deleteMessage"]>(),
  forwardDestinations: vi.fn<RoomData["forwardDestinations"]>(),
  forwardMessage: vi.fn<RoomData["forwardMessage"]>(),
  people: vi.fn<RoomData["people"]>(),
  openDirect: vi.fn<RoomData["openDirect"]>(),
  directs: vi.fn<RoomData["directs"]>(),
  media: vi.fn<RoomData["media"]>(),
  reactions: vi.fn<RoomData["reactions"]>(),
  react: vi.fn<RoomData["react"]>(),
  operationId: vi.fn<RoomData["operationId"]>(),
  list: vi.fn<RoomData["list"]>(),
  create: vi.fn<RoomData["create"]>(),
  messages: vi.fn<RoomData["messages"]>(),
  thread: vi.fn<RoomData["thread"]>(),
  send: vi.fn<RoomData["send"]>(),
};
function render() {
  return renderToStaticMarkup(
    <QueryClientProvider client={new QueryClient()}>
      <ConversationInbox
        cacheScope={state.scope}
        data={{
          list: vi.fn<ChatData["list"]>(),
          change: vi.fn<ChatData["change"]>(),
        }}
        inbox={{
          list: vi.fn<InboxData["list"]>(),
          sync: vi.fn<InboxData["sync"]>(),
        }}
        rooms={rooms}
        onOpen={vi.fn<
          NonNullable<ComponentProps<typeof ConversationInbox>["onOpen"]>
        >()}
        onOpenRoom={vi.fn<
          NonNullable<ComponentProps<typeof ConversationInbox>["onOpenRoom"]>
        >()}
        onCreate={vi.fn<
          NonNullable<ComponentProps<typeof ConversationInbox>["onCreate"]>
        >()}
        onDiscover={vi.fn<
          NonNullable<ComponentProps<typeof ConversationInbox>["onDiscover"]>
        >()}
        onExport={vi.fn<
          NonNullable<ComponentProps<typeof ConversationInbox>["onExport"]>
        >()}
      />
    </QueryClientProvider>
  );
}
beforeEach(() => {
  state.failed = false;
  state.scope = "account-a";
  state.notifications = [];
});
it("labels native counts as unread notifications with accessible highlights", () => {
  state.notifications = [
    { id: "direct", notificationCount: 105, highlightCount: 2 },
  ];
  const html = render();
  expect(html).toContain("105 notificações não lidas, 2 destaques");
  expect(html).toContain("99+");
  state.notifications = [
    { id: "other-room", notificationCount: 5, highlightCount: 0 },
  ];
  expect(render()).not.toContain("notificações não lidas");
});
it("preserves global server order across kinds and does not invent unread badges", () => {
  const html = render();
  expect(html.indexOf("Recent agent")).toBeLessThan(
    html.indexOf("Private preview")
  );
  expect(html.indexOf("Private preview")).toBeLessThan(
    html.indexOf("Older agent")
  );
  expect(html).not.toContain("não lidas");
  expect(html).not.toContain("Carregar mais");
  expect(html).toContain("Atualizar conversas");
});
it("hides cached previews when authorization or refresh fails", () => {
  state.failed = true;
  const html = render();
  expect(html).not.toContain("Private preview");
  expect(html).not.toContain("Recent agent");
  expect(html).toContain("Tentar novamente");
});
it("scopes history to the current account and prevents repeated cursors", () => {
  state.scope = "account-b";
  render();
  expect(state.options?.queryKey).toContain("account-b");
  const cursor = { activityAt: 12, kind: "room", id: "room" };
  const next = state.options?.getNextPageParam;
  expect(next?.({ nextCursor: cursor }, [], null, [null])).toEqual(cursor);
  expect(
    next?.({ nextCursor: cursor }, [], cursor, [null, cursor])
  ).toBeUndefined();
  expect(
    next?.({ nextCursor: null }, [], cursor, [null, cursor])
  ).toBeUndefined();
});

vi.mock("../rooms/saved", () => ({ SavedRoomMessages: () => null }));
