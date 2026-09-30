import { afterEach, beforeEach, expect, test, vi } from "vitest";
import { useRoomParticipation } from "./participation";
import type { RoomData } from "./schema";

const state = vi.hoisted(() => ({
  foreground: "active",
  online: true,
  listeners: new Set<(value: string) => void>(),
  network: new Set<() => void>(),
  values: [] as unknown[],
  refs: [] as { current: unknown }[],
  callbacks: [] as (
    | { value: unknown; dependencies: readonly unknown[] }
    | undefined
  )[],
  effects: [] as (
    | {
        dependencies?: readonly unknown[];
        pending?: () => void | (() => void);
        cleanup?: () => void;
      }
    | undefined
  )[],
  valueIndex: 0,
  refIndex: 0,
  callbackIndex: 0,
  effectIndex: 0,
  dirty: false,
}));

function isUpdater(value: unknown): value is (previous: unknown) => unknown {
  return typeof value === "function";
}

vi.mock("react", () => ({
  useState: (initial?: unknown) => {
    const index = state.valueIndex++;
    if (!(index in state.values))
      state.values[index] = isUpdater(initial) ? initial(undefined) : initial;
    return [
      state.values[index],
      (next: unknown) => {
        const value = isUpdater(next) ? next(state.values[index]) : next;
        if (!Object.is(value, state.values[index])) {
          state.values[index] = value;
          state.dirty = true;
        }
      },
    ] as const;
  },
  useRef: (value: unknown) => {
    const index = state.refIndex++;
    return state.refs[index] ?? (state.refs[index] = { current: value });
  },
  useCallback: (value: unknown, dependencies: readonly unknown[]) => {
    const index = state.callbackIndex++;
    const previous = state.callbacks[index];
    if (
      !previous ||
      dependencies.some(
        (item, offset) => !Object.is(item, previous.dependencies[offset])
      )
    )
      state.callbacks[index] = { value, dependencies };
    return state.callbacks[index]?.value;
  },
  useEffect: (
    effect: () => void | (() => void),
    dependencies?: readonly unknown[]
  ) => {
    const index = state.effectIndex++;
    const previous = state.effects[index];
    if (
      !previous ||
      !dependencies ||
      dependencies.some(
        (item, offset) => !Object.is(item, previous.dependencies?.[offset])
      )
    ) {
      state.effects[index] = { ...previous, dependencies, pending: effect };
    }
  },
}));
vi.mock("react-native", () => ({
  AppState: {
    get currentState() {
      return state.foreground;
    },
    addEventListener: (_event: string, callback: (value: string) => void) => {
      state.listeners.add(callback);
      return { remove: () => state.listeners.delete(callback) };
    },
  },
}));
vi.mock("@tanstack/react-query", () => ({
  onlineManager: {
    isOnline: () => state.online,
    subscribe: (callback: () => void) => {
      state.network.add(callback);
      return () => state.network.delete(callback);
    },
  },
}));

const data = { participate: vi.fn<RoomData["participate"]>() };
const joined = (id = "room") => ({
  status: "joined" as const,
  room: {
    id,
    workspaceId: "workspace",
    roomId: "!native:example.test",
    label: "Room",
    epoch: "epoch",
    kind: "group" as const,
  },
});
const pending = (retryAfterMs = 100) => ({
  status: "pending" as const,
  id: "room",
  retryAfterMs,
});
let inputs: Parameters<typeof useRoomParticipation> = [
  data,
  "account:workspace",
  "room",
  true,
];
let current: ReturnType<typeof useRoomParticipation>;

