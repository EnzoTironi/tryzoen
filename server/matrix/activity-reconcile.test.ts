/** SQL and the outermost transaction boundary are mocked here. These tests prove
 * budgets, provider cancellation and submitted updates, not PostgreSQL guards. */
import { AsyncLocalStorage } from "node:async_hooks";
import { PgDialect } from "drizzle-orm/pg-core";
import { afterEach, beforeEach, expect, test, vi } from "vitest";
import { z } from "zod";
import type { query } from "@db/queries";
import type { projectMatrixActivity } from "./activity";
import type { matrixConfiguration, matrixRequest } from "./client";
import { Secret } from "../../shared/environment/secret";
import { operationSignal, TimeoutError, withSignal } from "../operations/async";

const boundary = vi.hoisted(() => ({
  query: vi.fn<typeof query>(),
  transaction:
    vi.fn<
      <Result>(
        run: () => Promise<Result>,
        options?: { outermost?: boolean }
      ) => Promise<Result>
    >(),
  configuration: vi.fn<typeof matrixConfiguration>(),
  request: vi.fn<typeof matrixRequest>(),
  project: vi.fn<typeof projectMatrixActivity>(),
}));
vi.mock("@db/queries", () => ({
  query: boundary.query,
  transaction: boundary.transaction,
}));
vi.mock("./client", async (original) => ({
  ...(await original<typeof import("./client")>()),
  matrixConfiguration: boundary.configuration,
  matrixRequest: boundary.request,
}));
vi.mock("./activity", () => ({ projectMatrixActivity: boundary.project }));

import { MatrixError } from "./client";
import { reconcileMatrixActivity } from "./activity-reconcile";

const dialect = new PgDialect();
const transactions = new AsyncLocalStorage<boolean>();
const executed: ReturnType<typeof dialect.sqlToQuery>[] = [];

function room(id: number, cursor: string | null = null) {
  return {
    roomId: `!activity-${id}:synthetic.invalid`,
    matrixId: "@synthetic-reader:synthetic.invalid",
    cursor,
    edited: false,
  };
}
let candidates: ReturnType<typeof room>[] = [];

function message(id: number) {
  return {
    event_id: `$activity-${id}`,
    type: "m.room.message",
    sender: "@synthetic-sender:synthetic.invalid",
    origin_server_ts: Date.now(),
    content: { msgtype: "m.text", body: "Synthetic activity" },
  };
}

function requestUrl(path: string) {
  return new URL(path, "https://matrix.synthetic.invalid/");
}

function requestedRoom(path: string) {
  return decodeURIComponent(requestUrl(path).pathname.split("/")[2] ?? "");
}

beforeEach(() => {
  vi.useFakeTimers();
  vi.setSystemTime(new Date("2026-09-30T12:00:00Z"));
  candidates = [];
  executed.length = 0;
  boundary.query.mockReset().mockImplementation(async (statement) => {
    operationSignal().throwIfAborted();
    const compiled = dialect.sqlToQuery(statement);
    executed.push(compiled);
    if (compiled.sql.includes("WITH bindings AS"))
      return candidates.slice(0, Number(compiled.params.at(-1)));
    return [];
  });
  boundary.transaction.mockReset().mockImplementation(async (run, options) => {
    if (options?.outermost && transactions.getStore())
      throw new Error("An outermost transaction is required.");
    return transactions.run(true, async () => {
      const result = await run();
      operationSignal().throwIfAborted();
      return result;
    });
  });
  boundary.configuration.mockReset().mockResolvedValue({
    serverName: "synthetic.invalid",
    url: "https://matrix.synthetic.invalid/",
    token: new Secret("synthetic-activity-appservice-token"),
    homeserverToken: new Secret("synthetic-activity-homeserver-token"),
    botId: "@synthetic-bot:synthetic.invalid",
  });
  boundary.request.mockReset().mockResolvedValue({ chunk: [] });
  boundary.project.mockReset().mockResolvedValue(undefined);
});
afterEach(() => vi.useRealTimers());

test.each([
  { limit: 0, remaining: 1_000 },
  { limit: 5, remaining: 0 },
  { limit: 5, remaining: -1 },
])(
  "budget $limit with remaining $remaining performs no work",
  async (input) => {
    expect(
      await reconcileMatrixActivity(Date.now() + input.remaining, input.limit)
    ).toBe(0);
    expect(boundary.configuration).not.toHaveBeenCalled();
    expect(boundary.transaction).not.toHaveBeenCalled();
    expect(boundary.query).not.toHaveBeenCalled();
    expect(boundary.request).not.toHaveBeenCalled();
    expect(boundary.project).not.toHaveBeenCalled();
  }
);

