import { beforeEach, afterEach, expect, test, vi } from "vitest";
import { useRoomSync } from "./sync";
import type { RoomData } from "./schema";
import type { applyRoomChanges } from "./history";
import {
  InfiniteQueryObserver,
  QueryClient,
  QueryObserver,
} from "@tanstack/react-query";
const state = vi.hoisted(() => ({
  effects: [] as (() => void | (() => void))[],
  active: "active",
  online: true,
  listeners: new Set<(state: string) => void>(),
  network: new Set<(online: boolean) => void>(),
  snapshots: [] as unknown[],
}));
vi.mock("react", () => ({
  useRef: (value: unknown) => ({ current: value }),
  useCallback: (value: unknown) => value,
  useState: () => [undefined, (value: unknown) => state.snapshots.push(value)],
  useEffect: (effect: () => void | (() => void)) => state.effects.push(effect),
}));
vi.mock("react-native", () => ({
  AppState: {
    get currentState() {
      return state.active;
    },
    addEventListener: (_event: string, callback: (state: string) => void) => {
      state.listeners.add(callback);
      return { remove: () => state.listeners.delete(callback) };
    },
  },
}));
vi.mock("@tanstack/react-query", async (original) => ({
  ...(await original<typeof import("@tanstack/react-query")>()),
  useQueryClient: () => client,
  onlineManager: {
    isOnline: () => state.online,
    subscribe: (callback: (online: boolean) => void) => {
      state.network.add(callback);
      return () => state.network.delete(callback);
    },
  },
}));
const client = new QueryClient({
  defaultOptions: { queries: { retry: false } },
});
const unsubscribe: (() => void)[] = [];
const data = {
  setTyping: vi.fn<RoomData["setTyping"]>(),
  readSync: vi.fn<RoomData["readSync"]>(),
  search: vi.fn<RoomData["search"]>(),
};
let dispose: (() => void) | undefined;
function TypingHarness({ enabled }: { enabled: boolean }) {
  return useRoomSync(data, "account:workspace", "room", enabled);
}
function mount(enabled = true) {
  state.effects = [];
  const value = TypingHarness({ enabled });
  const cleanup = state.effects.map((effect) => effect());
  dispose = () => {
    for (const item of cleanup) item?.();
  };
  return value;
}
beforeEach(() => {
  vi.useFakeTimers();
  vi.setSystemTime(100000);
  state.active = "active";
  state.online = true;
  state.snapshots = [];
  data.setTyping.mockReset().mockResolvedValue();
  data.readSync.mockReset().mockImplementation(
    () =>
      new Promise(() => {
        /* The synthetic request remains pending until disposal. */
      })
  );
});
afterEach(() => {
  dispose?.();
  dispose = undefined;
  for (const stop of unsubscribe.splice(0)) stop();
  client.clear();
  vi.useRealTimers();
});
test("publishes only actual edits, throttles refresh and stops at idle", async () => {
  const hook = mount();
  expect(data.setTyping).not.toHaveBeenCalled();
  hook.change(true);
  await vi.advanceTimersByTimeAsync(0);
  hook.change(true);
  expect(data.setTyping).toHaveBeenCalledTimes(1);
  await vi.advanceTimersByTimeAsync(8000);
  expect(data.setTyping).toHaveBeenLastCalledWith({
    id: "room",
    typing: false,
  });
});
test("a late true cannot overtake stop, even if its response fails", async () => {
  let reject: ((reason: Error) => void) | undefined;
  const pending = new Promise<void>((_resolve, fail) => {
    reject = fail;
  });
  data.setTyping.mockImplementationOnce(() => pending);
  const hook = mount();
  hook.change(true);
  hook.change(false);
  expect(data.setTyping).toHaveBeenCalledTimes(1);
  reject?.(new Error("response lost"));
  await vi.advanceTimersByTimeAsync(0);
  expect(data.setTyping).toHaveBeenLastCalledWith({
    id: "room",
    typing: false,
  });
});
test("background/offline abort observation and stop publication without auto-resuming draft", async () => {
  const hook = mount();
  hook.change(true);
  await vi.advanceTimersByTimeAsync(0);
  const signal = data.readSync.mock.calls[0]?.[1];
  state.active = "background";
  for (const listener of state.listeners) listener("background");
  await vi.advanceTimersByTimeAsync(0);
  expect(signal.aborted).toBe(true);
  expect(data.setTyping).toHaveBeenLastCalledWith({
    id: "room",
    typing: false,
  });
  await vi.advanceTimersByTimeAsync(60000);
  expect(data.readSync).toHaveBeenCalledTimes(1);
  state.active = "active";
  for (const listener of state.listeners) listener("active");
  expect(data.readSync).toHaveBeenCalledTimes(2);
  expect(data.setTyping).toHaveBeenCalledTimes(2);
  state.online = false;
  for (const listener of state.network) listener(false);
  await vi.advanceTimersByTimeAsync(60000);
  expect(data.readSync).toHaveBeenCalledTimes(2);
});
test("replayed response cannot extend its expiry and disposal clears state", async () => {
  const response = {
    status: "ready" as const,
    cursor: "opaque",
    userIds: ["ana"],
    presence: [],
    expiresAt: 105000,
    timelineChanged: false,
    reactionsChanged: false,
    changes: null,
    reset: false,
  };
  data.readSync.mockResolvedValue(response);
  mount();
  await vi.advanceTimersByTimeAsync(0);
  expect(state.snapshots.at(-1)).toMatchObject({ userIds: ["ana"] });
  await vi.advanceTimersByTimeAsync(5000);
  expect(state.snapshots.at(-1)).toBeUndefined();
  dispose?.();
  dispose = undefined;
  const calls = data.readSync.mock.calls.length;
  await vi.advanceTimersByTimeAsync(60000);
  expect(data.readSync).toHaveBeenCalledTimes(calls);
});
test("disabled surface does not poll or publish", () => {
  const hook = mount(false);
  hook.change(true);
  expect(data.readSync).not.toHaveBeenCalled();
  expect(data.setTyping).not.toHaveBeenCalled();
});

