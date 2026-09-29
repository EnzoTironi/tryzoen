import { renderToStaticMarkup } from "react-dom/server";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { beforeEach, expect, it, vi } from "vitest";
import type { ComponentProps, ReactNode } from "react";
import { EditRoomMessage } from "./edit-message";
import { MarkdownEditorProvider } from "../markdown-editor";
import type { RoomData } from "./schema";
import type { ActionButton } from "../button";
vi.mock("react-native", () => import("react-native-web"));
vi.mock("../sheet", () => ({
  CompanionSheet: ({ children }: { children: ReactNode }) => (
    <div>{children}</div>
  ),
}));
const presses = vi.hoisted(() => new Map<string, () => void>());
vi.mock("../button", () => ({
  ActionButton: (props: ComponentProps<typeof ActionButton>) => {
    presses.set(props.children, props.onPress);
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
  reportMessage: vi.fn<RoomData["reportMessage"]>(),
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

const item = {
  id: "$message",
  sender: "Person",
  mine: true,
  bot: false,
  text: "Original",
  timestamp: 1,
  rootId: null,
  reply: null,
  replies: 2,
};
const roomId = "00000000-0000-4000-8000-000000000002";
beforeEach(() => {
  presses.clear();
  vi.mocked(data.editMessage).mockReset();
});
function render(client: QueryClient, close: () => void) {
  return renderToStaticMarkup(
    <QueryClientProvider client={client}>
      <MarkdownEditorProvider
        value={(props) => {
          if (typeof props.ref === "object" && props.ref)
            props.ref.current = { read: async () => "**Revised**" };
          return <div>Visual editor</div>;
        }}
      >
        <EditRoomMessage
          data={data}
          roomId={roomId}
          cacheScope="viewer"
          item={item}
          onClose={close}
        />
      </MarkdownEditorProvider>
    </QueryClientProvider>
  );
}
it("saves visual markdown without replacing pagination, thread identity or another viewer", async () => {
  const client = new QueryClient();
  const close = vi.fn<() => void>();
  const history = {
    pageParams: [undefined, "older"],
    pages: [{ messages: [item], parent: item }, { messages: [] }],
  };
  for (const scope of ["viewer", "other"])
    client.setQueryData(["matrix-thread", scope, roomId], history);
  vi.mocked(data.editMessage).mockResolvedValue({
    status: "saved",
    message: { ...item, text: "**Revised**", editId: "$edit" },
  });
  expect(render(client, close)).toContain("Visual editor");
  presses.get("Salvar alterações")?.();
  await vi.waitFor(() => {
    expect(close).toHaveBeenCalledOnce();
  });
  expect(data.editMessage).toHaveBeenCalledWith(
    expect.objectContaining({ text: "**Revised**", expectedRevision: item.id })
  );
  expect(
    client.getQueryData(["matrix-thread", "viewer", roomId])
  ).toMatchObject({
    pageParams: [undefined, "older"],
    pages: [
      {
        parent: { id: item.id, text: "**Revised**", replies: 2 },
        messages: [{ id: item.id, editId: "$edit" }],
      },
      {},
    ],
  });
  expect(client.getQueryData(["matrix-thread", "other", roomId])).toEqual(
    history
  );
  client.clear();
});
it("retry keeps the native operation ID and a conflict never closes or changes cached text", async () => {
  const client = new QueryClient();
  const close = vi.fn<() => void>();
  vi.mocked(data.editMessage)
    .mockRejectedValueOnce(new Error("offline"))
    .mockResolvedValue({
      status: "conflict",
      message: { ...item, text: "External", editId: "$external" },
    });
  render(client, close);
  presses.get("Salvar alterações")?.();
  await vi.waitFor(() => {
    expect(data.editMessage).toHaveBeenCalledTimes(1);
  });
  presses.get("Salvar alterações")?.();
  await vi.waitFor(() => {
    expect(data.editMessage).toHaveBeenCalledTimes(2);
  });
  expect(vi.mocked(data.editMessage).mock.calls[0]).toEqual(
    vi.mocked(data.editMessage).mock.calls[1]
  );
  expect(close).not.toHaveBeenCalled();
  client.clear();
});