test.each([-1, 0.5, 6, Number.NaN, Number.POSITIVE_INFINITY])(
  "rejects invalid item limit %s before SQL or provider work",
  async (limit) => {
    await expect(
      reconcileMatrixActivity(Date.now() + 1_000, limit)
    ).rejects.toBeInstanceOf(z.ZodError);
    expect(boundary.query).not.toHaveBeenCalled();
    expect(boundary.request).not.toHaveBeenCalled();
  }
);

test.each([
  -1,
  0.5,
  Number.NaN,
  Number.POSITIVE_INFINITY,
  Number.MAX_SAFE_INTEGER + 1,
])(
  "rejects invalid absolute deadline %s before SQL or provider work",
  async (deadline) => {
    await expect(reconcileMatrixActivity(deadline, 1)).rejects.toBeInstanceOf(
      z.ZodError
    );
    expect(boundary.query).not.toHaveBeenCalled();
    expect(boundary.request).not.toHaveBeenCalled();
  }
);

test("rejects a deadline beyond the schedule budget before SQL or provider work", async () => {
  await expect(reconcileMatrixActivity(Date.now() + 30_001, 1)).rejects.toThrow(
    "deadline exceeds bounded schedule budget"
  );
  expect(boundary.configuration).not.toHaveBeenCalled();
  expect(boundary.query).not.toHaveBeenCalled();
  expect(boundary.request).not.toHaveBeenCalled();
});

test.each([1, 2, 3, 4, 5])(
  "binds SQL LIMIT %s and attempts at most that many rooms",
  async (limit) => {
    candidates = Array.from({ length: 7 }, (_, id) => room(id));
    expect(await reconcileMatrixActivity(Date.now() + 1_000, limit)).toBe(
      limit
    );
    const selection = executed.find((item) =>
      item.sql.includes("WITH bindings AS")
    );
    expect(selection?.sql).toMatch(/LIMIT \$\d+/u);
    expect(selection?.params.at(-1)).toBe(limit);
    expect(boundary.request).toHaveBeenCalledTimes(limit);
    for (const [method, path, body, matrixId] of boundary.request.mock.calls) {
      expect(method).toBe("GET");
      expect(requestUrl(path).searchParams.get("limit")).toBe("100");
      expect(body).toBeUndefined();
      expect(matrixId).toBe(room(0).matrixId);
    }
  }
);

test("rejects an oversized candidate response instead of exceeding the item budget", async () => {
  boundary.query.mockImplementation(async (statement) => {
    const compiled = dialect.sqlToQuery(statement);
    executed.push(compiled);
    return compiled.sql.includes("WITH bindings AS")
      ? [room(1), room(2), room(3)]
      : [];
  });
  await expect(
    reconcileMatrixActivity(Date.now() + 1_000, 2)
  ).rejects.toBeInstanceOf(z.ZodError);
  expect(boundary.request).not.toHaveBeenCalled();
});

test("admits at most two concurrent native history requests", async () => {
  candidates = Array.from({ length: 5 }, (_, id) => room(id));
  const gates = candidates.map(() => Promise.withResolvers<void>());
  const firstTwo = Promise.withResolvers<void>();
  const third = Promise.withResolvers<void>();
  let active = 0;
  let maximum = 0;
  let entered = 0;
  boundary.request.mockImplementation(
    async (_method, path): ReturnType<typeof matrixRequest> => {
      const index = candidates.findIndex(
        (item) => item.roomId === requestedRoom(path)
      );
      active += 1;
      maximum = Math.max(maximum, active);
      entered += 1;
      if (entered === 2) firstTwo.resolve();
      if (entered === 3) third.resolve();
      await gates[index]?.promise;
      active -= 1;
      return { chunk: [] };
    }
  );
  const running = reconcileMatrixActivity(Date.now() + 5_000, 5);
  try {
    await firstTwo.promise;
    expect(boundary.request).toHaveBeenCalledTimes(2);
    expect(active).toBe(2);
    gates[0]?.resolve();
    await third.promise;
    expect(boundary.request).toHaveBeenCalledTimes(3);
    expect(maximum).toBe(2);
  } finally {
    for (const gate of gates) gate.resolve();
  }
  expect(await running).toBe(5);
  expect(boundary.request).toHaveBeenCalledTimes(5);
  expect(maximum).toBe(2);
  expect(active).toBe(0);
});

