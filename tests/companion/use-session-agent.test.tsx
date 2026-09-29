import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import {
  Client,
  type MessageStreamEvent,
  type StreamOptions,
} from "eve/client";
import { useEffect, type EffectCallback } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { beforeEach, expect, it, vi } from "vitest";
import type { SessionHistoryPage } from "../../packages/companion-ui/src/session/history";
import type { ChatAgent } from "../../packages/companion-ui/src/session/types";

const mocks = vi.hoisted(() => ({
  agent: undefined as ChatAgent | undefined,
  effects: [] as EffectCallback[],
  history: vi.fn<() => Promise<SessionHistoryPage>>(),
  attach: vi.fn<(id: string, options?: { streamIndex: number }) => void>(),
  cancel: vi.fn<() => Promise<void>>(),
  cancelResponse: vi.fn<() => Promise<void>>(),
  send: vi.fn<
    (
      message: unknown,
      options: unknown
    ) => Promise<{
      [Symbol.asyncIterator]: () => AsyncGenerator<MessageStreamEvent>;
      result: () => Promise<void>;
      cancel: () => Promise<void>;
    }>
  >(),
  stream:
    vi.fn<(options: StreamOptions) => AsyncIterable<MessageStreamEvent>>(),
}));

vi.mock("../../packages/companion-ui/src/session/history-pages", () => ({
  useHistoryPages: () => ({
    pending: false,
    error: undefined,
    load: async () => undefined,
  }),
}));

vi.mock("react", async (importOriginal) => ({
  ...(await importOriginal<typeof import("react")>()),
  useEffect: (effect: EffectCallback) => {
    mocks.effects.push(effect);
  },
}));
vi.mock("../../packages/companion-ui/src/session/history", () => ({
  readLatestSessionHistory: mocks.history,
  readOlderSessionHistory: vi.fn<() => Promise<SessionHistoryPage>>(),
}));
vi.mock("eve/client", async (importOriginal) => ({
  ...(await importOriginal<typeof import("eve/client")>()),
  Client: class {
    sessions = {
      attach: (id: string, options?: { streamIndex: number }) => {
        mocks.attach(id, options);
        return { send: mocks.send, stream: mocks.stream, cancel: mocks.cancel };
      },
    };
  },
}));

import { useSessionAgent } from "../../packages/companion-ui/src/session/use-session-agent";

let queryClient: QueryClient;
beforeEach(() => {
  queryClient = new QueryClient();
  mocks.agent = undefined;
  mocks.effects.length = 0;
  mocks.history.mockReset();
  mocks.attach.mockReset();
  mocks.cancel.mockReset();
  mocks.cancelResponse.mockReset();
  mocks.send.mockReset().mockResolvedValue({
    [Symbol.asyncIterator]: async function* () {
      yield receipt("default");
      yield waiting;
    },
    result: async () => undefined,
    cancel: mocks.cancelResponse,
  });
  mocks.stream
    .mockReset()
    .mockImplementation(({ signal }) => idleStream([], signal));
});

async function* idleStream(
  events: readonly MessageStreamEvent[],
  signal?: AbortSignal
) {
  yield* events;
  await new Promise<void>((resolve) => {
    signal?.addEventListener(
      "abort",
      () => {
        resolve();
      },
      { once: true }
    );
  });
}

function Probe() {
  const agent = useSessionAgent(
    "conversation",
    new Client({ host: "" }),
    "account:session"
  );
  useEffect(() => {
    mocks.agent = agent;
  }, [agent]);
  return null;
}

const waiting = {
  type: "session.waiting",
  data: { continuationToken: "", wait: "next-user-message" },
  meta: { id: "waiting", at: "2026-09-19T12:00:00.000Z" },
} satisfies MessageStreamEvent;