const healthy = {
  status: "ready" as const,
  cursor: "next",
  userIds: [],
  presence: [],
  expiresAt: 0,
  timelineChanged: false,
  reactionsChanged: false,
  changes: null,
  reset: false,
};

test("native presence deltas survive idle sync, disappear on offline and expire on lost sync", async () => {
  data.readSync
    .mockResolvedValueOnce({
      ...healthy,
      presence: [{ id: "ana", state: "online" }],
      expiresAt: 130000,
    })
    .mockResolvedValueOnce({ ...healthy, expiresAt: 132000 })
    .mockResolvedValueOnce({
      ...healthy,
      presence: [{ id: "ana", state: "offline" }],
      expiresAt: 134000,
    })
    .mockResolvedValueOnce({
      ...healthy,
      presence: [{ id: "ana", state: "online" }],
      expiresAt: 110000,
    });
  mount();
  await vi.advanceTimersByTimeAsync(2000);
  expect(state.snapshots.at(-1)).toMatchObject({
    presence: [{ id: "ana", state: "online" }],
  });
  await vi.advanceTimersByTimeAsync(2000);
  expect(state.snapshots.at(-1)).toBeUndefined();
  await vi.advanceTimersByTimeAsync(2000);
  expect(state.snapshots.at(-1)).toMatchObject({
    presence: [{ id: "ana", state: "online" }],
  });
  await vi.advanceTimersByTimeAsync(5000);
  expect(state.snapshots.at(-1)).toBeUndefined();
});

function observeHistory(kind: string) {
  const read = vi.fn<
    (input: { pageParam: number }) => Promise<{ next: number; text: string }>
  >(async ({ pageParam }) => ({
    next: pageParam + 1,
    text: `page-${pageParam}`,
  }));
  const observer = new InfiniteQueryObserver(client, {
    queryKey: [kind, "account:workspace", "room"],
    queryFn: read,
    initialPageParam: 0,
    getNextPageParam: (page) => page.next,
    staleTime: Infinity,
    initialData: {
      pages: [
        { next: 1, text: "old-0" },
        { next: 2, text: "old-1" },
      ],
      pageParams: [0, 1],
    },
  });
  unsubscribe.push(
    observer.subscribe(() => {
      // An active observer gives the real QueryClient ownership of this synthetic history.
    })
  );
  return { read, observer };
}

