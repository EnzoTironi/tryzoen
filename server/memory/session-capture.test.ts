/** Exercises the public AsyncLocalStorage transaction guard with mocked SQL,
 * source files and engine. This does not qualify PostgreSQL locks or provider atomicity. */
import { beforeEach, expect, test, vi } from "vitest";
import { createHash } from "node:crypto";
import type { SQL } from "drizzle-orm";
import { PgDialect } from "drizzle-orm/pg-core";
import { transaction, TransactionBoundaryError, SqlError } from "@db/queries";
import type { memoryNamespace } from "./namespace";
import type { openMemoryEngine } from "./ai-memory/engine";
import type { ingestSessionSource } from "./ai-memory/session-ingestion";
import type {
  acceptMemoryCorpus,
  memoryCorpusInitialized,
} from "@db/services/memory-corpora";
import { sessionSourceSchema, type writeSessionSource } from "./session-files";
import { captureSessionSource, drainSessionSources } from "./session-capture";

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
    namespace: vi.fn<typeof memoryNamespace>(),
    write: vi.fn<typeof writeSessionSource>(),
    open: vi.fn<
      (
        ...input: Parameters<typeof openMemoryEngine>
      ) => Promise<AsyncDisposable>
    >(),
    ingest: vi.fn<typeof ingestSessionSource>(),
    initialized: vi.fn<typeof memoryCorpusInitialized>(),
    accept: vi.fn<typeof acceptMemoryCorpus>(),
    dispose: vi.fn<() => Promise<void>>(),
    archiveRoot: vi.fn<() => string | undefined>(),
    binary: vi.fn<() => string | undefined>(),
  };
});
vi.mock("../../db/index", () => ({
  db: { transaction: boundary.outer, execute: boundary.rootExecute },
}));
vi.mock("./namespace", () => ({ memoryNamespace: boundary.namespace }));
vi.mock("./session-files", async (original) => ({
  ...(await original<typeof import("./session-files")>()),
  writeSessionSource: boundary.write,
}));
vi.mock("./ai-memory/engine", () => ({ openMemoryEngine: boundary.open }));
vi.mock("./ai-memory/session-ingestion", () => ({
  ingestSessionSource: boundary.ingest,
}));
vi.mock("@db/services/memory-corpora", () => ({
  memoryCorpusInitialized: boundary.initialized,
  acceptMemoryCorpus: boundary.accept,
}));
vi.mock("@shared/environment/env", () => ({
  env: {
    get ZOEN_SESSION_ARCHIVE_DIR() {
      return boundary.archiveRoot();
    },
    get ZOEN_AI_MEMORY_BINARY() {
      return boundary.binary();
    },
  },
}));

const dialect = new PgDialect();
const root = "/synthetic-session-archive";
const binary = "/synthetic-ai-memory";
const namespaceA = "10000000-0000-4000-8000-000000000001";
const namespaceB = "10000000-0000-4000-8000-000000000002";
const actor = {
  userId: "better-auth:synthetic-session-owner",
  workspaceId: "synthetic-workspace",
  authSessionId: "synthetic-auth-session",
};
const engine = { [Symbol.asyncDispose]: boundary.dispose };
const source = sessionSourceSchema.parse({
  version: 2,
  source: "eve",
  sessionId: "synthetic-session",
  eventId: "synthetic-source-a",
  occurredAt: null,
  kind: "message.received",
  turnId: "synthetic-turn",
  sequence: 1,
  stepIndex: null,
  role: "user",
  settlement: null,
  text: "Synthetic retained source",
});

