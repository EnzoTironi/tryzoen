/** Uses the public transaction guard with a mocked database driver and filesystem.
 * SQL/parameters and savepoint routing are verified; no database or files are erased. */
import { beforeEach, expect, test, vi } from "vitest";
import type { SQL } from "drizzle-orm";
import { PgDialect } from "drizzle-orm/pg-core";
import { transaction, TransactionBoundaryError, SqlError } from "@db/queries";
import type { eraseSessionSources } from "./session-files";
import { drainMemoryErasures } from "./erasure";

const boundary = vi.hoisted(() => {
  const execute =
    vi.fn<(statement: SQL) => Promise<{ rows: Record<string, unknown>[] }>>();
  const savepointExecute = vi.fn<typeof execute>();
  const savepoint =
    vi.fn<
      (
        run: (active: { execute: typeof execute }) => Promise<unknown>
      ) => Promise<unknown>
    >();
  const outer =
    vi.fn<
      (
        run: (active: {
          execute: typeof execute;
          transaction: typeof savepoint;
        }) => Promise<unknown>
      ) => Promise<unknown>
    >();
  return {
    execute,
    savepointExecute,
    savepoint,
    outer,
    rootExecute: vi.fn<typeof execute>(),
    rollback: vi.fn<() => void>(),
    erase: vi.fn<typeof eraseSessionSources>(),
    archiveRoot: vi.fn<() => string | undefined>(),
  };
});
vi.mock("../../db/index", () => ({
  db: { transaction: boundary.outer, execute: boundary.rootExecute },
}));
vi.mock("./session-files", () => ({ eraseSessionSources: boundary.erase }));
vi.mock("@shared/environment/env", () => ({
  env: {
    get ZOEN_SESSION_ARCHIVE_DIR() {
      return boundary.archiveRoot();
    },
  },
}));

const dialect = new PgDialect();
const root = "/synthetic-memory-archive";
const namespaceA = "10000000-0000-4000-8000-000000000001";
const namespaceB = "10000000-0000-4000-8000-000000000002";
const owner = "better-auth:synthetic-memory-owner";

beforeEach(() => {
  vi.resetAllMocks();
  boundary.execute.mockResolvedValue({ rows: [] });
  boundary.savepointExecute.mockResolvedValue({ rows: [] });
  boundary.rootExecute.mockRejectedValue(new Error("Unexpected root query"));
  boundary.erase.mockResolvedValue(undefined);
  boundary.archiveRoot.mockReturnValue(root);
  boundary.outer.mockImplementation(async (run) =>
    run({ execute: boundary.execute, transaction: boundary.savepoint })
  );
  boundary.savepoint.mockImplementation(async (run) => {
    try {
      return await run({ execute: boundary.savepointExecute });
    } catch (error) {
      boundary.rollback();
      throw error;
    }
  });
});

function statements(execute: typeof boundary.execute) {
  return execute.mock.calls.map(([statement]) => {
    const compiled = dialect.sqlToQuery(statement);
    return {
      sql: compiled.sql.replace(/\s+/gu, " ").trim(),
      params: compiled.params,
    };
  });
}

function candidate(
  namespaceId = namespaceA,
  ownerUserId: string | null = owner,
  erasureFailures = 0
) {
  boundary.execute.mockResolvedValueOnce({
    rows: [{ namespaceId, ownerUserId, erasureFailures }],
  });
}

test("nested entry rejects before querying, opening a savepoint, erasing, or acknowledging", async () => {
  candidate();
  await transaction(async () => {
    await expect(drainMemoryErasures()).rejects.toBeInstanceOf(
      TransactionBoundaryError
    );
  });
  expect(boundary.outer).toHaveBeenCalledTimes(1);
  expect(boundary.savepoint).not.toHaveBeenCalled();
  expect(boundary.execute).not.toHaveBeenCalled();
  expect(boundary.savepointExecute).not.toHaveBeenCalled();
  expect(boundary.rootExecute).not.toHaveBeenCalled();
  expect(boundary.archiveRoot).not.toHaveBeenCalled();
  expect(boundary.erase).not.toHaveBeenCalled();
});

test("top-level empty work returns without filesystem or acknowledgement effects", async () => {
  await expect(drainMemoryErasures()).resolves.toEqual({ cleared: 0 });
  expect(boundary.outer).toHaveBeenCalledTimes(1);
  expect(boundary.savepoint).not.toHaveBeenCalled();
  expect(boundary.erase).not.toHaveBeenCalled();
  const selected = statements(boundary.execute);
  expect(selected).toHaveLength(1);
  expect(selected[0]?.sql).toContain("LIMIT 1 FOR UPDATE SKIP LOCKED");
  expect(selected[0]?.params).toEqual([]);
});

test("success erases first, then locks its owner and acknowledges only its exact namespace and pending file-memory ledger", async () => {
  candidate();
  await expect(drainMemoryErasures()).resolves.toEqual({ cleared: 1 });
  expect(boundary.erase).toHaveBeenCalledExactlyOnceWith(root, namespaceA);
  expect(boundary.outer).toHaveBeenCalledTimes(2);
  expect(boundary.savepoint).toHaveBeenCalledTimes(1);
  const [eraseOrder] = boundary.erase.mock.invocationCallOrder;
  const [acknowledgementOrder] =
    boundary.savepointExecute.mock.invocationCallOrder;
  if (eraseOrder === undefined || acknowledgementOrder === undefined)
    throw new Error("Expected both filesystem completion and acknowledgement");
  expect(eraseOrder).toBeLessThan(acknowledgementOrder);
  expect(statements(boundary.savepointExecute)).toEqual([
    {
      sql: "SELECT id FROM account_deletion_requests WHERE user_id=$1 FOR UPDATE",
      params: [owner],
    },
    {
      sql: "DELETE FROM workspace_memory_erasure WHERE namespace_id=$1",
      params: [namespaceA],
    },
    {
      sql: "UPDATE account_deletion_ledger l SET status = 'erased' FROM account_deletion_requests r WHERE l.request_id = r.id AND r.user_id = $1 AND l.surface = 'file_memory' AND l.status = 'pending_external' AND NOT EXISTS (SELECT 1 FROM workspace_memory_erasure WHERE owner_user_id = $2)",
      params: [owner, owner],
    },
  ]);
  expect(boundary.rollback).not.toHaveBeenCalled();
  expect(boundary.rootExecute).not.toHaveBeenCalled();
});