test("idle and typing-only sync never refetch loaded history", async () => {
  const room = observeHistory("matrix-messages");
  const thread = observeHistory("matrix-thread");
  data.readSync.mockResolvedValue({
    ...healthy,
    userIds: ["ana"],
    presence: [],
    expiresAt: 130000,
  });
  mount();
  await vi.advanceTimersByTimeAsync(10000);
  expect(data.readSync.mock.calls.length).toBeGreaterThan(1);
  expect(room.read).not.toHaveBeenCalled();
  expect(thread.read).not.toHaveBeenCalled();
  expect(room.observer.getCurrentResult().data?.pages).toHaveLength(2);
});

test.each(["timelineChanged", "reset"] as const)(
  "%s reconciles room and thread before advancing the native cursor",
  async (flag) => {
    const room = observeHistory("matrix-messages");
    const thread = observeHistory("matrix-thread");
    const reactions = observeReactions();
    data.readSync
      .mockResolvedValueOnce({ ...healthy, [flag]: true })
      .mockResolvedValue(healthy);
    mount();
    await vi.advanceTimersByTimeAsync(0);
    expect(room.read.mock.calls.map(([input]) => input.pageParam)).toEqual([
      0, 1,
    ]);
    expect(thread.read.mock.calls.map(([input]) => input.pageParam)).toEqual([
      0, 1,
    ]);
    expect(
      room.observer.getCurrentResult().data?.pages.map((p) => p.text)
    ).toEqual(["page-0", "page-1"]);
    expect(reactions.read).toHaveBeenCalledTimes(flag === "reset" ? 1 : 0);
    await vi.advanceTimersByTimeAsync(2000);
    expect(data.readSync.mock.calls[1]?.[0].cursor).toBe("next");
  }
);

test("a change arriving during pagination is replayed without cancelling the prepend", async () => {
  const room = observeHistory("matrix-messages");
  let complete: ((page: { next: number; text: string }) => void) | undefined;
  room.read.mockImplementationOnce(
    () =>
      new Promise((resolve) => {
        complete = resolve;
      })
  );
  const page = room.observer.fetchNextPage();
  data.readSync.mockResolvedValue({ ...healthy, timelineChanged: true });
  mount();
  await vi.advanceTimersByTimeAsync(0);
  expect(room.read).toHaveBeenCalledTimes(1);
  expect(data.readSync.mock.calls[0]?.[0].cursor).toBeUndefined();
  complete?.({ next: 3, text: "loaded-2" });
  await page;
  await vi.advanceTimersByTimeAsync(2000);
  expect(data.readSync.mock.calls[1]?.[0].cursor).toBeUndefined();
  expect(room.read.mock.calls.map(([input]) => input.pageParam)).toEqual([
    2, 0, 1, 2,
  ]);
  expect(room.observer.getCurrentResult().data?.pages).toHaveLength(3);
  data.readSync.mockResolvedValue(healthy);
  await vi.advanceTimersByTimeAsync(2000);
  expect(data.readSync.mock.calls[2]?.[0].cursor).toBe("next");
});

test("a late change after background does not refetch or advance history", async () => {
  const room = observeHistory("matrix-messages");
  const reactions = observeReactions();
  let complete:
    | ((page: Awaited<ReturnType<RoomData["readSync"]>>) => void)
    | undefined;
  data.readSync.mockImplementationOnce(
    () =>
      new Promise((resolve) => {
        complete = resolve;
      })
  );
  mount();
  state.active = "background";
  for (const listener of state.listeners) listener("background");
  complete?.({ ...healthy, timelineChanged: true, reactionsChanged: true });
  await vi.advanceTimersByTimeAsync(0);
  expect(room.read).not.toHaveBeenCalled();
  expect(reactions.read).not.toHaveBeenCalled();
  expect(data.readSync.mock.calls[0]?.[1].aborted).toBe(true);
});

