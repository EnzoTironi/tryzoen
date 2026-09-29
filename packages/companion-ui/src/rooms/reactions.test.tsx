import { renderToStaticMarkup } from "react-dom/server";
import { useEffect, type EffectCallback, type SetStateAction } from "react";
import {
  QueryClient,
  MutationObserver,
  onlineManager,
  type QueryObserverResult,
  type UseQueryOptions,
  type UseMutationOptions,
  type useMutationState,
} from "@tanstack/react-query";
import { afterEach, beforeEach, expect, it, vi } from "vitest";
import { useRoomReactions } from "./reactions";
import type { RoomData, roomReactionWriteSchema } from "./schema";
import type { z } from "zod";

const state = vi.hoisted(() => ({
  foreground: "active",
  effects: [] as EffectCallback[],
  visible: ["$message"],
  page: undefined as Awaited<ReturnType<RoomData["reactions"]>> | undefined,
  options: undefined as
    | UseQueryOptions<Awaited<ReturnType<RoomData["reactions"]>>>
    | undefined,
  refetch:
    vi.fn<
      () => Promise<
        Pick<
          QueryObserverResult<Awaited<ReturnType<RoomData["reactions"]>>>,
          "data" | "isError"
        >
      >
    >(),
  current: undefined as ReturnType<typeof useRoomReactions> | undefined,
  client: undefined as QueryClient | undefined,
}));
vi.mock("react", async (original) => ({
  ...(await original<typeof import("react")>()),
  useEffect: (effect: EffectCallback) => {
    state.effects.push(effect);
  },
  useState: () => [
    state.visible,
    (update: SetStateAction<string[]>) => {
      state.visible =
        typeof update === "function" ? update(state.visible) : update;
    },
  ],
}));
vi.mock("react-native", () => ({
  AppState: {
    get currentState() {
      return state.foreground;
    },
  },
}));
vi.mock("@tanstack/react-query", async (original) => ({
  ...(await original<typeof import("@tanstack/react-query")>()),
  useQueryClient: () => state.client,
  useMutation: (
    options: UseMutationOptions<
      void,
      Error,
      Pick<z.infer<typeof roomReactionWriteSchema>, "messageId" | "emoji">
    >
  ) => {
    if (!state.client) throw new Error("Query client did not mount");
    const observer = new MutationObserver(state.client, options);
    return {
      mutateAsync: (
        input: Pick<
          z.infer<typeof roomReactionWriteSchema>,
          "messageId" | "emoji"
        >
      ) => observer.mutate(input),
    };
  },
  useMutationState: <T,>(
    options: NonNullable<Parameters<typeof useMutationState<T>>[0]>
  ) =>
    state.client
      ?.getMutationCache()
      .findAll(options.filters)
      .map((mutation) => options.select?.(mutation) ?? mutation.state) ?? [],
  useQuery: (options: typeof state.options) => {
    state.options = options;
    return {
      data: state.client?.getQueryData(options?.queryKey ?? []) ?? state.page,
      isError: false,
      refetch: state.refetch,
    };
  },
}));

const summary: Awaited<ReturnType<RoomData["react"]>> = {
  messageId: "$message",
  mine: null,
  mineEventId: null,
  complete: true,
  reactions: [],
};
const data = {
  reactions: vi.fn<RoomData["reactions"]>(),
  react: vi.fn<RoomData["react"]>(),
  operationId: vi.fn<RoomData["operationId"]>(() => "operation"),
};
const key = ["matrix-reactions", "viewer:workspace", "room", ["$message"]];
let cleanups: (() => void)[];

function Probe({ enabled }: { enabled: boolean }) {
  const current = useRoomReactions(data, "viewer:workspace", "room", enabled);
  useEffect(() => {
    state.current = current;
  }, [current]);
  return null;
}
function mount(enabled = true) {
  renderToStaticMarkup(<Probe enabled={enabled} />);
  for (const effect of state.effects.splice(0)) {
    const cleanup = effect();
    if (typeof cleanup === "function") cleanups.push(cleanup);
  }
  if (!state.current) throw new Error("Missing reactions hook");
  return state.current;
}

beforeEach(() => {
  cleanups = [];
  state.effects = [];
  state.visible = ["$message"];
  state.page = [summary];
  state.foreground = "active";
  state.client = new QueryClient();
  state.refetch.mockReset();
  data.react
    .mockReset()
    .mockResolvedValue({ ...summary, mine: "❤️", mineEventId: "$heart" });
  data.operationId.mockClear();
  onlineManager.setOnline(true);
});
afterEach(() => {
  for (const cleanup of cleanups) cleanup();
  state.client?.clear();
  onlineManager.setOnline(true);
});

it("fetches only visible messages in an active view and bounds a burst to twelve IDs", async () => {
  const hidden = mount(false);
  expect(state.options?.enabled).toBe(false);
  await expect(hidden.setReaction("$message", "❤️")).rejects.toThrow(
    "active conversation"
  );
  expect(data.react).not.toHaveBeenCalled();
  const active = mount();
  expect(state.options?.enabled).toBe(true);
  active.showMessages(
    Array.from({ length: 40 }, (_, i) => `$${Math.floor(i / 2)}`)
  );
  expect(state.visible).toHaveLength(12);
  expect(new Set(state.visible).size).toBe(12);
  active.showMessages([]);
  mount();
  expect(state.options?.enabled).toBe(false);
});

