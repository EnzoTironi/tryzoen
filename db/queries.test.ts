import { afterEach, beforeEach, describe, expect, test, vi } from "vitest";
import { sql } from "drizzle-orm";
import type { SQL } from "drizzle-orm";
import { PgDialect } from "drizzle-orm/pg-core";
import {
  operationSignal,
  TimeoutError,
  withDeadline,
  withSignal,
} from "../server/operations/async";
import { query, SqlError, transaction } from "./queries";

const boundary = vi.hoisted(() => {
  const transactionExecute =
    vi.fn<(statement: SQL) => Promise<{ rows: Record<string, unknown>[] }>>();
  const nested =
    vi.fn<
      (
        run: (active: {
          execute: typeof transactionExecute;
        }) => Promise<unknown>
      ) => Promise<unknown>
    >();
  const outer =
    vi.fn<
      (
        run: (active: {
          execute: typeof transactionExecute;
          transaction: typeof nested;
        }) => Promise<unknown>
      ) => Promise<unknown>
    >();
  return {
    outer,
    nested,
    rootExecute:
      vi.fn<(statement: SQL) => Promise<{ rows: Record<string, unknown>[] }>>(),
    transactionExecute,
    nestedExecute:
      vi.fn<(statement: SQL) => Promise<{ rows: Record<string, unknown>[] }>>(),
  };
});
vi.mock("./index", () => ({
  db: { transaction: boundary.outer, execute: boundary.rootExecute },
}));

beforeEach(() => {
  vi.resetAllMocks();
  boundary.rootExecute.mockResolvedValue({ rows: [] });
  boundary.transactionExecute.mockResolvedValue({ rows: [] });
  boundary.nestedExecute.mockResolvedValue({ rows: [] });
  const tx = {
    execute: boundary.transactionExecute,
    transaction: boundary.nested,
  };
  boundary.outer.mockImplementation(async (run) => run(tx));
  boundary.nested.mockImplementation(async (run) =>
    run({ execute: boundary.nestedExecute })
  );
});

afterEach(() => {
  vi.useRealTimers();
  vi.restoreAllMocks();
});

test("outermost admission rejects before an active transaction can create a savepoint or run effects", async () => {
  const effects = vi.fn<() => Promise<string>>(async () => "unexpected");
  await transaction(async () => {
    await expect(transaction(effects, { outermost: true })).rejects.toThrow(
      "A top-level transaction is required."
    );
    await query(sql`SELECT 1`);
  });
  expect(effects).not.toHaveBeenCalled();
  expect(boundary.nested).not.toHaveBeenCalled();
  expect(boundary.outer).toHaveBeenCalledTimes(1);
  expect(boundary.transactionExecute).toHaveBeenCalledTimes(1);
});

test("ordinary nesting keeps savepoints and restores the enclosing query context", async () => {
  await transaction(async () => {
    await transaction(async () => {
      await query(sql`SELECT 1`);
    });
    await query(sql`SELECT 2`);
  });
  await query(sql`SELECT 3`);
  expect(boundary.outer).toHaveBeenCalledTimes(1);
  expect(boundary.nested).toHaveBeenCalledTimes(1);
  expect(boundary.transactionExecute).toHaveBeenCalledTimes(1);
  expect(boundary.nestedExecute).toHaveBeenCalledTimes(1);
  expect(boundary.rootExecute).toHaveBeenCalledTimes(1);
});

test("outermost completion waits for the owning database commit, not only its callback", async () => {
  const entered = Promise.withResolvers<void>();
  const commit = Promise.withResolvers<void>();
  const order: string[] = [];
  boundary.outer.mockImplementation(async (run) => {
    const result = await run({
      execute: boundary.transactionExecute,
      transaction: boundary.nested,
    });
    entered.resolve();
    await commit.promise;
    order.push("commit");
    return result;
  });
  const prepared = transaction(
    async () => {
      await query(sql`SELECT 1`);
      order.push("callback");
      return "durable-intent";
    },
    { outermost: true }
  ).then((result) => {
    order.push("provider");
    return result;
  });
  try {
    await entered.promise;
    expect(order).toEqual(["callback"]);
  } finally {
    commit.resolve();
  }
  await expect(prepared).resolves.toBe("durable-intent");
  expect(order).toEqual(["callback", "commit", "provider"]);
});