test("sync authorization failure revalidates history and does not leave stale content presented as current", async () => {
  const room = observeHistory("matrix-messages");
  const thread = observeHistory("matrix-thread");
  const reactions = observeReactions();
  room.read.mockRejectedValue(new Error("Revoked room"));
  thread.read.mockRejectedValue(new Error("Revoked thread"));
  reactions.read.mockRejectedValue(new Error("Revoked reactions"));
  data.readSync.mockRejectedValue(new Error("Revoked membership"));
  mount();
  await vi.advanceTimersByTimeAsync(0);
  expect(room.observer.getCurrentResult().isError).toBe(true);
  expect(thread.observer.getCurrentResult().isError).toBe(true);
  expect(reactions.observer.getCurrentResult().isError).toBe(true);
});

function observeReactions(scope = "account:workspace") {
  const read = vi.fn<() => Promise<number>>(async () => 1);
  const observer = new QueryObserver(client, {
    queryKey: ["matrix-reactions", scope, "room", ["$message"]],
    queryFn: read,
    initialData: 0,
    staleTime: Infinity,
  });
  unsubscribe.push(
    observer.subscribe(() => {
      // Keep the real query active without mounting a second sync observer.
    })
  );
  return { read, observer };
}

test("reaction signals refresh active reactions without history reads or cross-account work", async () => {
  const room = observeHistory("matrix-messages");
  const thread = observeHistory("matrix-thread");
  const reactions = observeReactions();
  const otherAccount = observeReactions("other:workspace");
  const inactive = ["matrix-reactions", "account:workspace", "room", ["$old"]];
  client.setQueryData(inactive, 0);
  data.readSync.mockResolvedValue(healthy);
  mount();
  await vi.advanceTimersByTimeAsync(60000);
  expect(reactions.read).not.toHaveBeenCalled();
  data.readSync.mockResolvedValueOnce({ ...healthy, reactionsChanged: true });
  await vi.advanceTimersByTimeAsync(2000);
  expect(reactions.read).toHaveBeenCalledTimes(1);
  expect(reactions.observer.getCurrentResult().data).toBe(1);
  expect(client.getQueryState(inactive)?.isInvalidated).toBe(true);
  expect(otherAccount.read).not.toHaveBeenCalled();
  expect(room.read).not.toHaveBeenCalled();
  expect(thread.read).not.toHaveBeenCalled();
});

test("an in-flight reaction read cannot consume a newer native change", async () => {
  const reactions = observeReactions();
  data.readSync.mockResolvedValueOnce(healthy).mockResolvedValue({
    ...healthy,
    reactionsChanged: true,
    cursor: "changed",
  });
  mount();
  await vi.advanceTimersByTimeAsync(0);
  let complete: ((value: number) => void) | undefined;
  reactions.read.mockImplementationOnce(
    () =>
      new Promise((resolve) => {
        complete = resolve;
      })
  );
  const pending = reactions.observer.refetch();
  await vi.advanceTimersByTimeAsync(2000);
  expect(reactions.read).toHaveBeenCalledTimes(1);
  complete?.(41);
  await pending;
  await vi.advanceTimersByTimeAsync(2000);
  expect(data.readSync.mock.calls[2]?.[0].cursor).toBe("next");
  expect(reactions.read).toHaveBeenCalledTimes(2);
  expect(reactions.observer.getCurrentResult().data).toBe(1);
  data.readSync.mockResolvedValue(healthy);
  await vi.advanceTimersByTimeAsync(2000);
  expect(data.readSync.mock.calls[3]?.[0].cursor).toBe("changed");
});

function message(id: string, text = id, rootId: string | null = null) {
  return {
    id,
    text,
    rootId,
    sender: "Ana",
    senderId: "@ana:test",
    mine: false,
    bot: false,
    timestamp: 1,
    replies: 0,
    reply: null,
  };
}
function observeMessages(kind: string, rootId?: string) {
  const page: Parameters<typeof applyRoomChanges>[0]["pages"][number] = {
    room: {
      id: "room",
      roomId: "!room:test",
      label: "Room",
      epoch: "epoch",
      kind: "group",
    },
    members: [],
    membersTruncated: false,
    nextCursor: "older",
    messages: [message("$recent", "$recent", rootId ?? null)],
    ...(rootId ? { parent: message(rootId) } : {}),
  };
  const read = vi.fn<() => Promise<typeof page>>(async () => page);
  const observer = new InfiniteQueryObserver(client, {
    queryKey: [kind, "account:workspace", "room", ...(rootId ? [rootId] : [])],
    initialPageParam: undefined as string | undefined,
    queryFn: read,
    getNextPageParam: (result) => result.nextCursor,
    staleTime: Infinity,
    initialData: {
      pages: [
        page,
        {
          ...page,
          nextCursor: null,
          messages: [message("$old", "$old", rootId ?? null)],
        },
      ],
      pageParams: [undefined, "older"],
    },
  });
  unsubscribe.push(
    observer.subscribe(() => {
      // Keep an actual active observer for cache updates and recovery.
    })
  );
  return { observer, read };
}