test.each(["timeout", "cancellation"] as const)(
  "%s during native GET aborts its signal and never marks the room reconciled",
  async (mode) => {
    candidates = [room(1, "synthetic-cursor")];
    const entered = Promise.withResolvers<AbortSignal>();
    const response =
      Promise.withResolvers<Awaited<ReturnType<typeof matrixRequest>>>();
    boundary.request.mockImplementation(async () => {
      entered.resolve(operationSignal());
      return response.promise;
    });
    const controller = new AbortController();
    const reason = new Error("Synthetic native history cancellation.");
    const running =
      mode === "timeout"
        ? reconcileMatrixActivity(Date.now() + 25, 1)
        : withSignal(controller.signal, () =>
            reconcileMatrixActivity(Date.now() + 1_000, 1)
          );
    const rejected = running.then(
      () => undefined,
      (error: unknown) => error
    );
    const signal = await entered.promise;
    expect(signal.aborted).toBe(false);
    if (mode === "timeout") await vi.advanceTimersByTimeAsync(25);
    else controller.abort(reason);
    expect(signal.aborted).toBe(true);
    // Already-started adapter work must settle before the owning budget releases.
    // Its late page remains unable to publish after cancellation.
    response.resolve({ chunk: [message(1)] });
    const error = await rejected;
    expect(error).toBeInstanceOf(mode === "timeout" ? TimeoutError : Error);
    expect(error).toBe(mode === "timeout" ? signal.reason : reason);
    await vi.advanceTimersByTimeAsync(0);
    expect(boundary.project).not.toHaveBeenCalled();
    expect(
      executed.filter((item) => item.sql.includes("SET reconcile_cursor"))
    ).toEqual([]);
  }
);

test("a MatrixError preserves the failed cursor and retry position while other rooms continue", async () => {
  candidates = [room(1, "cursor-before-failure"), room(2), room(3)];
  boundary.request.mockImplementation(
    async (_method, path): ReturnType<typeof matrixRequest> => {
      if (requestedRoom(path) === room(1).roomId)
        throw new MatrixError({ reason: "unavailable" });
      return requestedRoom(path) === room(2).roomId
        ? { chunk: [], end: "cursor-for-next-page" }
        : { chunk: [] };
    }
  );
  expect(await reconcileMatrixActivity(Date.now() + 1_000, 3)).toBe(3);
  expect(boundary.request).toHaveBeenCalledTimes(3);
  const failedRequest = boundary.request.mock.calls.find(
    ([, path]) => requestedRoom(path) === room(1).roomId
  );
  expect(requestUrl(failedRequest?.[1] ?? "").searchParams.get("from")).toBe(
    "cursor-before-failure"
  );
  expect(
    executed.some(
      (item) =>
        item.sql.includes("reconcile_attempted_at = now()") &&
        item.params.includes(room(1).roomId)
    )
  ).toBe(true);
  const updates = executed.filter((item) =>
    item.sql.includes("SET reconcile_cursor")
  );
  expect(updates.some((item) => item.params.at(-1) === room(1).roomId)).toBe(
    false
  );
  expect(
    updates.find((item) => item.params.at(-1) === room(2).roomId)?.params
  ).toEqual([
    "cursor-for-next-page",
    null,
    "synthetic.invalid",
    room(2).roomId,
  ]);
  expect(
    updates.find((item) => item.params.at(-1) === room(3).roomId)?.params[1]
  ).toBeInstanceOf(Date);
  expect(
    executed.find((item) => item.sql.includes("WITH bindings AS"))?.sql
  ).toContain("ORDER BY a.reconcile_attempted_at NULLS FIRST");
});

test("guards selection before native GET and gives each projection its own bounded outermost transaction", async () => {
  candidates = [room(1)];
  boundary.request.mockImplementation(async () => {
    expect(transactions.getStore()).toBeUndefined();
    expect(boundary.transaction.mock.calls[0]?.[1]).toEqual({
      outermost: true,
    });
    expect(executed[0]?.sql).toContain("set_config('statement_timeout'");
    return { chunk: [message(1), message(2)] };
  });
  const projectionTransactions: number[] = [];
  boundary.project.mockImplementation(async () => {
    expect(transactions.getStore()).toBe(true);
    projectionTransactions.push(boundary.transaction.mock.calls.length);
    expect(executed.at(-1)?.sql).toContain("set_config('statement_timeout'");
  });
  expect(await reconcileMatrixActivity(Date.now() + 1_000, 1)).toBe(1);
  expect(boundary.project).toHaveBeenCalledTimes(2);
  expect(new Set(projectionTransactions).size).toBe(2);
  for (const [, options] of boundary.transaction.mock.calls)
    expect(options).toEqual({ outermost: true });
  const timeouts = executed.filter((item) =>
    item.sql.includes("set_config('statement_timeout'")
  );
  expect(timeouts).toHaveLength(boundary.transaction.mock.calls.length);
  expect(timeouts.every((item) => Number(item.params[0]) > 0)).toBe(true);
});

test("a denied mocked outermost guard stops before SQL or native provider I/O", async () => {
  boundary.transaction.mockRejectedValueOnce(
    new Error("An outermost transaction is required.")
  );
  await expect(reconcileMatrixActivity(Date.now() + 1_000, 1)).rejects.toThrow(
    "outermost"
  );
  expect(boundary.query).not.toHaveBeenCalled();
  expect(boundary.request).not.toHaveBeenCalled();
  expect(boundary.project).not.toHaveBeenCalled();
});
