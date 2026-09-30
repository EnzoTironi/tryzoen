import { beforeEach, expect, test, vi } from "vitest";
import { sql } from "drizzle-orm";
import { query, transaction } from "./queries";

const boundary = vi.hoisted(() => {
  const transactionExecute = vi.fn<() => Promise<{ rows: never[] }>>();
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
    rootExecute: vi.fn<() => Promise<{ rows: never[] }>>(),
    transactionExecute,
    nestedExecute: vi.fn<() => Promise<{ rows: never[] }>>(),
  };
});
vi.mock("./index", () => ({
  db: { transaction: boundary.outer, execute: boundary.rootExecute },
}));

beforeEach(() => {
  vi.clearAllMocks();
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