beforeEach(() => {
  vi.resetAllMocks();
  boundary.execute.mockResolvedValue({ rows: [] });
  boundary.savepointExecute.mockResolvedValue({ rows: [] });
  boundary.rootExecute.mockRejectedValue(new Error("Unexpected root query"));
  boundary.archiveRoot.mockReturnValue(root);
  boundary.binary.mockReturnValue(undefined);
  boundary.write.mockResolvedValue("/synthetic-source.jsonl");
  boundary.open.mockResolvedValue(engine);
  boundary.ingest.mockResolvedValue(undefined);
  boundary.initialized.mockResolvedValue(true);
  boundary.accept.mockResolvedValue(undefined);
  boundary.dispose.mockResolvedValue(undefined);
  boundary.namespace.mockResolvedValue({
    id: namespaceA,
    enabled: true,
    workspaceEnabled: true,
    scopeKey: null,
    pendingOperation: null,
    pendingHash: null,
  });
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
function record(eventId = source.eventId, captureSequence = 17) {
  const payload = sessionSourceSchema.parse({ ...source, eventId });
  return {
    eventId,
    captureSequence,
    payload,
    digest: createHash("sha256").update(JSON.stringify(payload)).digest("hex"),
  };
}
function head(
  namespaceId = namespaceA,
  deliveryFailures = 0,
  eventId = source.eventId
) {
  boundary.execute.mockResolvedValueOnce({
    rows: [{ namespaceId, eventId, deliveryFailures }],
  });
}
function batch(
  records: ReturnType<typeof record>[],
  acknowledgements = records.length
) {
  boundary.savepointExecute.mockResolvedValueOnce({ rows: records });
  for (let count = 0; count < acknowledgements; count++)
    boundary.savepointExecute.mockResolvedValueOnce({ rows: [] });
}
function assertNoArchiveEffects() {
  expect(boundary.write).not.toHaveBeenCalled();
  expect(boundary.open).not.toHaveBeenCalled();
  expect(boundary.ingest).not.toHaveBeenCalled();
  expect(boundary.initialized).not.toHaveBeenCalled();
  expect(boundary.accept).not.toHaveBeenCalled();
  expect(boundary.dispose).not.toHaveBeenCalled();
}

test("nested drain rejects before candidate SQL, savepoints, file writes, engine I/O or ACK", async () => {
  boundary.binary.mockReturnValue(binary);
  head();
  await transaction(async () => {
    await expect(drainSessionSources()).rejects.toBeInstanceOf(
      TransactionBoundaryError
    );
  });
  expect(boundary.outer).toHaveBeenCalledTimes(1);
  expect(boundary.savepoint).not.toHaveBeenCalled();
  expect(boundary.execute).not.toHaveBeenCalled();
  expect(boundary.savepointExecute).not.toHaveBeenCalled();
  expect(boundary.rootExecute).not.toHaveBeenCalled();
  assertNoArchiveEffects();
});

test("DB-only capture remains composable inside an enclosing transaction without archive I/O", async () => {
  boundary.savepointExecute
    .mockResolvedValueOnce({ rows: [{ session_id: source.sessionId }] })
    .mockResolvedValueOnce({ rows: [] })
    .mockResolvedValueOnce({ rows: [{ count: "0", bytes: "0" }] });
  await transaction(async () => captureSessionSource(actor, source));
  expect(boundary.outer).toHaveBeenCalledTimes(1);
  expect(boundary.savepoint).toHaveBeenCalledTimes(1);
  expect(boundary.namespace).toHaveBeenCalledExactlyOnceWith(actor);
  const captured = statements(boundary.savepointExecute);
  expect(captured).toHaveLength(4);
  expect(captured[0]?.params).toEqual([
    source.sessionId,
    actor.workspaceId,
    actor.userId,
  ]);
  expect(captured[3]?.sql).toContain("INSERT INTO memory_session_sources");
  expect(captured[3]?.params).toEqual([
    namespaceA,
    source.eventId,
    record().digest,
    JSON.stringify(source),
    namespaceA,
  ]);
  expect(boundary.execute).not.toHaveBeenCalled();
  assertNoArchiveEffects();
});

test("an unconfigured archive remains a no-op without entering SQL", async () => {
  boundary.archiveRoot.mockReturnValue(undefined);
  await expect(drainSessionSources()).resolves.toEqual({
    stored: 0,
    configured: false,
  });
  expect(boundary.outer).not.toHaveBeenCalled();
  expect(boundary.execute).not.toHaveBeenCalled();
  assertNoArchiveEffects();
});

test("configured empty work preserves the current membership checks and skip-locked selection", async () => {
  await expect(drainSessionSources()).resolves.toEqual({
    stored: 0,
    configured: true,
  });
  expect(boundary.outer).toHaveBeenCalledTimes(1);
  expect(boundary.savepoint).not.toHaveBeenCalled();
  const selected = statements(boundary.execute);
  expect(selected).toHaveLength(1);
  expect(selected[0]?.sql).toContain("JOIN workspace_memberships");
  expect(selected[0]?.sql).toContain("FROM organization_memberships");
  expect(selected[0]?.sql).toContain("FOR UPDATE OF n, s SKIP LOCKED");
  assertNoArchiveEffects();
});

test("file-only delivery preserves exact source coordinates and ACKs each source only after its file write", async () => {
  const first = record();
  const second = record("synthetic-source-b", 18);
  head();
  batch([first, second]);
  await expect(drainSessionSources()).resolves.toEqual({
    stored: 2,
    configured: true,
  });
  expect(boundary.write.mock.calls).toEqual([
    [root, namespaceA, first.payload, first.captureSequence],
    [root, namespaceA, second.payload, second.captureSequence],
  ]);
  expect(boundary.open).not.toHaveBeenCalled();
  expect(boundary.ingest).not.toHaveBeenCalled();
  expect(boundary.accept).not.toHaveBeenCalled();
  const delivered = statements(boundary.savepointExecute);
  expect(delivered[0]?.sql).toContain(
    "ORDER BY capture_sequence LIMIT 25 FOR UPDATE"
  );
  expect(delivered.slice(1)).toEqual(
    [first, second].map((item) => ({
      sql: "UPDATE memory_session_sources SET payload = NULL, stored_at = now() WHERE namespace_id = $1 AND event_id = $2",
      params: [namespaceA, item.eventId],
    }))
  );
  for (const [
    index,
    order,
  ] of boundary.write.mock.invocationCallOrder.entries()) {
    const acknowledgement =
      boundary.savepointExecute.mock.invocationCallOrder[index + 1];
    if (acknowledgement === undefined)
      throw new Error("Expected source acknowledgement");
    expect(order).toBeLessThan(acknowledgement);
  }
  expect(statements(boundary.execute)[1]?.params).toEqual([namespaceA]);
});

test.each([false, true])(
  "engine delivery preserves corpus admission requireExisting=%s and closes the engine",
  async (initialized) => {
    const item = record();
    boundary.binary.mockReturnValue(binary);
    boundary.initialized.mockResolvedValue(initialized);
    head();
    batch([item]);
    await expect(drainSessionSources()).resolves.toEqual({
      stored: 1,
      configured: true,
    });
    expect(boundary.open).toHaveBeenCalledExactlyOnceWith(
      binary,
      root,
      namespaceA,
      "ai-memory",
      { requireExisting: initialized }
    );
    expect(boundary.ingest).toHaveBeenCalledExactlyOnceWith(
      engine,
      namespaceA,
      item.payload
    );
    expect(boundary.accept).toHaveBeenCalledExactlyOnceWith(
      namespaceA,
      "ai-memory"
    );
    expect(boundary.dispose).toHaveBeenCalledTimes(1);
    const [writeOrder] = boundary.write.mock.invocationCallOrder;
    const [ingestOrder] = boundary.ingest.mock.invocationCallOrder;
    const acknowledgement =
      boundary.savepointExecute.mock.invocationCallOrder[1];
    if (
      writeOrder === undefined ||
      ingestOrder === undefined ||
      acknowledgement === undefined
    )
      throw new Error("Expected file, ingestion and acknowledgement calls");
    expect(writeOrder).toBeLessThan(ingestOrder);
    expect(ingestOrder).toBeLessThan(acknowledgement);
  }
);

test("engine startup failure retains queued sources without file writes or ACK", async () => {
  boundary.binary.mockReturnValue(binary);
  const failure = new Error("Synthetic missing accepted corpus");
  boundary.open.mockRejectedValueOnce(failure);
  head();
  batch([record()], 0);
  await expect(drainSessionSources()).rejects.toMatchObject({
    errors: [failure],
  });
  expect(boundary.write).not.toHaveBeenCalled();
  expect(boundary.ingest).not.toHaveBeenCalled();
  expect(boundary.accept).not.toHaveBeenCalled();
  expect(boundary.dispose).not.toHaveBeenCalled();
  expect(statements(boundary.savepointExecute)).toHaveLength(1);
  expect(boundary.rollback).toHaveBeenCalledTimes(1);
});

test("a mismatched immutable source digest fails before file write or ACK", async () => {
  head();
  batch([{ ...record(), digest: "0".repeat(64) }], 0);
  await expect(drainSessionSources()).rejects.toMatchObject({
    errors: [
      expect.objectContaining({
        message: "Session source failed integrity verification.",
      }),
    ],
  });
  assertNoArchiveEffects();
  expect(statements(boundary.savepointExecute)).toHaveLength(1);
  expect(boundary.rollback).toHaveBeenCalledTimes(1);
});

test.each([
  [0, 60],
  [3, 480],
  [6, 3600],
  [20, 3600],
])(
  "file failure at count %i preserves namespace backoff %i and exact oldest-event retry",
  async (failures, seconds) => {
    head(namespaceA, failures);
    batch([record()], 0);
    const failure = new Error("Synthetic file write interruption");
    boundary.write.mockRejectedValueOnce(failure);
    await expect(drainSessionSources()).rejects.toMatchObject({
      errors: [failure],
    });
    expect(statements(boundary.savepointExecute)).toHaveLength(1);
    expect(boundary.rollback).toHaveBeenCalledTimes(1);
    const retries = statements(boundary.execute).slice(1, 3);
    expect(retries).toEqual([
      {
        sql: "UPDATE memory_session_sources SET available_at = statement_timestamp() + $1 * interval '1 second' WHERE namespace_id = $2 AND stored_at IS NULL",
        params: [seconds, namespaceA],
      },
      {
        sql: "UPDATE memory_session_sources SET delivery_failures = delivery_failures + 1, last_failed_at = clock_timestamp() WHERE namespace_id = $1 AND event_id = $2",
        params: [namespaceA, source.eventId],
      },
    ]);
  }
);

test("ingestion failure closes the engine and retains the source even after a successful file write", async () => {
  boundary.binary.mockReturnValue(binary);
  const failure = new Error("Synthetic engine ingestion failure");
  boundary.ingest.mockRejectedValueOnce(failure);
  head();
  batch([record()], 0);
  await expect(drainSessionSources()).rejects.toMatchObject({
    errors: [failure],
  });
  expect(boundary.write).toHaveBeenCalledTimes(1);
  expect(boundary.ingest).toHaveBeenCalledTimes(1);
  expect(boundary.accept).not.toHaveBeenCalled();
  expect(boundary.dispose).toHaveBeenCalledTimes(1);
  expect(statements(boundary.savepointExecute)).toHaveLength(1);
  expect(boundary.rollback).toHaveBeenCalledTimes(1);
});

test("ACK failure stays in the batch savepoint and leaves namespace retry outside it", async () => {
  boundary.binary.mockReturnValue(binary);
  head();
  batch([record()], 0);
  boundary.savepointExecute.mockRejectedValueOnce(
    new Error("Synthetic source ACK failure")
  );
  await expect(drainSessionSources()).rejects.toMatchObject({
    errors: [expect.any(SqlError)],
  });
  expect(boundary.write).toHaveBeenCalledTimes(1);
  expect(boundary.ingest).toHaveBeenCalledTimes(1);
  expect(boundary.dispose).toHaveBeenCalledTimes(1);
  expect(boundary.accept).not.toHaveBeenCalled();
  expect(boundary.rollback).toHaveBeenCalledTimes(1);
  expect(statements(boundary.savepointExecute)[1]?.params).toEqual([
    namespaceA,
    source.eventId,
  ]);
  expect(statements(boundary.execute)[1]?.params).toEqual([60, namespaceA]);
});

test("a failed namespace retains retry while a different namespace completes and both are excluded from this drain's later discovery", async () => {
  const failure = new Error("Synthetic account source failure");
  boundary.write.mockRejectedValueOnce(failure);
  head(namespaceA);
  boundary.execute
    .mockResolvedValueOnce({ rows: [] })
    .mockResolvedValueOnce({ rows: [] });
  head(namespaceB, 0, "synthetic-source-b");
  boundary.execute.mockResolvedValueOnce({ rows: [] });
  batch([record()], 0);
  batch([record("synthetic-source-b")]);
  await expect(drainSessionSources()).rejects.toMatchObject({
    message:
      "Session archive delivery failed for 1 account(s); 1 source(s) stored.",
    errors: [failure],
  });
  expect(boundary.write.mock.calls.map((call) => call[1])).toEqual([
    namespaceA,
    namespaceB,
  ]);
  const executed = statements(boundary.execute);
  expect(executed[3]?.params).toEqual([namespaceA]);
  expect(executed[5]?.params).toEqual([namespaceA, namespaceB]);
  expect(statements(boundary.savepointExecute).at(-1)?.params).toEqual([
    namespaceB,
    "synthetic-source-b",
  ]);
});

test("one drain retains the five-namespace work bound", async () => {
  for (let count = 1; count <= 5; count++) {
    const namespace = `10000000-0000-4000-8000-00000000000${count}`;
    head(namespace, 0, `synthetic-source-${count}`);
    boundary.execute.mockResolvedValueOnce({ rows: [] });
    batch([record(`synthetic-source-${count}`, count)]);
  }
  await expect(drainSessionSources()).resolves.toEqual({
    stored: 5,
    configured: true,
  });
  expect(boundary.outer).toHaveBeenCalledTimes(5);
  expect(boundary.savepoint).toHaveBeenCalledTimes(5);
  expect(boundary.write).toHaveBeenCalledTimes(5);
});