test("an ownerless receipt clears only the exact namespace without touching account ledgers", async () => {
  candidate(namespaceB, null);
  await expect(drainMemoryErasures()).resolves.toEqual({ cleared: 1 });
  expect(boundary.erase).toHaveBeenCalledExactlyOnceWith(root, namespaceB);
  expect(statements(boundary.savepointExecute)).toEqual([
    {
      sql: "DELETE FROM workspace_memory_erasure WHERE namespace_id=$1",
      params: [namespaceB],
    },
  ]);
});

test("missing archive configuration retains the receipt and schedules retry without erasing or acknowledging", async () => {
  candidate();
  boundary.archiveRoot.mockReturnValue(undefined);
  await expect(drainMemoryErasures()).rejects.toMatchObject({
    message: "Memory erasure failed for 1 partition(s); 0 cleared.",
    errors: [expect.objectContaining({ reason: "unconfigured" })],
  });
  expect(boundary.erase).not.toHaveBeenCalled();
  expect(boundary.savepointExecute).not.toHaveBeenCalled();
  const retry = statements(boundary.execute)[1];
  expect(retry?.sql).toContain("erasure_failures=erasure_failures+1");
  expect(retry?.params).toEqual([60, namespaceA]);
});

test.each([
  [0, 60],
  [3, 480],
  [6, 3600],
  [20, 3600],
])(
  "filesystem failure at retry count %i retains the exact receipt with %i-second backoff",
  async (failures, seconds) => {
    candidate(namespaceA, owner, failures);
    const failure = new Error("Synthetic partial filesystem completion");
    boundary.erase.mockRejectedValueOnce(failure);
    await expect(drainMemoryErasures()).rejects.toMatchObject({
      errors: [failure],
    });
    expect(boundary.rollback).toHaveBeenCalledTimes(1);
    expect(boundary.savepointExecute).not.toHaveBeenCalled();
    expect(statements(boundary.execute)[1]).toEqual({
      sql: "UPDATE workspace_memory_erasure SET erasure_failures=erasure_failures+1, last_failed_at=clock_timestamp(), available_at=clock_timestamp()+$1 * interval '1 second' WHERE namespace_id=$2",
      params: [seconds, namespaceA],
    });
  }
);

test("a failed receipt backs off independently while another account's receipt still completes", async () => {
  candidate(namespaceA, "better-auth:synthetic-damaged-owner");
  boundary.execute.mockResolvedValueOnce({ rows: [] });
  candidate(namespaceB, "better-auth:synthetic-healthy-owner");
  const failure = new Error("Synthetic filesystem failure");
  boundary.erase.mockRejectedValueOnce(failure);
  await expect(drainMemoryErasures()).rejects.toMatchObject({
    message: "Memory erasure failed for 1 partition(s); 1 cleared.",
    errors: [failure],
  });
  expect(boundary.erase.mock.calls).toEqual([
    [root, namespaceA],
    [root, namespaceB],
  ]);
  expect(statements(boundary.execute)[1]?.params).toEqual([60, namespaceA]);
  expect(
    statements(boundary.savepointExecute).map((statement) => statement.params)
  ).toEqual([
    ["better-auth:synthetic-healthy-owner"],
    [namespaceB],
    [
      "better-auth:synthetic-healthy-owner",
      "better-auth:synthetic-healthy-owner",
    ],
  ]);
});

test("an acknowledgement failure rolls back the savepoint and retains a retry even after filesystem completion", async () => {
  candidate();
  boundary.savepointExecute
    .mockResolvedValueOnce({ rows: [] })
    .mockResolvedValueOnce({ rows: [] })
    .mockRejectedValueOnce(
      new Error("Synthetic ledger acknowledgement failure")
    );
  await expect(drainMemoryErasures()).rejects.toMatchObject({
    errors: [expect.any(SqlError)],
  });
  expect(boundary.erase).toHaveBeenCalledExactlyOnceWith(root, namespaceA);
  expect(boundary.rollback).toHaveBeenCalledTimes(1);
  expect(statements(boundary.execute)[1]?.params).toEqual([60, namespaceA]);

  candidate();
  await expect(drainMemoryErasures()).resolves.toEqual({ cleared: 1 });
  expect(boundary.erase).toHaveBeenCalledTimes(2);
  expect(statements(boundary.savepointExecute).at(-1)?.params).toEqual([
    owner,
    owner,
  ]);
});

test("one drain keeps the existing five-receipt bound", async () => {
  for (let count = 0; count < 5; count++) candidate(namespaceA, null);
  await expect(drainMemoryErasures()).resolves.toEqual({ cleared: 5 });
  expect(boundary.outer).toHaveBeenCalledTimes(5);
  expect(boundary.erase).toHaveBeenCalledTimes(5);
  expect(boundary.execute).toHaveBeenCalledTimes(5);
});
