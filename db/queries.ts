import { AsyncLocalStorage } from "node:async_hooks";
import { sql } from "drizzle-orm";
import type { SQL } from "drizzle-orm";
import {
  operationDeadline,
  operationSignal,
  TimeoutError,
} from "../server/operations/async";
import { db } from "./index";

type Transaction = Parameters<Parameters<typeof db.transaction>[0]>[0];
const transactions = new AsyncLocalStorage<Transaction>();

export class SqlError extends Error {
  readonly _tag = "SqlError";
  constructor(cause: unknown) {
    super("The database operation failed.", { cause });
    this.name = "SqlError";
  }
}

export class TransactionBoundaryError extends Error {
  readonly _tag = "TransactionBoundaryError";
  constructor() {
    super("A top-level transaction is required.");
    this.name = "TransactionBoundaryError";
  }
}

export function requireDatabaseTransaction() {
  if (!transactions.getStore()) throw new TransactionBoundaryError();
}

/**
 * Bound parameters stay separate from SQL; nested calls share the active transaction.
 * Budgeted callers serialize statements on that transaction's connection.
 */
export async function query<
  Row extends Record<string, unknown> = Record<string, unknown>,
>(statement: SQL): Promise<Row[]> {
  operationSignal().throwIfAborted();
  const active = transactions.getStore();
  const deadline = operationDeadline();
  if (deadline !== undefined) {
    if (!active) throw new TransactionBoundaryError();
    const remaining = deadline - Date.now();
    operationSignal().throwIfAborted();
    // Zero disables PostgreSQL statement_timeout; an elapsed budget fails closed.
    if (remaining <= 0) throw new TimeoutError();
    try {
      await active.execute(
        sql`SELECT set_config('statement_timeout', ${String(remaining)}, true)`
      );
    } catch (cause) {
      throw new SqlError(cause);
    }
    operationSignal().throwIfAborted();
  }
  let rows: Row[];
  try {
    const result = await (active ?? db).execute<Row>(statement);
    // oxlint-disable-next-line typescript/no-unsafe-type-assertion -- The schema or pinned SDK contract establishes this boundary.
    rows = result.rows as Row[];
  } catch (cause) {
    throw new SqlError(cause);
  }
  operationSignal().throwIfAborted();
  return rows;
}

/** Nested transactions use PostgreSQL savepoints and restore the outer context. */
export async function transaction<Result>(
  run: () => Promise<Result>,
  options?: { readonly outermost: true }
): Promise<Result> {
  const active = transactions.getStore();
  if (options?.outermost && active) {
    return Promise.reject(new TransactionBoundaryError());
  }
  operationSignal().throwIfAborted();
  return (active ?? db).transaction((tx) =>
    transactions.run(tx, async () => {
      operationSignal().throwIfAborted();
      const result = await run();
      operationSignal().throwIfAborted();
      return result;
    })
  );
}