test("native additions and old edits update real infinite caches without reading historical pages", async () => {
  const room = observeMessages("matrix-messages");
  const thread = observeMessages("matrix-thread", "$root");
  data.readSync.mockResolvedValue({
    ...healthy,
    timelineChanged: true,
    changes: {
      added: [message("$new"), message("$reply", "New reply", "$root")],
      updated: [
        message("$old", "Edited old message"),
        { ...message("$root"), replies: 1 },
      ],
    },
  });
  mount();
  await vi.advanceTimersByTimeAsync(4000);
  expect(room.read).not.toHaveBeenCalled();
  expect(thread.read).not.toHaveBeenCalled();
  expect(
    room.observer
      .getCurrentResult()
      .data?.pages.map((page) => page.messages.map((item) => item.id))
  ).toEqual([["$recent", "$new", "$reply"], ["$old"]]);
  expect(
    room.observer.getCurrentResult().data?.pages[1]?.messages[0]?.text
  ).toBe("Edited old message");
  expect(
    thread.observer
      .getCurrentResult()
      .data?.pages[0]?.messages.map((item) => item.id)
  ).toEqual(["$recent", "$reply"]);
  expect(
    thread.observer.getCurrentResult().data?.pages[0]?.parent?.replies
  ).toBe(1);
  expect(data.readSync.mock.calls[1]?.[0].cursor).toBe("next");
});

test("a late batch cannot overwrite a local edit and is replayed against its new baseline", async () => {
  const room = observeMessages("matrix-messages");
  let complete:
    | ((result: Awaited<ReturnType<RoomData["readSync"]>>) => void)
    | undefined;
  data.readSync.mockImplementationOnce(
    () =>
      new Promise((resolve) => {
        complete = resolve;
      })
  );
  mount();
  const key = ["matrix-messages", "account:workspace", "room"];
  client.setQueryData<Parameters<typeof applyRoomChanges>[0]>(
    key,
    (current) =>
      current && {
        ...current,
        pages: current.pages.map((page) => ({
          ...page,
          messages: page.messages.map((item) =>
            item.id === "$recent"
              ? { ...item, text: "Local edit", editId: "$edit" }
              : item
          ),
        })),
      }
  );
  complete?.({
    ...healthy,
    timelineChanged: true,
    changes: { added: [], updated: [message("$recent", "Stale text")] },
  });
  await vi.advanceTimersByTimeAsync(0);
  expect(
    room.observer.getCurrentResult().data?.pages[0]?.messages[0]?.text
  ).toBe("Local edit");
  data.readSync.mockResolvedValue(healthy);
  await vi.advanceTimersByTimeAsync(2000);
  expect(data.readSync.mock.calls[1]?.[0].cursor).toBeUndefined();
  expect(room.read).not.toHaveBeenCalled();
});

test("inactive threads stay stale instead of becoming fresh from an incomplete baseline", async () => {
  const room = observeMessages("matrix-messages");
  const key = ["matrix-thread", "account:workspace", "room", "$hidden"];
  const first = room.observer.getCurrentResult().data?.pages[0];
  expect(first).toBeDefined();
  const previous = {
    pages: [
      {
        ...first,
        parent: message("$hidden"),
      },
    ],
    pageParams: [undefined],
  };
  client.setQueryData(key, previous);
  data.readSync.mockResolvedValue({
    ...healthy,
    timelineChanged: true,
    changes: { added: [message("$new")], updated: [] },
  });
  mount();
  await vi.advanceTimersByTimeAsync(0);
  expect(client.getQueryData(key)).toEqual(previous);
  expect(client.getQueryState(key)?.isInvalidated).toBe(true);
  expect(room.read).not.toHaveBeenCalled();
});

