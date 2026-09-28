import { afterEach, expect, test, vi } from "vitest";
import { QueryClient, onlineManager } from "@tanstack/react-query";
import { useInboxSync } from "./sync";
import type { InboxData } from "./inbox-schema";

const lifecycle = vi.hoisted(() => ({
  effects: [] as (() => void | (() => void))[],
  listeners: new Set<(value: string) => void>(),
  active: "active",
}));
vi.mock("react", () => ({
  useEffect: (effect: () => void | (() => void)) =>
    lifecycle.effects.push(effect),
  useRef: (current: unknown) => ({ current }),
  useState: (value: unknown) => [value, vi.fn<(value: unknown) => void>()],
}));
const client = new QueryClient();
vi.mock("@tanstack/react-query", async (original) => ({
  ...(await original<typeof import("@tanstack/react-query")>()),
  useQueryClient: () => client,
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
  vi.restoreAllMocks();
  vi.useRealTimers();
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
