import type { ReactNode } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { expect, it, vi } from "vitest";
import { RoomMessageContext } from "./context";
import type { RoomData } from "./schema";
vi.mock("react-native", () => import("react-native-web"));
vi.mock("lucide-react-native", () => import("lucide-react"));
vi.mock("../sheet", () => ({
  CompanionSheet: ({ children }: { children: ReactNode }) => (
    <div>{children}</div>
  ),
}));
vi.mock("../markdown", () => ({
  AssistantMarkdown: ({ text }: { text: string }) => <p>{text}</p>,
}));
const mocks = vi.hoisted(() => ({ fetching: false }));
vi.mock("@tanstack/react-query", () => ({
  useQuery: () => ({
    isFetching: mocks.fetching,
    isError: false,
    data: {
      room: { label: "Room", kind: "group" },
      members: [],
      target: {
        id: "$event",
        text: "Cached private text",
        sender: "Ana",
        timestamp: 1,
      },
      root: null,
      messages: [],
    },
  }),
}));
const data: RoomData = {
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
  operationId: vi.fn<RoomData["operationId"]>(),
  messages: vi.fn<RoomData["messages"]>(),
  thread: vi.fn<RoomData["thread"]>(),
  reactions: vi.fn<RoomData["reactions"]>(),
  react: vi.fn<RoomData["react"]>(),
  list: vi.fn<RoomData["list"]>(),
  send: vi.fn<RoomData["send"]>(),
  create: vi.fn<RoomData["create"]>(),
};
it("hides cached context while membership is being revalidated", () => {
  const render = () =>
    renderToStaticMarkup(
      <RoomMessageContext
        data={data}
        cacheScope="viewer"
        reference={{ id: "room", messageId: "$event" }}
        onClose={vi.fn<() => void>()}
        onOpenRoom={vi.fn<(id: string) => void>()}
      />
    );
  mocks.fetching = false;
  expect(render()).toContain("Cached private text");
  mocks.fetching = true;
  const html = render();
  expect(html).not.toContain("Cached private text");
  expect(html).toContain("Localizando mensagem original");
});
