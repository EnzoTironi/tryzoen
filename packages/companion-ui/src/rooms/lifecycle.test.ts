import { QueryClient, onlineManager } from "@tanstack/react-query";
import { afterEach, beforeEach, expect, test, vi } from "vitest";
import { useRoomLifecycle } from "./lifecycle";

const state = vi.hoisted(() => ({
  effects: [] as (() => () => void)[],
  listener: undefined as ((value: string) => void) | undefined,
  foreground: "active",
  enabled: true,
  client: undefined as QueryClient | undefined,
}));
vi.mock("react", () => ({
  useState: (initial: boolean) => [
    initial,
    (value: boolean) => {
      state.enabled = value;
    },
  ],
  useEffect: (effect: () => () => void) => state.effects.push(effect),
}));
vi.mock("react-native", () => ({
  AppState: {
    get currentState() {
      return state.foreground;
    },
    addEventListener: (_event: string, listener: (value: string) => void) => {
      state.listener = listener;
      return {
        remove: () => {
          state.listener = undefined;
        },
      };
    },
  },
}));
vi.mock("@tanstack/react-query", async (original) => ({
  ...(await original<typeof import("@tanstack/react-query")>()),
  useQueryClient: () => state.client,
}));

let client: QueryClient;
let dispose: (() => void) | undefined;
const key = ["matrix-messages", "account:workspace", "room"];

function LifecycleHarness() {
  return useRoomLifecycle("account:workspace", "room");
}
function mount() {
  const enabled = LifecycleHarness();
  const cleanups = state.effects.map((effect) => effect());
  dispose = () => {
    for (const cleanup of cleanups) cleanup();
  };
  return enabled;
}

beforeEach(() => {
  client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  state.client = client;
  state.effects = [];
  state.foreground = "active";
  state.enabled = true;
  onlineManager.setOnline(true);
});
afterEach(() => {
  dispose?.();
  dispose = undefined;
  client.clear();
  onlineManager.setOnline(true);
});

test("background cancels room and thread reads, preserves other rooms and requires revalidation", async () => {
  client.setQueryData(key, "previous authorized page");
  const signals: AbortSignal[] = [];
  const pending = [
    key,
    ["matrix-thread", "account:workspace", "room", "$root"],
    ["matrix-reactions", "account:workspace", "room", ["$message"]],
  ].map((queryKey) =>
    client
      .query({
        queryKey,
        queryFn: ({ signal }) => {
          signals.push(signal);
          return new Promise<never>((_resolve, reject) => {
            signal.addEventListener(
              "abort",
              () => {
                reject(new Error("Query transport aborted"));
              },
              { once: true }
            );
          });
        },
      })
      .catch((error: unknown) => error)
  );
  const other = ["matrix-messages", "another-account", "room"];
  client.setQueryData(other, "unrelated");
  expect(mount()).toBe(true);
  state.listener?.("background");
  await Promise.all(pending);

  expect(state.enabled).toBe(false);
  expect(signals).toHaveLength(3);
  expect(signals.every((signal) => signal.aborted)).toBe(true);
  expect(client.getQueryState(key)?.isInvalidated).toBe(true);
  expect(client.getQueryData(key)).toBe("previous authorized page");
  expect(client.getQueryState(other)?.isInvalidated).toBe(false);
  state.listener?.("active");
  expect(state.enabled).toBe(true);
});

test("network recovery resumes only while the room is in the foreground", () => {
  client.setQueryData(key, "authorized page");
  mount();
  onlineManager.setOnline(false);
  expect(state.enabled).toBe(false);
  expect(client.getQueryState(key)?.isInvalidated).toBe(true);
  onlineManager.setOnline(true);
  expect(state.enabled).toBe(true);
  state.listener?.("inactive");
  onlineManager.setOnline(false);
  onlineManager.setOnline(true);
  expect(state.enabled).toBe(false);
  state.listener?.("active");
  expect(state.enabled).toBe(true);
});

test("starts paused in the background and removes both subscriptions on unmount", () => {
  state.foreground = "background";
  expect(mount()).toBe(false);
  dispose?.();
  dispose = undefined;
  expect(state.listener).toBeUndefined();
  state.enabled = true;
  onlineManager.setOnline(false);
  expect(state.enabled).toBe(true);
});