it("reloads failed initial history before accepting another message", async () => {
  mocks.history
    .mockRejectedValueOnce(new Error("Temporary connection failure"))
    .mockResolvedValueOnce({ events: [waiting], startIndex: 0, endIndex: 1 });
  renderToStaticMarkup(
    <QueryClientProvider client={queryClient}>
      <Probe />
    </QueryClientProvider>
  );
  const cleanups = mocks.effects.map((effect) => effect());
  await vi.waitFor(() => {
    expect(mocks.history).toHaveBeenCalledTimes(1);
  });
  await mocks.agent?.resume();
  expect(mocks.history).toHaveBeenCalledTimes(2);
  await mocks.agent?.send("Continue this conversation");
  await vi.waitFor(() => {
    expect(mocks.send).toHaveBeenCalledWith("Continue this conversation", {
      turnPolicy: "steer",
    });
  });
  for (const cleanup of cleanups) cleanup?.();
});

it("follows turns received after an idle boundary and detaches without cancelling them", async () => {
  mocks.history.mockResolvedValue({
    events: [waiting],
    startIndex: 0,
    endIndex: 1,
  });
  const received = {
    type: "message.received",
    data: { message: "Sent from another tab", sequence: 0, turnId: "external" },
    meta: { id: "external-message", at: "2026-09-19T12:01:00.000Z" },
  } satisfies MessageStreamEvent;
  const observed = Promise.withResolvers<void>();
  mocks.stream.mockImplementation(async function* ({ signal }) {
    yield received;
    yield { ...waiting, meta: { ...waiting.meta, id: "external-waiting" } };
    observed.resolve();
    await new Promise<void>((resolve) =>
      signal?.addEventListener(
        "abort",
        () => {
          resolve();
        },
        { once: true }
      )
    );
  });
  renderToStaticMarkup(
    <QueryClientProvider client={queryClient}>
      <Probe />
    </QueryClientProvider>
  );
  const cleanups = mocks.effects.map((effect) => effect());
  await observed.promise;
  await mocks.agent?.send("Reply from this tab");
  expect(mocks.stream).toHaveBeenCalledTimes(1);
  await vi.waitFor(() => {
    expect(mocks.attach).toHaveBeenLastCalledWith("conversation", {
      streamIndex: 3,
    });
  });
  for (const cleanup of cleanups) cleanup?.();
  expect(mocks.stream.mock.calls[0]?.[0].signal?.aborted).toBe(true);
  expect(mocks.cancel).not.toHaveBeenCalled();
});

it("enqueues consecutive messages immediately while the first turn is still working", async () => {
  mocks.history.mockResolvedValue({
    events: [waiting],
    startIndex: 0,
    endIndex: 1,
  });
  const completion = Promise.withResolvers<void>();
  let sequence = 0;
  mocks.send.mockImplementation(async () => {
    const id = `send-${++sequence}`;
    return {
      [Symbol.asyncIterator]: async function* () {
        yield receipt(id);
        await completion.promise;
        yield waiting;
      },
      result: () => completion.promise,
      cancel: mocks.cancelResponse,
    };
  });
  renderToStaticMarkup(
    <QueryClientProvider client={queryClient}>
      <Probe />
    </QueryClientProvider>
  );
  const cleanups = mocks.effects.map((effect) => effect());
  await vi.waitFor(() => {
    expect(mocks.stream).toHaveBeenCalledTimes(1);
  });
  await mocks.agent?.send("Identical message");
  await mocks.agent?.send("Identical message");
  await vi.waitFor(() => {
    expect(mocks.send).toHaveBeenCalledTimes(2);
  });
  expect(
    queryClient.getQueryData([
      "agent-outbox",
      "account:session",
      "conversation",
    ])
  ).toEqual([
    expect.objectContaining({ status: "accepted", receipt: receipt("send-1") }),
    expect.objectContaining({ status: "accepted", receipt: receipt("send-2") }),
  ]);
  completion.resolve();
  for (const cleanup of cleanups) cleanup?.();
});

