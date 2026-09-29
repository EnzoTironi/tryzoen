import { afterEach, expect, test, vi } from "vitest";
import { QueryClient, onlineManager } from "@tanstack/react-query";
import { useInboxSync } from "./sync";
import type { InboxData } from "./inbox-schema";

const lifecycle = vi.hoisted(() => ({
  effects: [] as (() => void | (() => void))[],
  listeners: new Set<(value: string) => void>(),
  active: "active",
  visible: true,
  writes: [] as unknown[],
}));
vi.mock("react", async (original) => ({
  ...(await original<typeof import("react")>()),
  useContext: () => lifecycle.visible,
  useEffect: (effect: () => void | (() => void)) =>
    lifecycle.effects.push(effect),
  useRef: (current: unknown) => ({ current }),
  useState: (value: unknown) => [
    value,
    (next: unknown) => lifecycle.writes.push(next),
  ],
}));
const client = new QueryClient();
vi.mock("@tanstack/react-query", async (original) => ({
  ...(await original<typeof import("@tanstack/react-query")>()),
  useQueryClient: () => client,
  useQuery: ({ queryKey }: { queryKey: readonly unknown[] }) => ({
    data: client.getQueryData(queryKey),
  }),
}));
vi.mock("react-native", () => ({
  AppState: {
    get currentState() {
      return lifecycle.active;
    },
    addEventListener: (_name: string, listener: (value: string) => void) => {
      lifecycle.listeners.add(listener);
      return { remove: () => lifecycle.listeners.delete(listener) };
    },
  },
}));
const reply = {
  status: "ready" as const,
  notifications: null,
  cursor: "next",
  inboxChanged: true,
  changedRoomIds: [],
  gapRoomIds: [],
  reset: false,
};
let cleanup: (() => void)[] = [];
function SyncHarness(
  sync: InboxData["sync"],
  nearHead = true,
  enabled = true,
  scope = "owner"
) {
  lifecycle.effects = [];
  const hook = useInboxSync(
    { sync, list: vi.fn<InboxData["list"]>() },
    scope,
    { query: "", filter: "all", archived: false },
    enabled,
    nearHead
  );
  cleanup = lifecycle.effects
    .map((effect) => effect())
    .filter((effect): effect is () => void => typeof effect === "function");
  return hook;
}
function state(value: string) {
  lifecycle.active = value;
  for (const listener of lifecycle.listeners) listener(value);
}
function unmount() {
  for (const dispose of cleanup) dispose();
  cleanup = [];
}
afterEach(() => {
  unmount();
  client.clear();
  lifecycle.active = "active";
  lifecycle.visible = true;
  lifecycle.writes = [];
  vi.restoreAllMocks();
  vi.useRealTimers();
});
test("keeps notification snapshots scoped and retains the cache while backgrounded", async () => {
  const notifications = [
    {
      id: "room",
      notificationCount: 2,
      highlightCount: 1,
      markedUnread: false,
    },
  ];
  const key = ["matrix-inbox-notifications", "owner", "", "all", false];
  const sync = vi
    .fn<InboxData["sync"]>()
    .mockResolvedValue({ ...reply, inboxChanged: false, notifications });
  SyncHarness(sync);
  await vi.waitFor(() => {
    expect(client.getQueryData(key)).toEqual(notifications);
  });
  state("background");
  expect(client.getQueryData(key)).toEqual(notifications);
  expect(
    client.getQueryData([
      "matrix-inbox-notifications",
      "other",
      "",
      "all",
      false,
    ])
  ).toBeUndefined();
  sync.mockResolvedValue({
    ...reply,
    status: "unavailable",
    notifications: null,
  });
  state("active");
  await vi.waitFor(() => {
    expect(
      lifecycle.writes.some(
        (value) => typeof value === "string" && value.includes("owner")
      )
    ).toBe(true);
  });
  expect(client.getQueryData(key)).toEqual(notifications);
});

test("a late poll preserves a locally marked unread room while applying other counters", async () => {
  const key = ["matrix-inbox-notifications", "owner", "", "all", false];
  client.setQueryData(key, [
    {
      id: "room",
      notificationCount: 0,
      highlightCount: 0,
      markedUnread: false,
    },
  ]);
  let resolve!: (value: Awaited<ReturnType<InboxData["sync"]>>) => void;
  const sync = vi.fn<InboxData["sync"]>().mockImplementation(
    () =>
      new Promise((done) => {
        resolve = done;
      })
  );
  SyncHarness(sync);
  client.setQueryData(key, [
    { id: "room", notificationCount: 0, highlightCount: 0, markedUnread: true },
  ]);
  resolve({
    ...reply,
    inboxChanged: false,
    notifications: [
      {
        id: "room",
        notificationCount: 3,
        highlightCount: 1,
        markedUnread: false,
      },
      {
        id: "other",
        notificationCount: 4,
        highlightCount: 0,
        markedUnread: false,
      },
    ],
  });
  await vi.waitFor(() => {
    expect(client.getQueryData(key)).toEqual([
      {
        id: "room",
        notificationCount: 3,
        highlightCount: 1,
        markedUnread: true,
      },
      {
        id: "other",
        notificationCount: 4,
        highlightCount: 0,
        markedUnread: false,
      },
    ]);
  });
});

