import { beforeEach, afterEach, expect, test, vi } from "vitest";
import { useRoomSync } from "./sync";
import type { RoomData } from "./schema";
import { InfiniteQueryObserver, QueryClient } from "@tanstack/react-query";
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
    expiresAt: 105000,
    timelineChanged: false,
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
  expiresAt: 0,
  timelineChanged: false,
  reset: false,
};

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
  complete?.({ ...healthy, timelineChanged: true });
  await vi.advanceTimersByTimeAsync(0);
  expect(room.read).not.toHaveBeenCalled();
  expect(data.readSync.mock.calls[0]?.[1].aborted).toBe(true);
});

test("sync authorization failure revalidates history and does not leave stale content presented as current", async () => {
  const room = observeHistory("matrix-messages");
  const thread = observeHistory("matrix-thread");
  room.read.mockRejectedValue(new Error("Revoked room"));
  thread.read.mockRejectedValue(new Error("Revoked thread"));
  data.readSync.mockRejectedValue(new Error("Revoked membership"));
  mount();
  await vi.advanceTimersByTimeAsync(0);
  expect(room.observer.getCurrentResult().isError).toBe(true);
  expect(thread.observer.getCurrentResult().isError).toBe(true);
});