it("keeps one echo per submission when live history arrives before its send receipt", async () => {
  const initial = { events: [waiting], startIndex: 0, endIndex: 1 };
  queryClient.setQueryData(
    ["agent-live-history", "account:session", "conversation"],
    initial
  );
  mocks.history.mockResolvedValue(initial);
  const acknowledged = Promise.withResolvers<void>();
  let sequence = 0;
  mocks.send.mockImplementation(async () => {
    const id = `received-${++sequence}`;
    return {
      [Symbol.asyncIterator]: async function* () {
        await acknowledged.promise;
        yield receipt(id);
        yield waiting;
      },
      result: async () => undefined,
      cancel: mocks.cancelResponse,
    };
  });
  const render = () => {
    renderToStaticMarkup(
      <QueryClientProvider client={queryClient}>
        <Probe />
      </QueryClientProvider>
    );
    mocks.effects.at(-1)?.();
    return mocks.agent?.data.messages;
  };
  render();
  await mocks.agent?.send("Identical message");
  await mocks.agent?.send("Identical message");
  queryClient.setQueryData(
    ["agent-live-history", "account:session", "conversation"],
    {
      events: [waiting, receipt("received-1")],
      startIndex: 0,
      endIndex: 2,
    }
  );
  expect(render()).toHaveLength(2);
  expect(
    mocks.agent?.data.messages.every((message) => message.metadata?.optimistic)
  ).toBe(true);
  acknowledged.resolve();
  await vi.waitFor(() => {
    expect(mocks.send).toHaveBeenCalledTimes(2);
  });
  await vi.waitFor(() => {
    expect(
      queryClient.getQueryData([
        "agent-outbox",
        "account:session",
        "conversation",
      ])
    ).toEqual([
      expect.objectContaining({ status: "accepted" }),
      expect.objectContaining({ status: "accepted" }),
    ]);
  });
  queryClient.setQueryData(
    ["agent-live-history", "account:session", "conversation"],
    {
      events: [waiting, receipt("received-1"), receipt("received-2")],
      startIndex: 0,
      endIndex: 3,
    }
  );
  expect(render()).toHaveLength(2);
  expect(
    mocks.agent?.data.messages.some((message) => message.metadata?.optimistic)
  ).toBe(false);
});

function receipt(id: string): MessageStreamEvent {
  return {
    type: "message.received",
    data: { message: "Identical message", sequence: 1, turnId: id },
    meta: { id, at: "2026-09-29T12:00:00.000Z" },
  };
}

it("releases a stopped turn at its native boundary and accepts the next message", async () => {
  mocks.history.mockResolvedValue({
    events: [waiting],
    startIndex: 0,
    endIndex: 1,
  });
  const started = Promise.withResolvers<void>();
  const stopped = Promise.withResolvers<void>();
  const completion = Promise.withResolvers<void>();
  mocks.send.mockImplementationOnce(async () => {
    started.resolve();
    return {
      [Symbol.asyncIterator]: async function* () {
        yield receipt("long-message");
        await completion.promise;
        yield waiting;
      },
      result: () => completion.promise,
      cancel: mocks.cancelResponse,
    };
  });
  mocks.cancelResponse.mockImplementation(async () => {
    stopped.resolve();
  });
  mocks.stream.mockImplementation(async function* ({ signal }) {
    await started.promise;
    yield {
      type: "message.received",
      data: { message: "Long operation", sequence: 1, turnId: "long-turn" },
      meta: { id: "long-message", at: "2026-09-19T12:01:00.000Z" },
    };
    await stopped.promise;
    yield {
      type: "turn.cancelled",
      data: { sequence: 1, turnId: "long-turn" },
      meta: { id: "cancelled", at: "2026-09-19T12:01:01.000Z" },
    };
    yield { ...waiting, meta: { ...waiting.meta, id: "stopped-waiting" } };
    completion.resolve();
    yield* idleStream([], signal);
  });
  renderToStaticMarkup(
    <QueryClientProvider client={queryClient}>
      <Probe />
    </QueryClientProvider>
  );
  const cleanups = mocks.effects.map((effect) => effect());
  await vi.waitFor(() => {
    expect(mocks.stream).toHaveBeenCalledTimes(1);
  });

  const running = mocks.agent?.send("Long operation");
  await started.promise;
  await mocks.agent?.cancel();
  await running;
  expect(mocks.cancelResponse).toHaveBeenCalledTimes(1);
  expect(mocks.cancel).not.toHaveBeenCalled();
  expect(mocks.stream.mock.calls[0]?.[0].signal?.aborted).toBe(false);

  await mocks.agent?.send("Continue with a different request");
  await vi.waitFor(() => {
    expect(mocks.send).toHaveBeenCalledTimes(2);
  });
  expect(mocks.send).toHaveBeenLastCalledWith(
    "Continue with a different request",
    { turnPolicy: "steer" }
  );
  expect(mocks.attach).toHaveBeenLastCalledWith("conversation", {
    streamIndex: 4,
  });
  expect(mocks.stream).toHaveBeenCalledTimes(1);
  for (const cleanup of cleanups) cleanup?.();
});