it.each(["background", "offline", "unmounted"])(
  "never sends a reaction after its authorization read finishes %s",
  async (reason) => {
    state.page = undefined;
    let resolve:
      | ((result: Awaited<ReturnType<typeof state.refetch>>) => void)
      | undefined;
    state.refetch.mockImplementation(
      () =>
        new Promise((done) => {
          resolve = done;
        })
    );
    const hook = mount();
    const saving = hook.setReaction("$message", "❤️");
    await vi.waitFor(() => {
      expect(state.refetch).toHaveBeenCalledOnce();
    });
    if (reason === "background") state.foreground = "background";
    if (reason === "offline") onlineManager.setOnline(false);
    if (reason === "unmounted") for (const cleanup of cleanups) cleanup();
    resolve?.({ data: [summary], isError: false });
    await expect(saving).rejects.toThrow("active conversation");
    expect(data.react).not.toHaveBeenCalled();
  }
);

it("does not overwrite a reopened view when an accepted write completes late", async () => {
  let resolve:
    | ((result: Awaited<ReturnType<RoomData["react"]>>) => void)
    | undefined;
  data.react.mockImplementation(
    () =>
      new Promise((done) => {
        resolve = done;
      })
  );
  state.client?.setQueryData(key, [summary]);
  const hook = mount();
  const saving = hook.setReaction("$message", "❤️");
  await vi.waitFor(() => {
    expect(data.react).toHaveBeenCalledOnce();
  });
  for (const cleanup of cleanups) cleanup();
  state.client?.removeQueries({ queryKey: key });
  const newer = [{ ...summary, mine: "🔥", mineEventId: "$later" }];
  state.client?.setQueryData(key, newer);
  resolve?.({ ...summary, mine: "❤️", mineEventId: "$heart" });
  await saving;
  expect(state.client?.getQueryData(key)).toEqual(newer);
});

it("remains usable after React replays effect setup and cleanup", async () => {
  renderToStaticMarkup(<Probe enabled />);
  const effect = state.effects.at(0);
  const cleanup = effect?.();
  if (typeof cleanup === "function") cleanup();
  const replayCleanup = effect?.();
  if (typeof replayCleanup === "function") cleanups.push(replayCleanup);
  state.effects.at(1)?.();
  await state.current?.setReaction("$message", "❤️");
  expect(data.react).toHaveBeenCalledOnce();
});

it("retries an uncertain reaction with the same operation ID and updates only its own scope", async () => {
  data.react.mockRejectedValueOnce(new Error("Connection lost"));
  const other = ["matrix-reactions", "another:workspace", "room", ["$message"]];
  state.client?.setQueryData(key, [summary]);
  state.client?.setQueryData(other, [summary]);
  const hook = mount();
  await expect(hook.setReaction("$message", "❤️")).rejects.toThrow(
    "Connection lost"
  );
  await hook.setReaction("$message", "❤️");
  expect(data.operationId).toHaveBeenCalledOnce();
  expect(data.react.mock.calls[0]).toEqual(data.react.mock.calls[1]);
  expect(state.client?.getQueryData(key)).toMatchObject([{ mine: "❤️" }]);
  expect(state.client?.getQueryData(other)).toEqual([summary]);
});

it("shows a pending choice immediately and rolls it back on failure without modifying confirmed data", async () => {
  let reject: ((error: Error) => void) | undefined;
  data.react.mockImplementationOnce(
    () =>
      new Promise((_done, fail) => {
        reject = fail;
      })
  );
  state.client?.setQueryData(key, [summary]);
  const hook = mount();
  const saving = hook.setReaction("$message", "❤️");
  const failure = saving.catch((error: unknown) => error);
  await vi.waitFor(() => {
    expect(data.react).toHaveBeenCalledOnce();
  });
  expect(mount().result.data).toMatchObject([
    { mine: "❤️", reactions: [{ emoji: "❤️", count: 1 }] },
  ]);
  expect(state.client?.getQueryData(key)).toEqual([summary]);
  reject?.(new Error("Synthetic offline"));
  expect(await failure).toEqual(new Error("Synthetic offline"));
  expect(mount().result.data).toEqual([summary]);
});

it("serializes native writes across views and projects the most recent queued choice", async () => {
  let resolve:
    | ((value: Awaited<ReturnType<RoomData["react"]>>) => void)
    | undefined;
  data.react.mockImplementationOnce(
    () =>
      new Promise((done) => {
        resolve = done;
      })
  );
  state.client?.setQueryData(key, [summary]);
  const first = mount().setReaction("$message", "❤️");
  const second = mount().setReaction("$message", "👍");
  await vi.waitFor(() => {
    expect(data.react).toHaveBeenCalledOnce();
  });
  expect(mount().result.data).toMatchObject([
    { mine: "👍", reactions: [{ emoji: "👍", count: 1 }] },
  ]);
  resolve?.({
    ...summary,
    mine: "❤️",
    mineEventId: "$heart",
    reactions: [{ emoji: "❤️", count: 1 }],
  });
  await Promise.all([first, second]);
  expect(data.react.mock.calls[1]?.[0]).toMatchObject({
    emoji: "👍",
    previousEventId: "$heart",
  });
});
