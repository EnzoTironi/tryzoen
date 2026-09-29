import { renderToStaticMarkup } from "react-dom/server";
import { QueryClient, InfiniteQueryObserver } from "@tanstack/react-query";
import { useEffect, type EffectCallback, type ReactNode } from "react";
import { Client } from "eve/client";
import { beforeEach, expect, it, vi } from "vitest";
import type { SessionHistoryPage } from "../../packages/companion-ui/src/session/history";
import { useHistoryPages } from "../../packages/companion-ui/src/session/history-pages";
const mocks = vi.hoisted(() => ({
  effects: [] as EffectCallback[],
  cleanups: [] as (() => void)[],
  pages: undefined as ReturnType<typeof useHistoryPages> | undefined,
  older:
    vi.fn<
      (
        client: Client,
        id: string,
        before: number,
        signal?: AbortSignal
      ) => Promise<SessionHistoryPage>
    >(),
}));
const client = new QueryClient();
vi.mock("react", async (original) => ({
  ...(await original<typeof import("react")>()),
  useEffect: (effect: EffectCallback) => {
    mocks.effects.push(effect);
  },
}));
vi.mock("@tanstack/react-query", async (original) => ({
  ...(await original<typeof import("@tanstack/react-query")>()),
  useQueryClient: () => client,
  useInfiniteQuery: (
    options: ConstructorParameters<typeof InfiniteQueryObserver>[1]
  ) => new InfiniteQueryObserver(client, options).getCurrentResult(),
}));
vi.mock("../../packages/companion-ui/src/session/history", () => ({
  readOlderSessionHistory: mocks.older,
}));

const eve = new Client({ host: "" });
function Probe({
  scope = "viewer:login",
  session = "one",
}: {
  scope?: string;
  session?: string;
}) {
  const pages = useHistoryPages(eve, session, scope, 10);
  useEffect(() => {
    mocks.pages = pages;
  }, [pages]);
  return null;
}
function mount(element: ReactNode) {
  renderToStaticMarkup(element);
  for (const effect of mocks.effects.splice(0)) {
    const cleanup = effect();
    if (typeof cleanup === "function") mocks.cleanups.push(cleanup);
  }
}
beforeEach(() => {
  client.clear();
  mocks.effects = [];
  mocks.cleanups = [];
  mocks.older.mockReset();
});
it("does not fetch on mount and coalesces same-tick pagination requests", async () => {
  let finish: ((page: SessionHistoryPage) => void) | undefined;
  mocks.older.mockImplementation(
    () =>
      new Promise((resolve) => {
        finish = resolve;
      })
  );
  mount(<Probe />);
  expect(mocks.older).not.toHaveBeenCalled();
  const one = mocks.pages?.load();
  const two = mocks.pages?.load();
  expect(mocks.older).toHaveBeenCalledOnce();
  finish?.({ startIndex: 5, endIndex: 10, events: [] });
  expect(await one).toMatchObject({ startIndex: 5 });
  expect(await two).toMatchObject({ startIndex: 5 });
});
it("uses the preceding page cursor, stops at zero and passes an AbortSignal", async () => {
  mocks.older
    .mockResolvedValueOnce({ startIndex: 5, endIndex: 10, events: [] })
    .mockResolvedValueOnce({ startIndex: 0, endIndex: 5, events: [] });
  mount(<Probe />);
  await mocks.pages?.load();
  await mocks.pages?.load();
  await mocks.pages?.load();
  expect(mocks.older).toHaveBeenCalledTimes(2);
  expect(mocks.older).toHaveBeenNthCalledWith(
    2,
    eve,
    "one",
    5,
    expect.any(AbortSignal)
  );
});
it("aborts and ignores a pending page after unmount without retaining history", async () => {
  let finish: ((page: SessionHistoryPage) => void) | undefined;
  mocks.older.mockImplementation(
    () =>
      new Promise((resolve) => {
        finish = resolve;
      })
  );
  mount(<Probe />);
  const cleanups = mocks.cleanups;
  const load = mocks.pages?.load();
  const signal = mocks.older.mock.calls[0]?.[3];
  for (const cleanup of cleanups) if (typeof cleanup === "function") cleanup();
  expect(signal?.aborted).toBe(true);
  finish?.({ startIndex: 5, endIndex: 10, events: [] });
  expect(await load).toBeUndefined();
  expect(client.getQueryCache().getAll()).toHaveLength(0);
});
it("isolates accounts and conversations even when the Eve client is shared", async () => {
  mocks.older.mockResolvedValue({ startIndex: 0, endIndex: 10, events: [] });
  mount(<Probe />);
  await mocks.pages?.load();
  mount(<Probe scope="other:login" session="two" />);
  await mocks.pages?.load();
  expect(mocks.older).toHaveBeenCalledTimes(2);
  expect(mocks.older.mock.calls.map((call) => call[1])).toEqual(["one", "two"]);
});
it("surfaces failure without automatically retrying or discarding the next cursor", async () => {
  mocks.older
    .mockRejectedValueOnce(new Error("Offline"))
    .mockResolvedValueOnce({ startIndex: 0, endIndex: 10, events: [] });
  mount(<Probe />);
  await expect(mocks.pages?.load()).rejects.toThrow("Offline");
  expect(mocks.older).toHaveBeenCalledOnce();
  expect(await mocks.pages?.load()).toMatchObject({ startIndex: 0 });
});

it("ignores a late account A response after account B mounts", async () => {
  let finish: ((page: SessionHistoryPage) => void) | undefined;
  mocks.older
    .mockImplementationOnce(
      () =>
        new Promise((resolve) => {
          finish = resolve;
        })
    )
    .mockResolvedValueOnce({ startIndex: 0, endIndex: 10, events: [] });
  mount(<Probe />);
  const pending = mocks.pages?.load();
  for (const cleanup of mocks.cleanups) cleanup();
  mount(<Probe scope="other:new-session" session="two" />);
  expect(await mocks.pages?.load()).toMatchObject({ startIndex: 0 });
  finish?.({ startIndex: 5, endIndex: 10, events: [] });
  expect(await pending).toBeUndefined();
  expect(
    client
      .getQueryCache()
      .getAll()
      .every((query) => query.queryKey.includes("other:new-session"))
  ).toBe(true);
});