/** Keep hook state and dependency-driven effects across synthetic renders. */
function ParticipationHarness() {
  return useRoomParticipation(...inputs);
}
function hasUpdates(): boolean {
  return state.dirty;
}
function render(next = inputs) {
  inputs = next;
  let renders = 0;
  do {
    state.dirty = false;
    state.valueIndex = 0;
    state.refIndex = 0;
    state.callbackIndex = 0;
    state.effectIndex = 0;
    current = ParticipationHarness();
    for (const effect of state.effects) {
      if (!effect?.pending) continue;
      effect.cleanup?.();
      const run = effect.pending;
      effect.pending = undefined;
      const cleanup = run();
      effect.cleanup = typeof cleanup === "function" ? cleanup : undefined;
    }
    if (++renders > 20) throw new Error("Hook did not settle after rendering.");
  } while (hasUpdates());
  return current;
}
async function settle() {
  await vi.advanceTimersByTimeAsync(0);
  return render();
}
function appState(value: string) {
  state.foreground = value;
  for (const listener of state.listeners) listener(value);
  return render();
}
function online(value: boolean) {
  state.online = value;
  for (const listener of state.network) listener();
  return render();
}
function deferred() {
  let resolve!: (value: Awaited<ReturnType<RoomData["participate"]>>) => void;
  const promise = new Promise<Awaited<ReturnType<RoomData["participate"]>>>(
    (finish) => {
      resolve = finish;
    }
  );
  return { promise, resolve };
}
function dispose() {
  for (const effect of state.effects) effect?.cleanup?.();
  state.effects = [];
}

beforeEach(() => {
  vi.useFakeTimers();
  state.foreground = "active";
  state.online = true;
  state.listeners.clear();
  state.network.clear();
  state.values = [];
  state.refs = [];
  state.callbacks = [];
  state.effects = [];
  state.dirty = false;
  inputs = [data, "account:workspace", "room", true];
  data.participate.mockReset().mockImplementation(
    () =>
      new Promise(() => {
        // The fake transport remains pending until the test cancels or disposes it.
      })
  );
});
afterEach(() => {
  dispose();
  vi.useRealTimers();
});

test("keeps event operations blocked until the exact pending room is confirmed", async () => {
  data.participate
    .mockResolvedValueOnce(pending())
    .mockResolvedValueOnce(joined());
  const guardedRead = vi.fn<() => void>();
  const read = () => {
    render().requireJoined();
    guardedRead();
  };
  expect(render().ready).toBe(false);
  expect(read).toThrow(/not confirmed/u);
  expect((await settle()).status).toBe("pending");
  expect(read).toThrow(/not confirmed/u);
  await vi.advanceTimersByTimeAsync(99);
  expect(data.participate).toHaveBeenCalledTimes(1);
  expect(guardedRead).not.toHaveBeenCalled();
  await vi.advanceTimersByTimeAsync(1);
  expect(render().status).toBe("joined");
  read();
  expect(guardedRead).toHaveBeenCalledTimes(1);
  expect(
    data.participate.mock.calls.every(
      ([input, signal]) => input.id === "room" && signal instanceof AbortSignal
    )
  ).toBe(true);
});

test.each([100, 30000])(
  "respects the bounded server retry delay of %i milliseconds",
  async (delay) => {
    data.participate
      .mockResolvedValueOnce(pending(delay))
      .mockResolvedValueOnce(joined());
    render();
    await settle();
    await vi.advanceTimersByTimeAsync(delay - 1);
    expect(data.participate).toHaveBeenCalledTimes(1);
    expect(render().ready).toBe(false);
    await vi.advanceTimersByTimeAsync(1);
    expect(render().ready).toBe(true);
    expect(data.participate).toHaveBeenCalledTimes(2);
  }
);

test.each([
  { ...pending(), retryAfterMs: 99 },
  { ...pending(), retryAfterMs: 30001 },
  { ...pending(), retryAfterMs: 100.5 },
  { ...pending(), id: "different-room" },
  { ...pending(), roomId: "!leaked:example.test" },
  joined("different-room"),
])(
  "rejects malformed or mismatched participation responses: %j",
  async (response) => {
    // The transport is deliberately corrupt; runtime validation must remain authoritative.
    data.participate.mockResolvedValueOnce(response);
    render();
    expect((await settle()).status).toBe("error");
    expect(() => {
      current.requireJoined();
    }).toThrow(/not confirmed/u);
    await vi.advanceTimersByTimeAsync(60000);
    expect(data.participate).toHaveBeenCalledTimes(1);
    expect(vi.getTimerCount()).toBe(0);
  }
);