test("marks sibling queries stale but resets only the current head; scroll defers reset", async () => {
  const active = ["conversation-inbox", "owner", false, "", "all"];
  const sibling = ["conversation-inbox", "owner", false, "Ana", "people"];
  const other = ["conversation-inbox", "other", false, "", "all"];
  for (const key of [active, sibling, other])
    client.setQueryData(key, { pages: [1, 2], pageParams: [null, "older"] });
  const reset = vi.spyOn(client, "refetchQueries");
  const hook = SyncHarness(
    vi.fn<InboxData["sync"]>().mockResolvedValue(reply),
    false
  );
  await vi.waitFor(() => {
    expect(client.getQueryState(active)?.isInvalidated).toBe(true);
  });
  expect(reset).not.toHaveBeenCalled();
  expect(client.getQueryState(sibling)?.isInvalidated).toBe(true);
  expect(client.getQueryState(other)?.isInvalidated).toBe(false);
  hook.apply();
  await vi.waitFor(() => {
    expect(reset).toHaveBeenCalledExactlyOnceWith(
      { queryKey: active, exact: true, type: "active" },
      { throwOnError: true }
    );
  });
  expect(client.getQueryData(active)).toEqual({
    pages: [1],
    pageParams: [null],
  });
  expect(client.getQueryData(sibling)).toEqual({
    pages: [1, 2],
    pageParams: [null, "older"],
  });
});

test("background and disposal abort actual transport and discard late results", async () => {
  vi.useFakeTimers();
  let resolve!: (value: typeof reply) => void;
  const sync = vi.fn<InboxData["sync"]>().mockImplementation(
    () =>
      new Promise((done) => {
        resolve = done;
      })
  );
  const reset = vi.spyOn(client, "refetchQueries");
  SyncHarness(sync);
  const signal = sync.mock.calls[0][1];
  state("background");
  expect(signal.aborted).toBe(true);
  resolve(reply);
  await vi.advanceTimersByTimeAsync(60_000);
  expect(sync).toHaveBeenCalledTimes(1);
  expect(reset).not.toHaveBeenCalled();
  state("active");
  expect(sync).toHaveBeenCalledTimes(2);
  unmount();
  expect(sync.mock.calls[1][1].aborted).toBe(true);
  resolve(reply);
  await vi.advanceTimersByTimeAsync(60_000);
  expect(reset).not.toHaveBeenCalled();
});

test("failure backs off without clearing data and disabled inbox never polls", async () => {
  vi.useFakeTimers();
  const key = ["conversation-inbox", "owner", false, "", "all"];
  client.setQueryData(key, { pages: ["kept"] });
  const sync = vi
    .fn<InboxData["sync"]>()
    .mockRejectedValue(new Error("offline"));
  SyncHarness(sync);
  await vi.advanceTimersByTimeAsync(19_999);
  expect(sync).toHaveBeenCalledTimes(1);
  expect(client.getQueryData(key)).toEqual({ pages: ["kept"] });
  await vi.advanceTimersByTimeAsync(1);
  expect(sync).toHaveBeenCalledTimes(2);
  unmount();
  SyncHarness(sync, true, false, "other");
  await vi.advanceTimersByTimeAsync(120_000);
  expect(sync).toHaveBeenCalledTimes(2);
});

test("failed head refresh keeps cursor and retries the dirty head before advancing", async () => {
  vi.useFakeTimers();
  const sync = vi.fn<InboxData["sync"]>().mockResolvedValue(reply);
  const refetch = vi
    .spyOn(client, "refetchQueries")
    .mockRejectedValueOnce(new Error("head offline"))
    .mockResolvedValue(undefined);
  SyncHarness(sync);
  await vi.advanceTimersByTimeAsync(20_000);
  expect(sync).toHaveBeenCalledTimes(2);
  expect(sync.mock.calls[1][0].cursor).toBeUndefined();
  expect(refetch).toHaveBeenCalledTimes(2);
  await vi.advanceTimersByTimeAsync(10_000);
  expect(sync.mock.calls[2][0].cursor).toBe("next");
});