test("a bounded live head falls back to sequential history recovery before acknowledging", async () => {
  const room = observeMessages("matrix-messages");
  client.setQueryData<Parameters<typeof applyRoomChanges>[0]>(
    ["matrix-messages", "account:workspace", "room"],
    (current) =>
      current && {
        ...current,
        pages: current.pages.map((page, index) =>
          index === 0
            ? {
                ...page,
                messages: Array.from({ length: 200 }, (_, n) =>
                  message(`$${n}`)
                ),
              }
            : page
        ),
      }
  );
  data.readSync
    .mockResolvedValueOnce({
      ...healthy,
      timelineChanged: true,
      changes: { added: [message("$overflow")], updated: [] },
    })
    .mockResolvedValue(healthy);
  mount();
  await vi.advanceTimersByTimeAsync(0);
  expect(room.read).toHaveBeenCalledTimes(2);
  await vi.advanceTimersByTimeAsync(2000);
  expect(data.readSync.mock.calls[1]?.[0].cursor).toBe("next");
});

test("a native tombstone patches loaded history and refreshes reactions without page reads", async () => {
  const room = observeMessages("matrix-messages");
  const reactions = observeReactions();
  data.readSync
    .mockResolvedValueOnce({
      ...healthy,
      timelineChanged: true,
      reactionsChanged: true,
      changes: {
        added: [],
        updated: [{ ...message("$old", "Mensagem removida"), redacted: true }],
      },
    })
    .mockResolvedValue(healthy);
  mount();
  await vi.advanceTimersByTimeAsync(0);
  expect(room.read).not.toHaveBeenCalled();
  expect(reactions.read).toHaveBeenCalledTimes(1);
  expect(
    room.observer.getCurrentResult().data?.pages[1]?.messages[0]
  ).toMatchObject({ id: "$old", redacted: true, text: "Mensagem removida" });
  expect(room.observer.getCurrentResult().data?.pageParams).toEqual([
    undefined,
    "older",
  ]);
  await vi.advanceTimersByTimeAsync(2000);
  expect(data.readSync.mock.calls[1]?.[0].cursor).toBe("next");
});

test("recovers automatically after both sync and history fail without a remount", async () => {
  const room = observeMessages("matrix-messages");
  room.read.mockRejectedValueOnce(new Error("Synthetic unavailable history"));
  data.readSync
    .mockRejectedValueOnce(new Error("Synthetic unavailable sync"))
    .mockResolvedValue({ ...healthy, reset: true });
  mount();
  await vi.advanceTimersByTimeAsync(0);
  expect(room.observer.getCurrentResult().isError).toBe(true);
  await vi.advanceTimersByTimeAsync(4000);
  expect(data.readSync.mock.calls[1]?.[0].cursor).toBeUndefined();
  expect(room.observer.getCurrentResult().isError).toBe(false);
  expect(
    room.observer.getCurrentResult().data?.pages[0]?.messages[0]?.text
  ).toBe("$recent");
});

test("revoked access stops polling and refreshes the authorized inbox", async () => {
  const inbox = new QueryObserver(client, {
    queryKey: ["conversation-inbox", "account:workspace"],
    queryFn: async () => [],
    staleTime: Infinity,
    initialData: ["room"],
  });
  unsubscribe.push(inbox.subscribe(vi.fn<() => void>()));
  data.readSync.mockResolvedValue({
    status: "denied",
    cursor: null,
    userIds: [],
    presence: [],
    expiresAt: 0,
    timelineChanged: false,
    reactionsChanged: false,
    changes: null,
    reset: false,
  });
  mount();
  await vi.advanceTimersByTimeAsync(60000);
  expect(data.readSync).toHaveBeenCalledTimes(1);
  expect(inbox.getCurrentResult().data).toEqual([]);
  expect(state.snapshots).toContain(
    JSON.stringify(["account:workspace", "room", true])
  );
});