test("hiding the room aborts pending confirmation and revealing it starts fresh", async () => {
  const first = deferred();
  const second = deferred();
  data.participate
    .mockReturnValueOnce(first.promise)
    .mockReturnValueOnce(second.promise);
  render();
  const signal = data.participate.mock.calls[0]?.[1];
  render([data, "account:workspace", "room", false]);
  expect(signal?.aborted).toBe(true);
  first.resolve(joined());
  expect((await settle()).ready).toBe(false);
  await vi.advanceTimersByTimeAsync(60000);
  expect(data.participate).toHaveBeenCalledTimes(1);
  render([data, "account:workspace", "room", true]);
  expect(data.participate).toHaveBeenCalledTimes(2);
  expect(current.ready).toBe(false);
  second.resolve(joined());
  expect((await settle()).ready).toBe(true);
});

test.each(["background", "offline"] as const)(
  "%s revokes a joined guard and requires fresh confirmation on resume",
  async (reason) => {
    const next = deferred();
    data.participate
      .mockResolvedValueOnce(joined())
      .mockReturnValueOnce(next.promise);
    render();
    const guard = (await settle()).requireJoined;
    expect(guard).not.toThrow(/not confirmed/u);
    if (reason === "background") appState("background");
    else online(false);
    expect(current.ready).toBe(false);
    expect(guard).toThrow(/not confirmed/u);
    await vi.advanceTimersByTimeAsync(60000);
    expect(data.participate).toHaveBeenCalledTimes(1);
    if (reason === "background") appState("active");
    else online(true);
    expect(data.participate).toHaveBeenCalledTimes(2);
    expect(current.ready).toBe(false);
    expect(guard).toThrow(/not confirmed/u);
    next.resolve(joined());
    expect((await settle()).ready).toBe(true);
  }
);

test.each(["account", "room"] as const)(
  "ignores a late callback belonging to the old %s",
  async (reason) => {
    const first = deferred();
    const second = deferred();
    data.participate
      .mockReturnValueOnce(first.promise)
      .mockReturnValueOnce(second.promise);
    const old = render();
    const id = reason === "room" ? "another-room" : "room";
    const scope =
      reason === "account" ? "another-account:workspace" : "account:workspace";
    render([data, scope, id, true]);
    expect(data.participate.mock.calls[0]?.[1]?.aborted).toBe(true);
    first.resolve(joined());
    expect((await settle()).ready).toBe(false);
    expect(old.requireJoined).toThrow(/not confirmed/u);
    second.resolve(joined(id));
    expect((await settle()).ready).toBe(true);
    expect(current.requireJoined).not.toThrow(/not confirmed/u);
    expect(old.requireJoined).toThrow(/not confirmed/u);
  }
);

test.each(["FORBIDDEN", "UNAUTHORIZED"] as const)(
  "authoritative %s remains terminal through native lifecycle changes",
  async (code) => {
    data.participate.mockRejectedValueOnce({
      data: { code },
      message: "Denied",
    });
    render();
    expect((await settle()).status).toBe("denied");
    appState("background");
    appState("active");
    online(false);
    online(true);
    await vi.advanceTimersByTimeAsync(60000);
    expect(data.participate).toHaveBeenCalledTimes(1);
    expect(render().status).toBe("denied");
    expect(current.requireJoined).toThrow(/not confirmed/u);
    expect(vi.getTimerCount()).toBe(0);
  }
);

test("a generic failure requires manual retry and cannot be classified by denial words", async () => {
  data.participate.mockRejectedValueOnce(new Error("FORBIDDEN network proxy"));
  render();
  expect((await settle()).status).toBe("error");
  appState("background");
  appState("active");
  await vi.advanceTimersByTimeAsync(60000);
  expect(data.participate).toHaveBeenCalledTimes(1);
  data.participate.mockResolvedValueOnce(joined());
  render().retry();
  expect(render().ready).toBe(false);
  expect((await settle()).ready).toBe(true);
  expect(data.participate).toHaveBeenCalledTimes(2);
});