test("an owning commit failure prevents the next provider phase", async () => {
  const effects = vi.fn<(value: unknown) => void>();
  boundary.outer.mockImplementation(async (run) => {
    await run({
      execute: boundary.transactionExecute,
      transaction: boundary.nested,
    });
    throw new Error("Synthetic commit failure");
  });
  await expect(
    transaction(async () => query(sql`SELECT 1`), { outermost: true }).then(
      effects
    )
  ).rejects.toThrow("Synthetic commit failure");
  expect(effects).not.toHaveBeenCalled();
});

test("an ordinary pooled query retains its SQL object and wraps the driver cause", async () => {
  const statement = sql`SELECT ${"synthetic-user"}`;
  const failure = new Error("Synthetic unbudgeted statement failure");
  boundary.rootExecute.mockRejectedValueOnce(failure);
  await expect(query(statement)).rejects.toMatchObject({
    name: "SqlError",
    cause: failure,
  });
  expect(boundary.rootExecute).toHaveBeenCalledExactlyOnceWith(statement);
  expect(boundary.transactionExecute).not.toHaveBeenCalled();
});

describe("explicit absolute database deadline", () => {
  beforeEach(() => {
    vi.useFakeTimers();
    vi.setSystemTime(1000);
  });

  test("a budgeted bare query fails before pooled execution", async () => {
    await expect(
      withDeadline(() => query(sql`SELECT 1`), 2000)
    ).rejects.toThrow("A top-level transaction is required.");
    expect(boundary.rootExecute).not.toHaveBeenCalled();
    expect(boundary.outer).not.toHaveBeenCalled();
  });

  test("each original statement retains parameters and refreshes remaining time after a provider phase", async () => {
    const first = sql`SELECT ${"synthetic-user"} AS user_id`;
    const second = sql`SELECT ${"synthetic-room"} AS room_id`;
    boundary.transactionExecute
      .mockResolvedValueOnce({ rows: [] })
      .mockResolvedValueOnce({ rows: [{ user_id: "synthetic-user" }] })
      .mockResolvedValueOnce({ rows: [] })
      .mockResolvedValueOnce({ rows: [{ room_id: "synthetic-room" }] });
    await withDeadline(
      () =>
        transaction(async () => {
          await expect(query(first)).resolves.toEqual([
            { user_id: "synthetic-user" },
          ]);
          // A mocked provider phase consumes the same absolute budget.
          vi.setSystemTime(1450);
          await expect(query(second)).resolves.toEqual([
            { room_id: "synthetic-room" },
          ]);
        }),
      2000
    );
    const dialect = new PgDialect();
    const statements = boundary.transactionExecute.mock.calls.map(
      ([statement]) => dialect.sqlToQuery(statement)
    );
    expect(
      statements.map(({ sql: text, params }) => ({ text, params }))
    ).toEqual([
      {
        text: "SELECT set_config('statement_timeout', $1, true)",
        params: ["1000"],
      },
      { text: "SELECT $1 AS user_id", params: ["synthetic-user"] },
      {
        text: "SELECT set_config('statement_timeout', $1, true)",
        params: ["550"],
      },
      { text: "SELECT $1 AS room_id", params: ["synthetic-room"] },
    ]);
    expect(boundary.transactionExecute.mock.calls[1]?.[0]).toBe(first);
    expect(boundary.transactionExecute.mock.calls[3]?.[0]).toBe(second);
    expect(boundary.rootExecute).not.toHaveBeenCalled();
  });

  test("nested savepoints retain the inherited deadline and restore the outer connection", async () => {
    await withDeadline(
      () =>
        transaction(async () => {
          await transaction(async () => {
            await withDeadline(() => query(sql`SELECT 1`), 9000);
          });
          vi.setSystemTime(1300);
          await query(sql`SELECT 2`);
        }),
      2000
    );
    const dialect = new PgDialect();
    expect(
      boundary.nestedExecute.mock.calls.map(([statement]) =>
        dialect.sqlToQuery(statement)
      )
    ).toMatchObject([
      {
        sql: "SELECT set_config('statement_timeout', $1, true)",
        params: ["1000"],
      },
      { sql: "SELECT 1", params: [] },
    ]);
    expect(
      boundary.transactionExecute.mock.calls.map(([statement]) =>
        dialect.sqlToQuery(statement)
      )
    ).toMatchObject([
      {
        sql: "SELECT set_config('statement_timeout', $1, true)",
        params: ["700"],
      },
      { sql: "SELECT 2", params: [] },
    ]);
    expect(boundary.nested).toHaveBeenCalledTimes(1);
  });

  test("an aborted context rejects before checkout and keeps the original reason", async () => {
    const cancelled = new Error("Synthetic cancellation");
    const controller = new AbortController();
    const effects = vi.fn<() => Promise<string>>(async () => "unexpected");
    await expect(
      withDeadline(
        () =>
          withSignal(controller.signal, async () => {
            controller.abort(cancelled);
            return transaction(effects);
          }),
        2000
      )
    ).rejects.toBe(cancelled);
    expect(boundary.outer).not.toHaveBeenCalled();
    expect(effects).not.toHaveBeenCalled();
  });

  test("late mocked checkout settles before rejection without entering the callback", async () => {
    const checkoutEntered = Promise.withResolvers<void>();
    const checkout = Promise.withResolvers<void>();
    const effects = vi.fn<() => Promise<string>>(async () => "unexpected");
    boundary.outer.mockImplementation(async (run) => {
      checkoutEntered.resolve();
      await checkout.promise;
      return run({
        execute: boundary.transactionExecute,
        transaction: boundary.nested,
      });
    });
    let settled = false;
    const result = withDeadline(() => transaction(effects), 2000).then(
      (value) => {
        settled = true;
        return value;
      },
      (error: unknown) => {
        settled = true;
        return error;
      }
    );
    await checkoutEntered.promise;
    await vi.advanceTimersByTimeAsync(1000);
    expect(settled).toBe(false);
    checkout.resolve();
    expect(await result).toBeInstanceOf(TimeoutError);
    expect(effects).not.toHaveBeenCalled();
    expect(boundary.transactionExecute).not.toHaveBeenCalled();
  });

  test("expiry before callback completion prevents the driver commit branch", async () => {
    const commit = vi.fn<() => void>();
    boundary.outer.mockImplementation(async (run) => {
      const result = await run({
        execute: boundary.transactionExecute,
        transaction: boundary.nested,
      });
      commit();
      return result;
    });
    await expect(
      withDeadline(
        () =>
          transaction(async () => {
            vi.setSystemTime(2000);
            return "synthetic-intent";
          }),
        2000
      )
    ).rejects.toBeInstanceOf(TimeoutError);
    expect(commit).not.toHaveBeenCalled();
    expect(boundary.transactionExecute).not.toHaveBeenCalled();
  });

  test("expiry while SET LOCAL settles prevents the actual statement", async () => {
    boundary.transactionExecute.mockImplementationOnce(async () => {
      vi.setSystemTime(2000);
      return { rows: [] };
    });
    await expect(
      withDeadline(() => transaction(() => query(sql`SELECT 1`)), 2000)
    ).rejects.toBeInstanceOf(TimeoutError);
    expect(boundary.transactionExecute).toHaveBeenCalledTimes(1);
    const statement = boundary.transactionExecute.mock.calls[0]?.[0];
    expect(statement && new PgDialect().sqlToQuery(statement)).toMatchObject({
      sql: "SELECT set_config('statement_timeout', $1, true)",
      params: ["1000"],
    });
  });

  test("cancellation while SET LOCAL settles keeps the first abort reason", async () => {
    const controller = new AbortController();
    const reason = new Error("Synthetic cancellation during SET LOCAL");
    boundary.transactionExecute.mockImplementationOnce(async () => {
      controller.abort(reason);
      vi.setSystemTime(2000);
      return { rows: [] };
    });
    await expect(
      withDeadline(
        () =>
          withSignal(controller.signal, () =>
            transaction(() => query(sql`SELECT 1`))
          ),
        2000
      )
    ).rejects.toBe(reason);
    expect(boundary.transactionExecute).toHaveBeenCalledTimes(1);
  });

  test("one remaining millisecond is positive and expiry never emits a zero timeout or SQL", async () => {
    await withDeadline(() => transaction(() => query(sql`SELECT 1`)), 1001);
    const first = boundary.transactionExecute.mock.calls[0]?.[0];
    expect(first && new PgDialect().sqlToQuery(first).params).toEqual(["1"]);
    boundary.transactionExecute.mockClear();
    await expect(
      withDeadline(
        () =>
          transaction(async () => {
            vi.setSystemTime(2000);
            return query(sql`SELECT 2`);
          }),
        2000
      )
    ).rejects.toBeInstanceOf(TimeoutError);
    expect(boundary.transactionExecute).not.toHaveBeenCalled();
  });

  test("a blocked mocked statement remains owned until settlement and cannot return late rows", async () => {
    const entered = Promise.withResolvers<void>();
    const statement = Promise.withResolvers<{
      rows: Record<string, unknown>[];
    }>();
    boundary.transactionExecute
      .mockResolvedValueOnce({ rows: [] })
      .mockImplementationOnce(() => {
        entered.resolve();
        return statement.promise;
      });
    let settled = false;
    const result = withDeadline(
      () => transaction(() => query(sql`SELECT 1`)),
      2000
    ).then(
      (value) => {
        settled = true;
        return value;
      },
      (error: unknown) => {
        settled = true;
        return error;
      }
    );
    await entered.promise;
    await vi.advanceTimersByTimeAsync(1000);
    expect(settled).toBe(false);
    statement.resolve({ rows: [{ sensitive: "late synthetic rows" }] });
    expect(await result).toBeInstanceOf(TimeoutError);
    expect(boundary.transactionExecute).toHaveBeenCalledTimes(2);
  });

  test("a late mocked commit is awaited and success is rejected after the deadline", async () => {
    const entered = Promise.withResolvers<void>();
    const commit = Promise.withResolvers<void>();
    boundary.outer.mockImplementation(async (run) => {
      const result = await run({
        execute: boundary.transactionExecute,
        transaction: boundary.nested,
      });
      entered.resolve();
      await commit.promise;
      return result;
    });
    let settled = false;
    const result = withDeadline(
      () => transaction(async () => "synthetic-intent"),
      2000
    ).then(
      (value) => {
        settled = true;
        return value;
      },
      (error: unknown) => {
        settled = true;
        return error;
      }
    );
    await entered.promise;
    await vi.advanceTimersByTimeAsync(1000);
    expect(settled).toBe(false);
    commit.resolve();
    expect(await result).toBeInstanceOf(TimeoutError);
  });

  test("a late mocked commit failure retains the original error", async () => {
    const failure = new Error("Synthetic commit outcome uncertain");
    boundary.outer.mockImplementation(async (run) => {
      await run({
        execute: boundary.transactionExecute,
        transaction: boundary.nested,
      });
      vi.setSystemTime(2000);
      throw failure;
    });
    await expect(
      withDeadline(() => transaction(async () => "synthetic-intent"), 2000)
    ).rejects.toBe(failure);
  });

  test("a mocked rollback stays owned and preserves the wrapped SQL failure", async () => {
    const failure = new Error("Synthetic statement failure");
    const entered = Promise.withResolvers<void>();
    const rollback = Promise.withResolvers<void>();
    boundary.transactionExecute
      .mockResolvedValueOnce({ rows: [] })
      .mockRejectedValueOnce(failure);
    boundary.outer.mockImplementation(async (run) => {
      try {
        return await run({
          execute: boundary.transactionExecute,
          transaction: boundary.nested,
        });
      } catch (error) {
        entered.resolve();
        await rollback.promise;
        throw error;
      }
    });
    let settled = false;
    const result = withDeadline(
      () => transaction(() => query(sql`SELECT 1`)),
      2000
    ).then(
      (value) => {
        settled = true;
        return value;
      },
      (error: unknown) => {
        settled = true;
        return error;
      }
    );
    await entered.promise;
    await vi.advanceTimersByTimeAsync(1000);
    expect(settled).toBe(false);
    rollback.resolve();
    const error = await result;
    expect(error).toBeInstanceOf(SqlError);
    expect(error).toHaveProperty("cause", failure);
  });

  test("SET LOCAL driver failure is wrapped and prevents the actual query", async () => {
    const failure = new Error("Synthetic SET LOCAL failure");
    boundary.transactionExecute.mockRejectedValueOnce(failure);
    await expect(
      withDeadline(() => transaction(() => query(sql`SELECT 1`)), 2000)
    ).rejects.toMatchObject({ name: "SqlError", cause: failure });
    expect(boundary.transactionExecute).toHaveBeenCalledTimes(1);
  });

  test("the inherited deadline is enforced even when its timer has not fired", async () => {
    await expect(
      withDeadline(
        () =>
          transaction(async () => {
            vi.setSystemTime(2000);
            operationSignal().throwIfAborted();
          }),
        2000
      )
    ).rejects.toBeInstanceOf(TimeoutError);
    expect(boundary.transactionExecute).not.toHaveBeenCalled();
  });
});