it("waits for an early submission response and cancels only its exact turn", async () => {
  mocks.history.mockResolvedValue({
    events: [waiting],
    startIndex: 0,
    endIndex: 1,
  });
  const accepted =
    Promise.withResolvers<Awaited<ReturnType<typeof mocks.send>>>();
  const completion = Promise.withResolvers<void>();
  mocks.send.mockReturnValueOnce(accepted.promise);
  renderToStaticMarkup(
    <QueryClientProvider client={queryClient}>
      <Probe />
    </QueryClientProvider>
  );
  const cleanups = mocks.effects.map((effect) => effect());
  await vi.waitFor(() => {
    expect(mocks.stream).toHaveBeenCalledTimes(1);
  });

  const running = mocks.agent?.send("Cancel this submission");
  const cancellation = mocks.agent?.cancel();
  expect(mocks.cancel).not.toHaveBeenCalled();
  expect(mocks.cancelResponse).not.toHaveBeenCalled();
  accepted.resolve({
    [Symbol.asyncIterator]: async function* () {
      yield receipt("early");
      await completion.promise;
      yield waiting;
    },
    result: () => completion.promise,
    cancel: mocks.cancelResponse,
  });
  await cancellation;
  expect(mocks.cancelResponse).toHaveBeenCalledTimes(1);
  expect(mocks.cancel).not.toHaveBeenCalled();
  completion.resolve();
  await running;
  for (const cleanup of cleanups) cleanup?.();
});

it("does not cancel a different turn when the pending send is rejected", async () => {
  mocks.history.mockResolvedValue({
    events: [waiting],
    startIndex: 0,
    endIndex: 1,
  });
  const accepted =
    Promise.withResolvers<Awaited<ReturnType<typeof mocks.send>>>();
  mocks.send.mockReturnValueOnce(accepted.promise);
  renderToStaticMarkup(
    <QueryClientProvider client={queryClient}>
      <Probe />
    </QueryClientProvider>
  );
  const cleanups = mocks.effects.map((effect) => effect());
  await vi.waitFor(() => {
    expect(mocks.stream).toHaveBeenCalledTimes(1);
  });

  const running = mocks.agent?.send("Keep this draft");
  const cancellation = mocks.agent?.cancel();
  const results = Promise.allSettled([running, cancellation]);
  accepted.reject(new Error("session_not_ready"));
  expect(await results).toEqual([
    { status: "fulfilled", value: undefined },
    { status: "rejected", reason: new Error("session_not_ready") },
  ]);
  expect(mocks.cancelResponse).not.toHaveBeenCalled();
  expect(mocks.cancel).not.toHaveBeenCalled();
  for (const cleanup of cleanups) cleanup?.();
});

it.each([
  { type: "session.completed", meta: waiting.meta },
  {
    type: "session.failed",
    meta: waiting.meta,
    data: {
      sessionId: "conversation",
      code: "MODEL_CALL_FAILED",
      message: "Model unavailable",
    },
  },
] satisfies MessageStreamEvent[])(
  "refuses sends and responses to a terminal $type session before HTTP",
  async (terminal) => {
    mocks.history.mockResolvedValue({
      events: [terminal],
      startIndex: 0,
      endIndex: 1,
    });
    renderToStaticMarkup(
      <QueryClientProvider client={queryClient}>
        <Probe />
      </QueryClientProvider>
    );
    const cleanups = mocks.effects.map((effect) => effect());
    await vi.waitFor(() => {
      expect(mocks.stream).toHaveBeenCalledTimes(1);
    });
    await expect(mocks.agent?.send("Keep this draft")).rejects.toThrow(
      "conversation has ended"
    );
    await expect(mocks.agent?.respond([])).rejects.toThrow(
      "conversation has ended"
    );
    expect(mocks.send).not.toHaveBeenCalled();
    for (const cleanup of cleanups) cleanup?.();
  }
);
