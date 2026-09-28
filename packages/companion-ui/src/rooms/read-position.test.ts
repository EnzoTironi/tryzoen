import { afterEach, beforeEach, expect, test, vi } from "vitest";
import { useRoomReadPosition } from "./read-position";
import type { RoomData, roomMessageSchema } from "./schema";
import type { z } from "zod";

const lifecycle = vi.hoisted(() => ({
  active: "active",
  effects: [] as (() => void | (() => void))[],
  refs: [] as { current: unknown }[],
  index: 0,
  listeners: new Set<(state: string) => void>(),
}));
vi.mock("react", () => ({
  useRef: (value: unknown) => {
    const index = lifecycle.index++;
    return (
      lifecycle.refs[index] ?? (lifecycle.refs[index] = { current: value })
    );
  },
  useEffect: (effect: () => void | (() => void)) => {
    lifecycle.effects.push(effect);
  },
  useCallback: (callback: unknown) => callback,
}));
vi.mock("react-native", () => ({
  AppState: {
    get currentState() {
      return lifecycle.active;
    },
    addEventListener: (_event: string, callback: (state: string) => void) => {
      lifecycle.listeners.add(callback);
      return { remove: () => lifecycle.listeners.delete(callback) };
    },
  },
}));
const markRead = vi.fn<RoomData["markRead"]>();
// The hook owns only this existing transport operation.
const data = { markRead };
const messages = ["old", "visible", "fetched"].map((id, timestamp) => ({
  id,
  timestamp,
  text: id,
  sender: "Ana",
  senderId: "ana",
  mine: false,
  bot: false,
  rootId: null,
  replies: 0,
  reply: null,
}));
let cleanup: (() => void)[] = [];
function ReadPositionHarness(
  scope = "owner",
  enabled = true,
  timeline: z.infer<typeof roomMessageSchema>[] = messages,
  rootId?: string
) {
  for (const dispose of cleanup) dispose();
  cleanup = [];
  lifecycle.effects = [];
  lifecycle.index = 0;
  const visible = useRoomReadPosition(
    data,
    scope,
    "room",
    timeline,
    enabled,
    rootId
  );
  cleanup = lifecycle.effects
    .map((effect) => effect())
    .filter((effect): effect is () => void => typeof effect === "function");
  return visible;
}
function appState(value: string) {
  lifecycle.active = value;
  for (const listener of lifecycle.listeners) listener(value);
}
beforeEach(() => {
  vi.useFakeTimers();
  markRead.mockReset().mockResolvedValue(undefined);
  lifecycle.active = "active";
  lifecycle.refs = [];
});
afterEach(() => {
  for (const dispose of cleanup) dispose();
  cleanup = [];
  vi.useRealTimers();
});
test("marks only the newest actually visible event after dwell, never the fetched edge", async () => {
  const visible = ReadPositionHarness();
  await vi.advanceTimersByTimeAsync(1000);
  expect(markRead).not.toHaveBeenCalled();
  visible(["old", "visible"]);
  await vi.advanceTimersByTimeAsync(749);
  expect(markRead).not.toHaveBeenCalled();
  await vi.advanceTimersByTimeAsync(1);
  expect(markRead).toHaveBeenCalledExactlyOnceWith({
    id: "room",
    messageId: "visible",
  });
  visible(["visible"]);
  await vi.advanceTimersByTimeAsync(1000);
  expect(markRead).toHaveBeenCalledTimes(1);
});
test("backgrounding cancels a pending receipt and returning starts a fresh dwell", async () => {
  const visible = ReadPositionHarness();
  visible(["visible"]);
  await vi.advanceTimersByTimeAsync(500);
  appState("background");
  await vi.advanceTimersByTimeAsync(2000);
  expect(markRead).not.toHaveBeenCalled();
  appState("active");
  await vi.advanceTimersByTimeAsync(749);
  expect(markRead).not.toHaveBeenCalled();
  await vi.advanceTimersByTimeAsync(1);
  expect(markRead).toHaveBeenCalledTimes(1);
});
test("account change, hidden surface and unmount cancel pending visibility", async () => {
  ReadPositionHarness()(["visible"]);
  ReadPositionHarness("another-owner");
  await vi.advanceTimersByTimeAsync(1000);
  expect(markRead).not.toHaveBeenCalled();
  ReadPositionHarness("another-owner", false)(["visible"]);
  await vi.advanceTimersByTimeAsync(1000);
  expect(markRead).not.toHaveBeenCalled();
  ReadPositionHarness()(["visible"]);
  for (const dispose of cleanup) dispose();
  await vi.advanceTimersByTimeAsync(1000);
  expect(markRead).not.toHaveBeenCalled();
});
test("thread receipts exclude the root and failed receipts can retry on later visibility", async () => {
  const replies = messages.map((message) =>
    Object.assign({}, message, {
      rootId: message.id === "old" ? null : "old",
    })
  );
  const visible = ReadPositionHarness("owner", true, replies, "old");
  visible(["old"]);
  await vi.advanceTimersByTimeAsync(1000);
  expect(markRead).not.toHaveBeenCalled();
  markRead.mockRejectedValueOnce(new Error("Network unavailable"));
  visible(["visible"]);
  await vi.advanceTimersByTimeAsync(1000);
  visible(["visible"]);
  await vi.advanceTimersByTimeAsync(1000);
  expect(markRead).toHaveBeenCalledTimes(2);
  expect(markRead).toHaveBeenLastCalledWith({
    id: "room",
    messageId: "visible",
    rootId: "old",
  });
});

test("returning from a covering modal restarts dwell for the same actually visible events", async () => {
  ReadPositionHarness()(["visible"]);
  await vi.advanceTimersByTimeAsync(500);
  ReadPositionHarness("owner", false);
  await vi.advanceTimersByTimeAsync(1000);
  expect(markRead).not.toHaveBeenCalled();
  ReadPositionHarness("owner", true);
  await vi.advanceTimersByTimeAsync(749);
  expect(markRead).not.toHaveBeenCalled();
  await vi.advanceTimersByTimeAsync(1);
  expect(markRead).toHaveBeenCalledExactlyOnceWith({
    id: "room",
    messageId: "visible",
  });
});