test("disabled metadata sync refreshes cached head on mount and foreground without polling history", async () => {
  vi.useFakeTimers();
  const key = ["conversation-inbox", "owner", false, "", "all"];
  client.setQueryData(key, {
    pages: [1, 2, 3],
    pageParams: [null, "two", "three"],
  });
  const sync = vi.fn<InboxData["sync"]>();
  const refetch = vi.spyOn(client, "refetchQueries");
  SyncHarness(sync, true, false);
  await vi.advanceTimersByTimeAsync(0);
  expect(client.getQueryData(key)).toEqual({ pages: [1], pageParams: [null] });
  expect(refetch).toHaveBeenCalledTimes(1);
  await vi.advanceTimersByTimeAsync(60_000);
  expect(refetch).toHaveBeenCalledTimes(1);
  state("background");
  state("active");
  await vi.advanceTimersByTimeAsync(0);
  expect(refetch).toHaveBeenCalledTimes(2);
  expect(sync).not.toHaveBeenCalled();
});

test("a global panel cancels sync and prevents focus or network events from restarting it", async () => {
  vi.useFakeTimers();
  let finish!: (result: Awaited<ReturnType<InboxData["sync"]>>) => void;
  let signal: AbortSignal | undefined;
  const sync = vi
    .fn<InboxData["sync"]>()
    .mockImplementationOnce((_input, incoming) => {
      signal = incoming;
      return new Promise((resolve) => {
        finish = resolve;
      });
    })
    .mockResolvedValue({ ...reply, inboxChanged: false });
  SyncHarness(sync);
  expect(sync).toHaveBeenCalledTimes(1);
  unmount();
  lifecycle.visible = false;
  SyncHarness(sync);
  expect(signal?.aborted).toBe(true);
  lifecycle.writes = [];
  finish({
    ...reply,
    notifications: [{ id: "covered", notificationCount: 5, highlightCount: 0 }],
  });
  state("background");
  state("active");
  onlineManager.setOnline(false);
  onlineManager.setOnline(true);
  await vi.advanceTimersByTimeAsync(60_000);
  expect(sync).toHaveBeenCalledTimes(1);
  expect(lifecycle.writes).not.toContainEqual(
    expect.objectContaining({
      entries: [{ id: "covered", notificationCount: 5, highlightCount: 0 }],
    })
  );

  unmount();
  lifecycle.visible = true;
  SyncHarness(sync);
  await vi.advanceTimersByTimeAsync(0);
  expect(sync).toHaveBeenCalledTimes(2);
  expect(sync.mock.calls[1]?.[0].cursor).toBeUndefined();
});

test("a covered inbox never refreshes cached metadata when native sync is disabled", async () => {
  vi.useFakeTimers();
  lifecycle.visible = false;
  client.setQueryData(["conversation-inbox", "owner", false, "", "all"], {
    pages: [1],
    pageParams: [null],
  });
  const sync = vi.fn<InboxData["sync"]>();
  const refetch = vi.spyOn(client, "refetchQueries");
  const hook = SyncHarness(sync, true, false);
  hook.apply();
  state("active");
  await vi.advanceTimersByTimeAsync(60_000);
  expect(refetch).not.toHaveBeenCalled();
  expect(sync).not.toHaveBeenCalled();
});

test("a newer sync change arriving during manual head refresh remains pending", async () => {
  vi.useFakeTimers();
  let finish!: () => void;
  const refetch = vi
    .spyOn(client, "refetchQueries")
    .mockImplementationOnce(
      () =>
        new Promise((resolve) => {
          finish = resolve;
        })
    )
    .mockResolvedValue(undefined);
  const sync = vi.fn<InboxData["sync"]>().mockResolvedValue(reply);
  const hook = SyncHarness(sync, false);
  await vi.advanceTimersByTimeAsync(0);
  hook.apply();
  await vi.advanceTimersByTimeAsync(0);
  expect(refetch).toHaveBeenCalledTimes(1);
  await vi.advanceTimersByTimeAsync(10_000);
  expect(sync).toHaveBeenCalledTimes(2);
  finish();
  await vi.advanceTimersByTimeAsync(0);
  hook.apply();
  await vi.advanceTimersByTimeAsync(0);
  expect(refetch).toHaveBeenCalledTimes(2);
});

test("online reconnect refreshes a disabled inbox head without an AppState transition", async () => {
  vi.useFakeTimers();
  const key = ["conversation-inbox", "owner", false, "", "all"];
  client.setQueryData(key, { pages: [1, 2], pageParams: [null, "older"] });
  const sync = vi.fn<InboxData["sync"]>();
  const refetch = vi.spyOn(client, "refetchQueries");
  SyncHarness(sync, true, false);
  await vi.advanceTimersByTimeAsync(0);
  expect(refetch).toHaveBeenCalledTimes(1);
  onlineManager.setOnline(false);
  onlineManager.setOnline(true);
  await vi.advanceTimersByTimeAsync(0);
  expect(refetch).toHaveBeenCalledTimes(2);
  unmount();
  onlineManager.setOnline(false);
  onlineManager.setOnline(true);
  await vi.advanceTimersByTimeAsync(0);
  expect(refetch).toHaveBeenCalledTimes(2);
  expect(sync).not.toHaveBeenCalled();
});
