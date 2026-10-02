import { afterEach, beforeEach, expect, test, vi } from "vitest";
import { transaction, TransactionBoundaryError } from "@db/queries";
import {
  operationDeadline,
  operationSignal,
  TimeoutError,
  withDeadline,
} from "../operations/async";
import {
  validateMatrixDeadline,
  validateMatrixLimit,
  withMatrixTransaction,
} from "./deadline";

const driver = vi.hoisted(() => ({
  execute: vi.fn<() => Promise<{ rows: unknown[] }>>(),
  transaction:
    vi.fn<(run: (tx: unknown) => Promise<unknown>) => Promise<unknown>>(),
}));
vi.mock("../../db/index", () => ({ db: driver }));

beforeEach(() => {
  vi.resetAllMocks();
  driver.execute.mockResolvedValue({ rows: [] });
  driver.transaction.mockImplementation(async (run) => run(driver));
});
afterEach(() => {
  vi.restoreAllMocks();
});

test.each([NaN, Infinity, -1, 1.5, Number.MAX_SAFE_INTEGER + 1])(
  "invalid Matrix deadline %s fails before transaction or callback",
  (deadline) => {
    const run = vi.fn<() => Promise<void>>(async () => undefined);
    expect(() => withMatrixTransaction(deadline, run)).toThrow(RangeError);
    expect(driver.transaction).not.toHaveBeenCalled();
    expect(run).not.toHaveBeenCalled();
  }
);

test("Matrix entry cap is thirty seconds; generic scopes may be longer", async () => {
  const now = Date.now();
  vi.spyOn(Date, "now").mockReturnValue(now);
  expect(() => {
    validateMatrixDeadline(now + 30_000);
  }).not.toThrow();
  expect(() => {
    validateMatrixDeadline(now + 30_001);
  }).toThrow(RangeError);
  await withDeadline(async () => {
    expect(operationDeadline()).toBe(now + 60_000);
  }, now + 60_000);
});

test.each([NaN, Infinity, -1, 1.5, 6])("room item cap rejects %s", (limit) => {
  expect(() => {
    validateMatrixLimit(limit, 5);
  }).toThrow(RangeError);
});

test("owner-specific item caps include zero without broadening room cap", () => {
  expect(() => {
    validateMatrixLimit(0, 5);
  }).not.toThrow();
  expect(() => {
    validateMatrixLimit(5, 5);
  }).not.toThrow();
  expect(() => {
    validateMatrixLimit(10, 10);
  }).not.toThrow();
  expect(() => {
    validateMatrixLimit(25, 25);
  }).not.toThrow();
  expect(() => {
    validateMatrixLimit(10, 5);
  }).toThrow(RangeError);
});

test("expired Matrix phase does not check out a transaction", async () => {
  const now = Date.now();
  vi.spyOn(Date, "now").mockReturnValue(now);
  const run = vi.fn<() => Promise<void>>(async () => undefined);
  await expect(withMatrixTransaction(now, run)).rejects.toBeInstanceOf(
    TimeoutError
  );
  expect(driver.transaction).not.toHaveBeenCalled();
  expect(run).not.toHaveBeenCalled();
});

test("Matrix phases inherit the earlier absolute budget and restore its scope", async () => {
  const now = Date.now();
  vi.spyOn(Date, "now").mockReturnValue(now);
  await withDeadline(async () => {
    await withMatrixTransaction(now + 10_000, async () => {
      expect(operationDeadline()).toBe(now + 5_000);
    });
    expect(operationDeadline()).toBe(now + 5_000);
  }, now + 5_000);
  expect(operationDeadline()).toBeUndefined();
  expect(driver.transaction).toHaveBeenCalledTimes(1);
});

test("Matrix phase rejects an ambient transaction before callback or savepoint", async () => {
  const run = vi.fn<() => Promise<void>>(async () => undefined);
  await transaction(async () => {
    await expect(
      withMatrixTransaction(Date.now() + 1_000, run)
    ).rejects.toBeInstanceOf(TransactionBoundaryError);
  });
  expect(driver.transaction).toHaveBeenCalledTimes(1);
  expect(run).not.toHaveBeenCalled();
});

test("expired phase awaits its owning commit before reporting timeout", async () => {
  const enteredCommit = Promise.withResolvers<void>();
  const commit = Promise.withResolvers<void>();
  const now = Date.now();
  let clock = now;
  let signal: AbortSignal | undefined;
  let settled = false;
  vi.spyOn(Date, "now").mockImplementation(() => clock);
  driver.transaction.mockImplementation(async (run) => {
    const result = await run(driver);
    enteredCommit.resolve();
    await commit.promise;
    return result;
  });
  const result = withMatrixTransaction(now + 1_000, async () => {
    signal = operationSignal();
    return "committed";
  });
  const observed = result.then(
    () => {
      settled = true;
      return undefined;
    },
    (error: unknown) => {
      settled = true;
      return error;
    }
  );
  try {
    await enteredCommit.promise;
    clock = now + 1_000;
    expect(settled).toBe(false);
  } finally {
    commit.resolve();
  }
  expect(await observed).toBeInstanceOf(TimeoutError);
  expect(signal?.aborted).toBe(true);
  expect(settled).toBe(true);
});
