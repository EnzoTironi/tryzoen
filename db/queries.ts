import { AsyncLocalStorage } from "node:async_hooks";
import type { SQL } from "drizzle-orm";
import { operationSignal } from "../server/operations/async";
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

/** Bound parameters stay separate from SQL; nested calls share the active transaction. */
export async function query<
  Row extends Record<string, unknown> = Record<string, unknown>,
>(statement: SQL): Promise<Row[]> {
  operationSignal().throwIfAborted();
  let rows: Row[];
  try {
    const result = await (transactions.getStore() ?? db).execute<Row>(
      statement
    );
    // oxlint-disable-next-line typescript/no-unsafe-type-assertion -- The schema or pinned SDK contract establishes this boundary.
    rows = result.rows as Row[];
  } catch (cause) {
    throw new SqlError(cause);
  }
  operationSignal().throwIfAborted();
  return rows;
}

/** Nested transactions use PostgreSQL savepoints and restore the outer context. */
export function transaction<Result>(
  run: () => Promise<Result>
): Promise<Result> {
  return (transactions.getStore() ?? db).transaction((tx) =>
    transactions.run(tx, async () => {
      const result = await run();
      operationSignal().throwIfAborted();
      return result;
    })
  );
}
