import { renderToStaticMarkup } from "react-dom/server";
import { expect, it, vi } from "vitest";
import type { ReactNode, ComponentProps } from "react";
import type { z } from "zod";
import { SavedRoomMessages } from "./saved";
import type { savedMessageItemSchema, RoomData } from "./schema";
import type { ActionButton } from "../button";
const mocks = vi.hoisted(() => ({
  reset: vi.fn<(input: unknown) => Promise<void>>(),
  query: vi.fn<() => unknown>(),
  press: new Map<string, () => void>(),
}));
vi.mock("lucide-react-native", () => ({
  BookmarkX: () => null,
  ChevronRight: () => null,
}));
vi.mock("@tanstack/react-query", () => ({
  useQueryClient: () => ({ resetQueries: mocks.reset }),
  useInfiniteQuery: mocks.query,
}));
vi.mock("react-native", () => ({
  View: ({ children }: { children: ReactNode }) => <div>{children}</div>,
  Text: ({ children }: { children: ReactNode }) => <span>{children}</span>,
  Pressable: ({ children }: { children: ReactNode }) => (
    <button>{children}</button>
  ),
  ScrollView: ({ children }: { children: ReactNode }) => <div>{children}</div>,
  ActivityIndicator: () => null,
  StyleSheet: { create: <T,>(value: T) => value },
  FlatList: ({
    data,
    renderItem,
  }: {
    data: z.infer<typeof savedMessageItemSchema>[];
    renderItem: (input: {
      item: z.infer<typeof savedMessageItemSchema>;
    }) => ReactNode;
  }) => (
    <>
      {data.map((item) => (
        <div key={item.key}>{renderItem({ item })}</div>
      ))}
    </>
  ),
}));
vi.mock("../sheet", () => ({
  CompanionSheet: ({ children }: { children: ReactNode }) => (
    <div>{children}</div>
  ),
}));
vi.mock("../button", () => ({
  ActionButton: (props: ComponentProps<typeof ActionButton>) => {
    mocks.press.set(props.children, props.onPress);
    return <button>{props.children}</button>;
  },
}));
const data: RoomData = {
  pins: vi.fn<RoomData["pins"]>(),
  pin: vi.fn<RoomData["pin"]>(),
  reactors: vi.fn<RoomData["reactors"]>(),
  readReceiptPreference: vi.fn<RoomData["readReceiptPreference"]>(),
  setReadReceiptPreference: vi.fn<RoomData["setReadReceiptPreference"]>(),
  presencePreference: vi.fn<RoomData["presencePreference"]>(),
  setPresencePreference: vi.fn<RoomData["setPresencePreference"]>(),
  notifications: vi.fn<RoomData["notifications"]>(),
  rename: vi.fn<RoomData["rename"]>(),
  changeMembership: vi.fn<RoomData["changeMembership"]>(),
  setNotifications: vi.fn<RoomData["setNotifications"]>(),
  setTyping: vi.fn<RoomData["setTyping"]>(),
  readSync: vi.fn<RoomData["readSync"]>(),
  search: vi.fn<RoomData["search"]>(),
  setUnread: vi.fn<RoomData["setUnread"]>(),
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
  operationId: () => "00000000-0000-4000-8000-000000000001",
  people: vi.fn<RoomData["people"]>(),
  openDirect: vi.fn<RoomData["openDirect"]>(),
  directs: vi.fn<RoomData["directs"]>(),
  media: vi.fn<RoomData["media"]>(),
  reactions: vi.fn<RoomData["reactions"]>(),
  react: vi.fn<RoomData["react"]>(),
  list: vi.fn<RoomData["list"]>(),
  create: vi.fn<RoomData["create"]>(),
  messages: vi.fn<RoomData["messages"]>(),
  thread: vi.fn<RoomData["thread"]>(),
  send: vi.fn<RoomData["send"]>(),
};

const page = {
  revision: "a".repeat(64),
  items: [
    {
      key: "saved",
      reference: { id: "room", messageId: "event" },
      savedAt: 1,
      room: { id: "room", label: "Private room" },
      message: { text: "Private message" },
    },
  ],
  reset: false,
  nextCursor: null,
};
function render() {
  return renderToStaticMarkup(
    <SavedRoomMessages
      data={data}
      cacheScope="person:space"
      onClose={() => undefined}
      onOpenRoom={() => undefined}
    />
  );
}
it("never renders cached content after a request failure or revision-reset page", () => {
  for (const state of [
    { isError: true, data: { pages: [page] } },
    { isError: false, data: { pages: [page, { ...page, reset: true }] } },
  ]) {
    mocks.query.mockReturnValue(state);
    const html = render();
    expect(html).not.toContain("Private message");
    expect(html).not.toContain("Private room");
  }
});
it("a changed collection restarts the exact scoped infinite query rather than replaying loaded pages", () => {
  mocks.query.mockReturnValue({
    isError: false,
    data: { pages: [page, { ...page, reset: true }] },
  });
  render();
  mocks.press.get("Atualizar")?.();
  expect(mocks.reset).toHaveBeenCalledWith({
    queryKey: ["matrix-saved", "person:space"],
    exact: true,
  });
});

vi.mock("../markdown", () => ({
  AssistantMarkdown: ({ text }: { text: string }) => <div>{text}</div>,
}));
vi.mock("./attachment", () => ({ RoomAttachment: () => null }));
vi.mock("./save-message", () => ({ SaveRoomMessage: () => null }));

vi.mock("./clear-saved", () => ({ ClearUnavailableSaved: () => null }));

vi.mock("../chats/avatar", () => ({ ConversationAvatar: () => null }));