test("cancel aborts requests, removes retry timers, and stays cancelled until explicit retry", async () => {
  data.participate.mockResolvedValueOnce(pending());
  render();
  const old = await settle();
  old.cancel();
  expect(render().status).toBe("cancelled");
  expect(old.requireJoined).toThrow(/not confirmed/u);
  expect(vi.getTimerCount()).toBe(0);
  appState("background");
  appState("active");
  await vi.advanceTimersByTimeAsync(60000);
  expect(data.participate).toHaveBeenCalledTimes(1);
  expect(render().status).toBe("cancelled");
  const retry = deferred();
  data.participate.mockReturnValueOnce(retry.promise);
  current.retry();
  render();
  const signal = data.participate.mock.calls[1]?.[1];
  current.cancel();
  expect(signal?.aborted).toBe(true);
  retry.resolve(joined());
  expect((await settle()).status).toBe("cancelled");
  expect(current.requireJoined).toThrow(/not confirmed/u);
});

test("disposal aborts in-flight work and removes lifecycle subscriptions", async () => {
  const request = deferred();
  data.participate.mockReturnValueOnce(request.promise);
  const old = render();
  const signal = data.participate.mock.calls[0]?.[1];
  dispose();
  expect(signal?.aborted).toBe(true);
  expect(state.listeners.size).toBe(0);
  expect(state.network.size).toBe(0);
  request.resolve(joined());
  await vi.advanceTimersByTimeAsync(60000);
  expect(data.participate).toHaveBeenCalledTimes(1);
  expect(old.requireJoined).toThrow(/not confirmed/u);
  expect(vi.getTimerCount()).toBe(0);
});

test.each(["background", "offline"] as const)(
  "%s aborts an unresolved request and ignores a late join",
  async (reason) => {
    const first = deferred();
    const second = deferred();
    data.participate
      .mockReturnValueOnce(first.promise)
      .mockReturnValueOnce(second.promise);
    render();
    const signal = data.participate.mock.calls[0]?.[1];
    if (reason === "background") appState("background");
    else online(false);
    expect(signal?.aborted).toBe(true);
    first.resolve(joined());
    expect((await settle()).ready).toBe(false);
    expect(current.requireJoined).toThrow(/not confirmed/u);
    await vi.advanceTimersByTimeAsync(60000);
    expect(data.participate).toHaveBeenCalledTimes(1);
    if (reason === "background") appState("active");
    else online(true);
    expect(data.participate).toHaveBeenCalledTimes(2);
    second.resolve(joined());
    expect((await settle()).ready).toBe(true);
  }
);

test("retained actions from the old account cannot disturb the current confirmation", async () => {
  const first = deferred();
  const second = deferred();
  data.participate
    .mockReturnValueOnce(first.promise)
    .mockReturnValueOnce(second.promise);
  const old = render();
  render([data, "another-account:workspace", "room", true]);
  const signal = data.participate.mock.calls[1]?.[1];
  old.cancel();
  old.retry();
  render();
  expect(data.participate).toHaveBeenCalledTimes(2);
  expect(signal?.aborted).toBe(false);
  second.resolve(joined());
  expect((await settle()).ready).toBe(true);
  expect(old.requireJoined).toThrow(/not confirmed/u);
});

test("replacing the data adapter requires its own confirmation and revokes old actions within the same room scope", async () => {
  data.participate.mockResolvedValueOnce(joined());
  render();
  const old = await settle();
  expect(old.ready).toBe(true);
  const next = deferred();
  const replacement = {
    participate: vi
      .fn<RoomData["participate"]>()
      .mockReturnValueOnce(next.promise),
  };
  render([replacement, "account:workspace", "room", true]);
  expect(current.ready).toBe(false);
  expect(current.status).toBe("pending");
  expect(replacement.participate).toHaveBeenCalledTimes(1);
  expect(current.requireJoined).toThrow(/not confirmed/u);
  expect(old.requireJoined).toThrow(/not confirmed/u);
  const signal = replacement.participate.mock.calls[0]?.[1];
  old.cancel();
  old.retry();
  render();
  expect(signal?.aborted).toBe(false);
  expect(replacement.participate).toHaveBeenCalledTimes(1);
  next.resolve(joined());
  expect((await settle()).ready).toBe(true);
  expect(current.requireJoined).not.toThrow(/not confirmed/u);
  expect(old.requireJoined).toThrow(/not confirmed/u);
  old.cancel();
  old.retry();
  expect(render().ready).toBe(true);
  expect(replacement.participate).toHaveBeenCalledTimes(1);
});
