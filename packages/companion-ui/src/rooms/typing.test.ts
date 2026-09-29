import { beforeEach, afterEach, expect, test, vi } from "vitest";
import { useRoomTyping } from "./typing";
import type { RoomData } from "./schema";
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
vi.mock("@tanstack/react-query", () => ({
  onlineManager: {
    isOnline: () => state.online,
    subscribe: (callback: (online: boolean) => void) => {
      state.network.add(callback);
      return () => state.network.delete(callback);
    },
  },
}));
const data = {
  setTyping: vi.fn<RoomData["setTyping"]>(),
  readTyping: vi.fn<RoomData["readTyping"]>(),
  search: vi.fn<RoomData["search"]>(),
};
let dispose: (() => void) | undefined;
function TypingHarness({ enabled }: { enabled: boolean }) {
  return useRoomTyping(data, "account:workspace", "room", enabled);
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
  data.readTyping.mockReset().mockImplementation(
    () =>
      new Promise(() => {
        /* The synthetic request remains pending until disposal. */
      })
  );
});
afterEach(() => {
  dispose?.();
  dispose = undefined;
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
  const signal = data.readTyping.mock.calls[0]?.[1];
  state.active = "background";
  for (const listener of state.listeners) listener("background");
  await vi.advanceTimersByTimeAsync(0);
  expect(signal.aborted).toBe(true);
  expect(data.setTyping).toHaveBeenLastCalledWith({
    id: "room",
    typing: false,
  });
  await vi.advanceTimersByTimeAsync(60000);
  expect(data.readTyping).toHaveBeenCalledTimes(1);
  state.active = "active";
  for (const listener of state.listeners) listener("active");
  expect(data.readTyping).toHaveBeenCalledTimes(2);
  expect(data.setTyping).toHaveBeenCalledTimes(2);
  state.online = false;
  for (const listener of state.network) listener(false);
  await vi.advanceTimersByTimeAsync(60000);
  expect(data.readTyping).toHaveBeenCalledTimes(2);
});
test("replayed response cannot extend its expiry and disposal clears state", async () => {
  const response = {
    status: "ready" as const,
    cursor: "opaque",
    userIds: ["ana"],
    expiresAt: 105000,
  };
  data.readTyping.mockResolvedValue(response);
  mount();
  await vi.advanceTimersByTimeAsync(0);
  expect(state.snapshots.at(-1)).toMatchObject({ userIds: ["ana"] });
  await vi.advanceTimersByTimeAsync(5000);
  expect(state.snapshots.at(-1)).toBeUndefined();
  dispose?.();
  dispose = undefined;
  const calls = data.readTyping.mock.calls.length;
  await vi.advanceTimersByTimeAsync(60000);
  expect(data.readTyping).toHaveBeenCalledTimes(calls);
});
test("disabled surface does not poll or publish", () => {
  const hook = mount(false);
  hook.change(true);
  expect(data.readTyping).not.toHaveBeenCalled();
  expect(data.setTyping).not.toHaveBeenCalled();
});
