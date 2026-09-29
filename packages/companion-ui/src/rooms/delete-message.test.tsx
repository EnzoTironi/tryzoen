import { renderToStaticMarkup } from "react-dom/server";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { beforeEach, expect, it, vi } from "vitest";
import { DeleteRoomMessage } from "./delete-message";
import type { RoomData } from "./schema";
import type { ComponentProps, ReactNode } from "react";
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
  notifications: vi.fn<RoomData["notifications"]>(),
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
  operationId: () => "operation",
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
const original = {
  id: "$message",
  text: "Private filename",
  media: { filename: "secret.txt", mediaType: "text/plain" },
  reply: { text: "Secret quote" },
};
const history = {
  pageParams: [undefined],
  pages: [{ messages: [original], parent: original }],
};
beforeEach(() => {
  presses.clear();
  vi.mocked(data.deleteMessage).mockReset();
});
it("redacts cached content and parent in this conversation only, and drops downloaded attachment bytes", async () => {
  const client = new QueryClient();
  const close = vi.fn<() => void>();
  for (const kind of ["matrix-messages", "matrix-thread"])
    client.setQueryData([kind, "viewer", "room"], history);
  client.setQueryData(["matrix-messages", "other-viewer", "room"], history);
  client.setQueryData(["matrix-media", "viewer", "room", "$message"], {
    url: "private bytes",
  });
  vi.mocked(data.deleteMessage).mockResolvedValue(undefined);
  renderToStaticMarkup(
    <QueryClientProvider client={client}>
      <DeleteRoomMessage
        data={data}
        roomId="room"
        cacheScope="viewer"
        messageId="$message"
        onClose={close}
      />
    </QueryClientProvider>
  );
  expect(data.deleteMessage).not.toHaveBeenCalled();
  presses.get("Excluir mensagem")?.();
  await vi.waitFor(() => {
    expect(close).toHaveBeenCalledOnce();
  });
  expect(
    client.getQueryData(["matrix-thread", "viewer", "room"])
  ).toMatchObject({
    pages: [
      {
        parent: { text: "Mensagem removida", media: undefined, redacted: true },
        messages: [{ text: "Mensagem removida", reply: null }],
      },
    ],
  });
  expect(
    client.getQueryData(["matrix-media", "viewer", "room", "$message"])
  ).toBeUndefined();
  expect(
    client.getQueryData(["matrix-messages", "other-viewer", "room"])
  ).toEqual(history);
  client.clear();
});
it("a failed deletion keeps content and retry reuses the transaction ID", async () => {
  const client = new QueryClient();
  const close = vi.fn<() => void>();
  client.setQueryData(["matrix-messages", "viewer", "room"], history);
  vi.mocked(data.deleteMessage)
    .mockRejectedValueOnce(new Error("Disconnected"))
    .mockResolvedValueOnce(undefined);
  renderToStaticMarkup(
    <QueryClientProvider client={client}>
      <DeleteRoomMessage
        data={data}
        roomId="room"
        cacheScope="viewer"
        messageId="$message"
        onClose={close}
      />
    </QueryClientProvider>
  );
  presses.get("Excluir mensagem")?.();
  await vi.waitFor(() => {
    expect(client.getMutationCache().getAll()[0]?.state.status).toBe("error");
  });
  expect(close).not.toHaveBeenCalled();
  expect(client.getQueryData(["matrix-messages", "viewer", "room"])).toEqual(
    history
  );
  presses.get("Excluir mensagem")?.();
  await vi.waitFor(() => {
    expect(close).toHaveBeenCalledOnce();
  });
  expect(vi.mocked(data.deleteMessage).mock.calls).toEqual([
    [{ id: "room", messageId: "$message", operationId: "operation" }],
    [{ id: "room", messageId: "$message", operationId: "operation" }],
  ]);
  client.clear();
});
