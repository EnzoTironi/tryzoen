import { renderToStaticMarkup } from "react-dom/server";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { afterEach, expect, it, vi } from "vitest";
import { useEffect, type EffectCallback } from "react";
import { useRoomDraft } from "./draft";
import type { RoomData } from "./schema";

const effects = vi.hoisted(() => [] as EffectCallback[]);
vi.mock("react", async (original) => ({
  ...(await original<typeof import("react")>()),
  useEffect: (effect: EffectCallback) => {
    effects.push(effect);
  },
}));
const client = new QueryClient();
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
  operationId: () => crypto.randomUUID(),
  send: vi.fn<RoomData["send"]>().mockResolvedValue(undefined),
  list: vi.fn<RoomData["list"]>(),
  create: vi.fn<RoomData["create"]>(),
  messages: vi.fn<RoomData["messages"]>(),
  thread: vi.fn<RoomData["thread"]>(),
  reactions: vi.fn<RoomData["reactions"]>(),
  react: vi.fn<RoomData["react"]>(),
};
const quote = {
  id: "$quote",
  senderId: "@member:test",
  sender: "Member",
  text: "Original message",
  mine: false,
  bot: false,
  timestamp: 1,
  rootId: null,
  replies: 0,
  reply: null,
};

function open(scope = "viewer:workspace", room = "room", root?: string) {
  let result!: ReturnType<typeof useRoomDraft>;
  function Conversation() {
    const draft = useRoomDraft(data, scope, room, root);
    useEffect(() => {
      result = draft;
    }, [draft]);
    return null;
  }
  renderToStaticMarkup(
    <QueryClientProvider client={client}>
      <Conversation />
    </QueryClientProvider>
  );
  for (const effect of effects.splice(0)) {
    const cleanup = effect();
    cleanup?.();
  }
  return result;
}

afterEach(() => {
  client.clear();
  vi.mocked(data.send).mockReset().mockResolvedValue(undefined);
});

it("restores text and quote after navigation, with separate account, room and thread drafts", () => {
  open().change("Main draft");
  open().replyTo(quote);
  open("viewer:workspace", "room", "$thread").change("Thread draft");
  expect(open()).toMatchObject({ text: "Main draft", reply: quote });
  expect(open("viewer:workspace", "room", "$thread").text).toBe("Thread draft");
  expect(open("other:workspace").text).toBe("");
  expect(open("viewer:another-workspace").text).toBe("");
  expect(open("viewer:workspace", "another-room").text).toBe("");
  expect(open("viewer:workspace", "room", "$another-thread").text).toBe("");
});

it("keeps failed drafts and retries the same native transaction after reopening", async () => {
  vi.mocked(data.send).mockRejectedValueOnce(new Error("Lost response"));
  open().change("Reply");
  open().replyTo(quote);
  await expect(open().send({ text: "Reply", files: [] })).rejects.toThrow(
    "Lost response"
  );
  expect(open()).toMatchObject({
    text: "Reply",
    reply: quote,
    status: "failed",
  });
  await open().send({ text: "Reply", files: [] });
  expect(data.send).toHaveBeenNthCalledWith(
    2,
    vi.mocked(data.send).mock.calls[0]?.[0]
  );
  expect(open()).toMatchObject({ text: "", status: "idle" });
  expect(open().reply).toBeUndefined();
});

it("uses a new transaction when editing a failed message or changing its quote", async () => {
  vi.mocked(data.send).mockRejectedValue(new Error("Offline"));
  open().change("First");
  await expect(open().send({ text: "First" })).rejects.toThrow("Offline");
  open().change("Revised");
  await expect(open().send({ text: "Revised" })).rejects.toThrow("Offline");
  open().replyTo(quote);
  await expect(open().send({ text: "Revised" })).rejects.toThrow("Offline");
  const ids = vi
    .mocked(data.send)
    .mock.calls.map(([input]) => input.operationId);
  expect(new Set(ids).size).toBe(3);
});

it("keeps pending state through navigation and prevents duplicate concurrent submissions", async () => {
  const pending = pendingSend();
  vi.mocked(data.send).mockReturnValueOnce(pending.promise);
  open().change("Sending");
  const sent = open().send({ text: "Sending" });
  expect(open().status).toBe("sending");
  open().change("Must not replace in-flight text");
  open().replyTo(quote);
  await expect(open().send({ text: "Sending" })).rejects.toThrow(
    "already being sent"
  );
  expect(data.send).toHaveBeenCalledTimes(1);
  expect(open().text).toBe("Sending");
  pending.settle();
  await sent;
  expect(open().text).toBe("");
});

it.each([false, true])(
  "does not recreate cleared account data when an in-flight send settles (failure=%s)",
  async (fails) => {
    const pending = pendingSend();
    vi.mocked(data.send).mockReturnValueOnce(pending.promise);
    open().change("Private draft");
    const sent = open().send({ text: "Private draft" });
    client.clear();
    if (fails) pending.settle(new Error("Unavailable"));
    else pending.settle();
    await sent.catch(() => undefined);
    expect(client.getQueryCache().getAll()).toHaveLength(0);
  }
);

it("sends a thread draft to its own root and clears only that draft", async () => {
  open().change("Main draft");
  const thread = () => open("viewer:workspace", "room", "$root");
  thread().change("Thread reply");
  thread().replyTo(quote);
  await thread().send({ text: "Thread reply" });
  expect(data.send).toHaveBeenCalledWith(
    expect.objectContaining({
      id: "room",
      rootId: "$root",
      replyTo: "$quote",
      text: "Thread reply",
    })
  );
  expect(thread().text).toBe("");
  expect(open().text).toBe("Main draft");
});

function pendingSend() {
  let settle: ((error?: Error) => void) | undefined;
  const promise = new Promise<void>((resolve, reject) => {
    settle = (error?: Error) => {
      if (error) reject(error);
      else resolve();
    };
  });
  if (!settle) throw new Error("Send not initialized");
  return { promise, settle };
}

it("retains attachments through failure and navigation, then clears only the successful room draft", async () => {
  const files = [
    {
      type: "file" as const,
      filename: "audio.wav",
      mediaType: "audio/wav",
      url: "data:audio/wav;base64,AAAA",
    },
  ];
  open().changeFiles(files);
  vi.mocked(data.send).mockRejectedValueOnce(new Error("Offline"));
  await expect(open().send({ text: "", files })).rejects.toThrow("Offline");
  expect(open().files).toEqual(files);
  expect(open("viewer:other").files).toBeUndefined();
  await open().send({ text: "", files });
  expect(vi.mocked(data.send).mock.calls[0]?.[0]).toEqual(
    vi.mocked(data.send).mock.calls[1]?.[0]
  );
  expect(open().files).toBeUndefined();
});
