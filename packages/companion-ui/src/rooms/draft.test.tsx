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
  participate: vi.fn<RoomData["participate"]>(),
  pins: vi.fn<RoomData["pins"]>(),
  pin: vi.fn<RoomData["pin"]>(),
  reactors: vi.fn<RoomData["reactors"]>(),
  readReceiptPreference: vi.fn<RoomData["readReceiptPreference"]>(),
  setReadReceiptPreference: vi.fn<RoomData["setReadReceiptPreference"]>(),
  presencePreference: vi.fn<RoomData["presencePreference"]>(),
  setPresencePreference: vi.fn<RoomData["setPresencePreference"]>(),
  notifications: vi.fn<RoomData["notifications"]>(),
  rename: vi.fn<RoomData["rename"]>(),
  setAvatar: vi.fn<RoomData["setAvatar"]>(),
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
  people: vi.fn<RoomData["people"]>(),
  openDirect: vi.fn<RoomData["openDirect"]>(),
  directs: vi.fn<RoomData["directs"]>(),
  media: vi.fn<RoomData["media"]>(),
  operationId: () => crypto.randomUUID(),
  send: vi.fn<RoomData["send"]>().mockResolvedValue({ event_id: "$sent" }),
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
  vi.mocked(data.send).mockReset().mockResolvedValue({ event_id: "$sent" });
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

it("clears immediately and retries a failed echo without replacing the next draft", async () => {
  vi.mocked(data.send).mockRejectedValueOnce(new Error("Lost response"));
  open().change("Reply");
  open().replyTo(quote);
  await open().send({ text: "Reply", files: [] });
  expect(open().text).toBe("");
  open().change("Next draft");
  await vi.waitFor(() => {
    expect(open().outgoing[0]?.status).toBe("failed");
  });
  open().retry(open().outgoing[0]?.id ?? "missing");
  await vi.waitFor(() => {
    expect(data.send).toHaveBeenCalledTimes(2);
  });
  expect(vi.mocked(data.send).mock.calls[1]).toEqual(
    vi.mocked(data.send).mock.calls[0]
  );
  expect(open().text).toBe("Next draft");
  expect(open().reply).toBeUndefined();
});

it("keeps multiple sends through navigation in transport order with distinct identities", async () => {
  const pending = pendingSend();
  vi.mocked(data.send).mockReturnValueOnce(pending.promise);
  await open().send({ text: "Same text" });
  await open().send({ text: "Same text" });
  expect(open().outgoing).toHaveLength(2);
  expect(open().text).toBe("");
  await vi.waitFor(() => {
    expect(data.send).toHaveBeenCalledTimes(1);
  });
  expect(open().outgoing.map((entry) => !!entry.queued)).toEqual([false, true]);
  pending.resolve();
  await vi.waitFor(() => {
    expect(data.send).toHaveBeenCalledTimes(2);
  });
  const ids = vi
    .mocked(data.send)
    .mock.calls.map(([input]) => input.operationId);
  expect(new Set(ids).size).toBe(2);
});

it.each([false, true])(
  "does not recreate cleared account data after delivery (failure=%s)",
  async (fails) => {
    const pending = pendingSend();
    vi.mocked(data.send).mockReturnValueOnce(pending.promise);
    await open().send({ text: "Private draft" });
    await vi.waitFor(() => {
      expect(data.send).toHaveBeenCalledTimes(1);
    });
    client.clear();
    if (fails) pending.reject(new Error("Unavailable"));
    else pending.resolve();
    await new Promise((resolve) => setTimeout(resolve, 10));
    expect(client.getQueryCache().getAll()).toHaveLength(0);
  }
);

it("sends thread replies and attachments without touching the main or next draft", async () => {
  const files = [
    {
      type: "file" as const,
      filename: "audio.wav",
      mediaType: "audio/wav",
      url: "data:audio/wav;base64,AAAA",
    },
  ];
  const thread = () => open("viewer:workspace", "room", "$root");
  const pending = pendingSend();
  vi.mocked(data.send).mockReturnValueOnce(pending.promise);
  open().change("Main draft");
  thread().replyTo(quote);
  thread().changeFiles(files);
  await thread().send({ text: "Thread reply", files });
  thread().change("Next reply");
  thread().changeFiles(files);
  pending.reject(new Error("Offline"));
  await vi.waitFor(() => {
    expect(thread().outgoing[0]?.status).toBe("failed");
  });
  expect(data.send).toHaveBeenCalledWith(
    expect.objectContaining({
      id: "room",
      rootId: "$root",
      replyTo: "$quote",
      text: "Thread reply",
      files,
    })
  );
  expect(thread()).toMatchObject({ text: "Next reply", files });
  expect(thread().outgoing[0]?.input.files).toEqual(files);
  expect(open().text).toBe("Main draft");
  expect(open("other:workspace").outgoing).toHaveLength(0);
});

it("keeps a delivered reply accepted when automatic alerts are uncertain", async () => {
  const key = [
    "matrix-thread-subscription",
    "viewer:workspace",
    "room",
    "$root",
  ];
  client.setQueryData(key, {
    status: "ready",
    following: false,
    automatic: false,
  });
  vi.mocked(data.send).mockResolvedValueOnce({
    event_id: "$reply",
    subscription: { status: "unconfirmed" },
  });
  const thread = () => open("viewer:workspace", "room", "$root");
  await thread().send({ text: "Delivered once" });
  thread().change("Next reply");
  await vi.waitFor(() => {
    expect(thread().outgoing[0]?.status).toBe("accepted");
  });
  expect(client.getQueryData(key)).toEqual({ status: "unconfirmed" });
  expect(thread().text).toBe("Next reply");
  expect(data.send).toHaveBeenCalledTimes(1);
});

it("does not replace a newer manual alert decision with a late send warning", async () => {
  const key = [
    "matrix-thread-subscription",
    "viewer:workspace",
    "room",
    "$root",
  ];
  client.setQueryData(key, {
    status: "ready",
    following: false,
    automatic: false,
  });
  const pending = pendingSend();
  vi.mocked(data.send).mockReturnValueOnce(pending.promise);
  const thread = () => open("viewer:workspace", "room", "$root");
  await thread().send({ text: "Reply" });
  await vi.waitFor(() => {
    expect(data.send).toHaveBeenCalledTimes(1);
  });
  // Even an unchanged value is a newer explicit decision.
  client.setQueryData(key, {
    status: "ready",
    following: false,
    automatic: false,
  });
  pending.resolve({
    event_id: "$sent",
    subscription: { status: "unconfirmed" },
  });
  await vi.waitFor(() => {
    expect(thread().outgoing[0]?.status).toBe("accepted");
  });
  expect(client.getQueryData(key)).toMatchObject({
    status: "ready",
    following: false,
  });
});

function pendingSend() {
  let resolve!: (receipt?: Awaited<ReturnType<RoomData["send"]>>) => void;
  let reject!: (cause: Error) => void;
  const promise = new Promise<Awaited<ReturnType<RoomData["send"]>>>(
    (accept, fail) => {
      resolve = (receipt = { event_id: "$sent" }) => {
        accept(receipt);
      };
      reject = fail;
    }
  );
  return { promise, resolve, reject };
}
