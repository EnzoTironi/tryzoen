import { randomUUID } from "node:crypto";
import {
  chmod,
  glob,
  mkdir,
  readFile,
  rm,
  symlink,
  writeFile,
} from "node:fs/promises";
import { join } from "node:path";
import { Client } from "pg";
import { expect, test } from "vitest";
import { sql } from "drizzle-orm";
import { query, transaction, TransactionBoundaryError } from "@db/queries";
import { env } from "@shared/environment/env";
import { dbMigrationEnv } from "../../db/env/migration";
import type { HookEvent } from "eve/hooks";
import { privateMemoryFixture } from "./private-memory-fixture";
import {
  sessionSource,
  settledSessionSource,
  sessionSourceSchema,
} from "../../server/memory/session-files";
import { claimSession } from "../../db/services/sessions";
import { WorkspaceAccessDenied } from "../../server/workspaces/access";
import {
  captureSessionSource,
  drainSessionSources,
} from "../../server/memory/session-capture";
import {
  exportSessionSources,
  SessionArchiveUnavailable,
} from "../../server/memory/session-export";

const directory = env.ZOEN_SESSION_ARCHIVE_DIR;
if (!directory)
  throw new Error(
    "Configure the isolated private K3 journal root before running this suite"
  );

const source = (
  id: string = randomUUID(),
  text = "Synthetic club meets at Cedarfield."
): HookEvent<"message.received"> => ({
  type: "message.received",
  meta: { id, at: "2026-09-28T12:00:00.000Z" },
  data: { message: text, sequence: 0, turnId: "turn_0" },
});

test("resumed Eve turns with empty turn IDs have separate native receipts and do not block later sources", async () => {
  await using workspace = await privateMemoryFixture();
  const actor = workspace.personal;
  const sessionId = `session-${randomUUID()}`;
  await claimSession(actor, sessionId);
  for (const sequence of [3, 5]) {
    await captureSessionSource(
      actor,
      sessionSource(
        {
          type: "turn.completed",
          meta: { id: randomUUID(), at: "2026-09-28T12:00:00.000Z" },
          data: { turnId: "", sequence },
        },
        sessionId
      )
    );
    expect(await drainSessionSources()).toEqual({
      stored: 1,
      configured: true,
    });
  }
  await captureSessionSource(actor, sessionSource(source(), sessionId));
  expect(await drainSessionSources()).toEqual({ stored: 1, configured: true });
  const exported = await exportSessionSources(
    actor,
    sessionId,
    new AbortController().signal
  );
  expect((await exported.text()).trim().split("\n")).toHaveLength(3);
});

test("exports delivered sources only to their owner, including segmented text while memory is paused", async () => {
  await using workspace = await privateMemoryFixture();
  const actor = workspace.personal;
  const sessionId = `session-${randomUUID()}`;
  await claimSession(actor, sessionId);
  const event = source(randomUUID(), "Cedarfield ".repeat(600));
  await captureSessionSource(actor, sessionSource(event, sessionId));
  await expect(
    exportSessionSources(actor, sessionId, new AbortController().signal)
  ).rejects.toBeInstanceOf(SessionArchiveUnavailable);
  await drainSessionSources();
  await query(
    sql`UPDATE workspace_memory_namespace SET enabled = false WHERE workspace_id = ${actor.workspaceId}`
  );
  await expect(
    exportSessionSources(
      workspace.guestPersonal,
      sessionId,
      new AbortController().signal
    )
  ).rejects.toBeInstanceOf(WorkspaceAccessDenied);
  await expect(
    exportSessionSources(
      workspace.actor,
      sessionId,
      new AbortController().signal
    )
  ).rejects.toBeInstanceOf(WorkspaceAccessDenied);
  const response = await exportSessionSources(
    actor,
    sessionId,
    new AbortController().signal
  );
  expect(response.headers.get("cache-control")).toBe("private, no-store");
  const lines = (await response.text())
    .trim()
    .split("\n")
    .map((line) => sessionSourceSchema.parse(JSON.parse(line)));
  expect(lines.length).toBeGreaterThan(1);
  expect(lines.map((line) => line.text).join("")).toBe(event.data.message);
  expect(
    lines.every(
      (line) => line.sessionId === sessionId && line.eventId === event.meta.id
    )
  ).toBe(true);
});

test("stops streaming further private sources after membership revocation or request cancellation", async () => {
  await using workspace = await privateMemoryFixture();
  const actor = workspace.personal;
  const sessionId = `session-${randomUUID()}`;
  await claimSession(actor, sessionId);
  for (let index = 0; index < 3; index++)
    await captureSessionSource(actor, sessionSource(source(), sessionId));
  await drainSessionSources();
  const cancelled = new AbortController();
  const response = await exportSessionSources(
    actor,
    sessionId,
    cancelled.signal
  );
  if (!response.body) throw new Error("Expected archive stream");
  const reader = response.body.getReader();
  expect((await reader.read()).done).toBe(false);
  cancelled.abort(new Error("Download cancelled"));
  await expect(reader.read()).rejects.toThrow("Download cancelled");
  const active = await exportSessionSources(
    actor,
    sessionId,
    new AbortController().signal
  );
  if (!active.body) throw new Error("Expected archive stream");
  const activeReader = active.body.getReader();
  expect((await activeReader.read()).done).toBe(false);
  await query(
    sql`DELETE FROM workspace_memberships WHERE workspace_id = ${actor.workspaceId} AND user_id = ${actor.userId}`
  );
  await expect(activeReader.read()).rejects.toBeInstanceOf(
    WorkspaceAccessDenied
  );
});

test("rejects tampered content, public files and symlink replacements in a private archive", async () => {
  await using workspace = await privateMemoryFixture();
  const actor = workspace.personal;
  const sessionId = `session-${randomUUID()}`;
  await claimSession(actor, sessionId);
  const event = source();
  await captureSessionSource(actor, sessionSource(event, sessionId));
  await drainSessionSources();
  const [owner] = await query<{ id: string }>(
    sql`SELECT namespace_id AS id FROM workspace_memory_namespace WHERE workspace_id = ${actor.workspaceId}`
  );
  const paths = await Array.fromAsync(
    glob(join(directory, owner?.id ?? "missing", "raw/eve/**/*.jsonl"))
  );
  const path = paths[0];
  if (!path) throw new Error("Expected saved source");
  const original = await readFile(path, "utf8");
  await writeFile(path, original.replace("Cedarfield", "Tamperedxx"));
  await expect(
    exportSessionSources(actor, sessionId, new AbortController().signal)
  ).rejects.toThrow("receipt");
  await writeFile(path, original);
  await chmod(path, 0o644);
  await expect(
    exportSessionSources(actor, sessionId, new AbortController().signal)
  ).rejects.toThrow("verified");
  await rm(path);
  await symlink("/dev/null", path);
  await expect(
    exportSessionSources(actor, sessionId, new AbortController().signal)
  ).rejects.toThrow("unexpected file");
});

test("owns capture by persisted session and retires outbox content only after private disk delivery", async () => {
  await using workspace = await privateMemoryFixture();
  const actor = workspace.personal;
  const sessionId = `session-${randomUUID()}`;
  await claimSession(actor, sessionId);
  const event = source();
  await captureSessionSource(actor, sessionSource(event, sessionId));
  await captureSessionSource(actor, sessionSource(event, sessionId));
  await expect(
    captureSessionSource(
      workspace.guestPersonal,
      sessionSource(source(), sessionId)
    )
  ).rejects.toBeInstanceOf(WorkspaceAccessDenied);
  await expect(
    captureSessionSource(
      actor,
      sessionSource(source(event.meta.id, "Conflict"), sessionId)
    )
  ).rejects.toThrow("identity conflict");
  const [receipt] = await query<{
    namespaceId: string;
    captureSequence: string;
    payload: unknown;
    storedAt: string | null;
  }>(sql`
    SELECT namespace_id AS "namespaceId", capture_sequence::text AS "captureSequence", payload, stored_at AS "storedAt" FROM memory_session_sources WHERE event_id = ${event.meta.id}`);
  expect(receipt?.payload).toMatchObject({
    sessionId,
    role: "user",
    text: event.data.message,
  });
  expect(receipt?.storedAt).toBeNull();
  expect(await drainSessionSources()).toEqual({ stored: 1, configured: true });
  const [stored] = await query<{
    payload: unknown;
    storedAt: string | null;
  }>(sql`
    SELECT payload, stored_at AS "storedAt" FROM memory_session_sources WHERE event_id = ${event.meta.id}`);
  expect(stored?.payload).toBeNull();
  expect(stored?.storedAt).not.toBeNull();
  const paths = await Array.fromAsync(
    glob(
      join(directory, receipt?.namespaceId ?? "missing", "raw/eve/**/*.jsonl")
    )
  );
  expect(paths).toHaveLength(1);
  const saved: unknown = JSON.parse(
    await readFile(paths[0] ?? "missing", "utf8")
  );
  expect(saved).toMatchObject({
    sessionId,
    eventId: event.meta.id,
    occurredAt: event.meta.at,
    captureSequence: Number(receipt?.captureSequence),
  });
  await captureSessionSource(actor, sessionSource(event, sessionId));
  expect(await drainSessionSources()).toEqual({ stored: 0, configured: true });
  await query(
    sql`UPDATE workspace_memory_namespace SET enabled = false WHERE namespace_id = ${receipt?.namespaceId}`
  );
  await captureSessionSource(actor, sessionSource(source(), sessionId));
  expect(await drainSessionSources()).toEqual({ stored: 0, configured: true });
});

test("disk errors retain queued content for retry; account deletion fences sources and leaves an erasure receipt", async () => {
  await using workspace = await privateMemoryFixture();
  const actor = workspace.personal;
  const sessionId = `session-${randomUUID()}`;
  const event = source();
  await claimSession(actor, sessionId);
  await captureSessionSource(actor, sessionSource(event, sessionId));
  const [owner] = await query<{ id: string }>(
    sql`SELECT namespace_id AS id FROM workspace_memory_namespace WHERE workspace_id = ${actor.workspaceId} AND user_id = ${actor.userId}`
  );
  if (!owner) throw new Error("Expected namespace");
  const raw = join(directory, owner.id, "raw");
  await mkdir(raw, { recursive: true, mode: 0o700 });
  await writeFile(join(raw, "eve"), "Synthetic failed volume layout");
  await expect(drainSessionSources()).rejects.toHaveProperty(
    "errors.0.message",
    expect.stringMatching(/EEXIST|ENOTDIR/)
  );
  const [pending] = await query<{ payload: unknown }>(
    sql`SELECT payload FROM memory_session_sources WHERE event_id = ${event.meta.id}`
  );
  expect(pending?.payload).toMatchObject({ eventId: event.meta.id });
  await rm(join(raw, "eve"));
  expect(await drainSessionSources()).toEqual({ stored: 0, configured: true });
  await query(sql`UPDATE memory_session_sources SET available_at = now()
    WHERE namespace_id = ${owner.id} AND stored_at IS NULL`);
  expect(await drainSessionSources()).toEqual({ stored: 1, configured: true });
  await query(sql`DELETE FROM workspaces WHERE id = ${actor.workspaceId}`);
  expect(
    await query(
      sql`SELECT event_id FROM memory_session_sources WHERE namespace_id = ${owner.id}`
    )
  ).toEqual([]);
  expect(
    await query(
      sql`SELECT namespace_id FROM workspace_memory_erasure WHERE namespace_id = ${owner.id}`
    )
  ).toHaveLength(1);
  await expect(
    captureSessionSource(actor, sessionSource(source(), sessionId))
  ).rejects.toBeInstanceOf(WorkspaceAccessDenied);
});

test("drains at most 25 events per account and serializes capture identity inside its owner boundary", async () => {
  await using workspace = await privateMemoryFixture();
  const actor = workspace.personal;
  const sessionId = `session-${randomUUID()}`;
  await claimSession(actor, sessionId);
  const events = Array.from({ length: 26 }, () => source());
  await Promise.all(
    events.map((event) =>
      captureSessionSource(actor, sessionSource(event, sessionId))
    )
  );
  expect(await drainSessionSources()).toEqual({ stored: 25, configured: true });
  expect(await drainSessionSources()).toEqual({ stored: 1, configured: true });
});

test("revoked membership cannot deliver previously queued private sources", async () => {
  await using workspace = await privateMemoryFixture();
  const actor = workspace.personal;
  const sessionId = `session-${randomUUID()}`;
  const event = source();
  await claimSession(actor, sessionId);
  await captureSessionSource(actor, sessionSource(event, sessionId));
  await query(
    sql`DELETE FROM workspace_memberships WHERE workspace_id = ${actor.workspaceId} AND user_id = ${actor.userId}`
  );
  expect(await drainSessionSources()).toEqual({ stored: 0, configured: true });
  const [pending] = await query<{ payload: unknown }>(
    sql`SELECT payload FROM memory_session_sources WHERE event_id = ${event.meta.id}`
  );
  expect(pending?.payload).toMatchObject({ eventId: event.meta.id });
});

test("replays the same file when acknowledgement rolls back after filesystem delivery", async () => {
  await using workspace = await privateMemoryFixture();
  const actor = workspace.personal;
  const sessionId = `session-${randomUUID()}`;
  const event = source();
  await claimSession(actor, sessionId);
  await captureSessionSource(actor, sessionSource(event, sessionId));
  const namespace = await workspace.namespace(actor);
  const constraint = `journal_ack_${randomUUID().replaceAll("-", "")}`;
  const migrationUrl = new URL(dbMigrationEnv.DATABASE_URL_UNPOOLED);
  const applicationUrl = new URL(env.DATABASE_URL);
  if (
    migrationUrl.hostname !== applicationUrl.hostname ||
    migrationUrl.port !== applicationUrl.port ||
    migrationUrl.pathname !== "/companion_runtime_test" ||
    migrationUrl.username !== "zoen_migrator"
  )
    throw new Error(
      "The journal ACK fault requires the same isolated migration owner"
    );
  const migration = new Client({ connectionString: migrationUrl.toString() });
  await migration.connect();
  try {
    // Both interpolated values are generated UUIDs from the guarded fixture.
    // The runtime role retains only DML privileges throughout this fault.
    await migration.query(`ALTER TABLE memory_session_sources ADD CONSTRAINT "${constraint}"
      CHECK (namespace_id <> '${namespace.id}'::uuid OR stored_at IS NULL) NOT VALID`);
    try {
      await expect(drainSessionSources()).rejects.toBeInstanceOf(
        AggregateError
      );
    } finally {
      await migration.query(
        `ALTER TABLE memory_session_sources DROP CONSTRAINT "${constraint}"`
      );
    }
  } finally {
    await migration.end();
  }
  const [pending] = await query<{ namespaceId: string; payload: unknown }>(
    sql`SELECT namespace_id AS "namespaceId", payload FROM memory_session_sources WHERE event_id = ${event.meta.id}`
  );
  expect(pending?.payload).toMatchObject({ eventId: event.meta.id });
  const files = await Array.fromAsync(
    glob(
      join(directory, pending?.namespaceId ?? "missing", "raw/eve/**/*.jsonl")
    )
  );
  expect(files).toHaveLength(1);
  const before = await readFile(files[0] ?? "missing", "utf8");
  expect(await drainSessionSources()).toEqual({ stored: 0, configured: true });
  await query(
    sql`UPDATE memory_session_sources SET available_at = now() WHERE namespace_id=${namespace.id} AND stored_at IS NULL`
  );
  expect(await drainSessionSources()).toEqual({ stored: 1, configured: true });
  expect(await readFile(files[0] ?? "missing", "utf8")).toBe(before);
});

test("preserves long escaped text and rejects excess queued bytes atomically", async () => {
  await using workspace = await privateMemoryFixture();
  const actor = workspace.personal;
  const sessionId = `session-${randomUUID()}`;
  await claimSession(actor, sessionId);
  const text = "\u0001".repeat(1_000_000);
  const event = source(randomUUID(), text);
  await captureSessionSource(actor, sessionSource(event, sessionId));
  await expect(
    captureSessionSource(
      actor,
      sessionSource(source(randomUUID(), text), sessionId)
    )
  ).rejects.toThrow("archive is full");
  const receipts = await query<{ namespaceId: string }>(sql`
    SELECT namespace_id AS "namespaceId" FROM memory_session_sources WHERE payload->>'sessionId' = ${sessionId}`);
  expect(receipts).toHaveLength(1);
  expect(await drainSessionSources()).toEqual({ stored: 1, configured: true });
  const files = await Array.fromAsync(
    glob(
      join(
        directory,
        receipts[0]?.namespaceId ?? "missing",
        "raw/eve/**/*.jsonl"
      )
    )
  );
  expect(files).toHaveLength(1);
  const lines = (await readFile(files[0] ?? "missing", "utf8"))
    .trimEnd()
    .split("\n");
  expect(
    lines
      .map((line) => sessionSourceSchema.parse(JSON.parse(line)).text)
      .join("")
  ).toBe(text);
});

test("refuses to acknowledge a modified outbox payload", async () => {
  await using workspace = await privateMemoryFixture();
  const actor = workspace.personal;
  const sessionId = `session-${randomUUID()}`;
  const event = source();
  await claimSession(actor, sessionId);
  await captureSessionSource(actor, sessionSource(event, sessionId));
  await query(
    sql`UPDATE memory_session_sources SET payload = jsonb_set(payload, '{text}', '"Modified without receipt"') WHERE event_id = ${event.meta.id}`
  );
  await expect(drainSessionSources()).rejects.toMatchObject({
    errors: [
      expect.objectContaining({
        message: "Session source failed integrity verification.",
      }),
    ],
  });
  const [pending] = await query<{ storedAt: string | null }>(
    sql`SELECT stored_at AS "storedAt" FROM memory_session_sources WHERE event_id = ${event.meta.id}`
  );
  expect(pending?.storedAt).toBeNull();
});

test("retained session identity must match the queued source before journal publication", async () => {
  await using workspace = await privateMemoryFixture();
  const actor = workspace.personal;
  const sessionId = `receipt-session-${randomUUID()}`;
  const otherSessionId = `receipt-session-${randomUUID()}`;
  await claimSession(actor, sessionId);
  await claimSession(actor, otherSessionId);
  const event = source();
  await captureSessionSource(actor, sessionSource(event, sessionId));
  const namespace = await workspace.namespace(actor);
  await query(sql`UPDATE memory_session_sources SET session_id=${otherSessionId}
    WHERE namespace_id=${namespace.id} AND event_id=${event.meta.id}`);
  await expect(drainSessionSources()).rejects.toMatchObject({
    errors: [
      expect.objectContaining({
        message: "Session source failed integrity verification.",
      }),
    ],
  });
  await expect(
    captureSessionSource(actor, sessionSource(event, sessionId))
  ).rejects.toThrow("identity conflict");
  const [receipt] = await query<{
    storedAt: string | null;
    payload: unknown;
  }>(sql`
    SELECT stored_at AS "storedAt", payload FROM memory_session_sources
    WHERE namespace_id=${namespace.id} AND event_id=${event.meta.id}`);
  expect(receipt?.storedAt).toBeNull();
  expect(receipt?.payload).toMatchObject({ sessionId });
  expect(
    await Array.fromAsync(
      glob(join(directory, namespace.id, "raw/eve/**/*.jsonl"))
    )
  ).toEqual([]);
});

test("pausing memory fences delivery of already queued sources until it is resumed", async () => {
  await using workspace = await privateMemoryFixture();
  const actor = workspace.personal;
  const sessionId = `session-${randomUUID()}`;
  const event = source();
  await claimSession(actor, sessionId);
  await captureSessionSource(actor, sessionSource(event, sessionId));
  await query(
    sql`UPDATE workspace_memory_namespace SET enabled = false WHERE workspace_id = ${actor.workspaceId} AND user_id = ${actor.userId}`
  );
  expect(await drainSessionSources()).toEqual({ stored: 0, configured: true });
  await query(
    sql`UPDATE workspace_memory_namespace SET enabled = true WHERE workspace_id = ${actor.workspaceId} AND user_id = ${actor.userId}`
  );
  expect(await drainSessionSources()).toEqual({ stored: 1, configured: true });
});

test("accepted replies use the same ownership, replay and immutable-file guarantees", async () => {
  await using workspace = await privateMemoryFixture();
  const actor = workspace.personal;
  const sessionId = `session-${randomUUID()}`;
  const turn = { id: "settled-turn", sequence: 0 };
  await claimSession(actor, sessionId);
  const accepted = settledSessionSource({
    session: { id: sessionId, turn, auth: { current: null, initiator: null } },
    turn: { ...turn, input: [] },
    operationId: randomUUID(),
    messages: [{ role: "assistant", content: "Accepted Willowport reply." }],
  });
  expect(accepted).not.toBeNull();
  await captureSessionSource(actor, accepted);
  await captureSessionSource(actor, accepted);
  await expect(
    captureSessionSource(workspace.guestPersonal, accepted)
  ).rejects.toBeInstanceOf(WorkspaceAccessDenied);
  expect(await drainSessionSources()).toEqual({ stored: 1, configured: true });
  await captureSessionSource(actor, accepted);
  expect(await drainSessionSources()).toEqual({ stored: 0, configured: true });
  const [receipt] = await query<{ namespaceId: string }>(sql`
    SELECT namespace_id AS "namespaceId" FROM memory_session_sources WHERE event_id = ${accepted?.eventId}`);
  const files = await Array.fromAsync(
    glob(
      join(directory, receipt?.namespaceId ?? "missing", "raw/eve/**/*.jsonl")
    )
  );
  expect(files).toHaveLength(1);
  expect(
    JSON.parse(await readFile(files[0] ?? "missing", "utf8"))
  ).toMatchObject({
    kind: "message.settled",
    settlement: "accepted",
    occurredAt: null,
    text: "Accepted Willowport reply.",
  });
});

test("native drain rejects an enclosing SQL transaction before journal publication", async () => {
  await using workspace = await privateMemoryFixture();
  const actor = workspace.personal;
  const sessionId = `nested-journal-${randomUUID()}`;
  await claimSession(actor, sessionId);
  const event = source();
  await transaction(() =>
    captureSessionSource(actor, sessionSource(event, sessionId))
  );
  const namespace = await workspace.namespace(actor);
  await expect(transaction(() => drainSessionSources())).rejects.toBeInstanceOf(
    TransactionBoundaryError
  );
  expect(
    await Array.fromAsync(
      glob(join(directory, namespace.id, "raw/eve/**/*.jsonl"))
    )
  ).toEqual([]);
  const [receipt] = await query<{
    storedAt: string | null;
    payload: unknown;
  }>(sql`
    SELECT stored_at AS "storedAt", payload FROM memory_session_sources
    WHERE namespace_id=${namespace.id} AND event_id=${event.meta.id}`);
  expect(receipt?.storedAt).toBeNull();
  expect(receipt?.payload).toMatchObject({ eventId: event.meta.id });
  expect(await drainSessionSources()).toEqual({ stored: 1, configured: true });
});

test("a failed account backs off while a different account commits its delivered journal", async () => {
  await using failed = await privateMemoryFixture();
  await using healthy = await privateMemoryFixture();
  const firstSession = `journal-failure-${randomUUID()}`;
  const secondSession = `journal-healthy-${randomUUID()}`;
  await claimSession(failed.personal, firstSession);
  await claimSession(healthy.personal, secondSession);
  const first = source();
  const second = source();
  await captureSessionSource(
    failed.personal,
    sessionSource(first, firstSession)
  );
  await captureSessionSource(
    healthy.personal,
    sessionSource(second, secondSession)
  );
  const namespace = await failed.namespace(failed.personal);
  const raw = join(directory, namespace.id, "raw");
  await mkdir(raw, { recursive: true, mode: 0o700 });
  await writeFile(join(raw, "eve"), "Synthetic isolated disk failure");
  await expect(drainSessionSources()).rejects.toMatchObject({
    message:
      "Session archive delivery failed for 1 account(s); 1 source(s) stored.",
  });
  const receipts = await query<{
    eventId: string;
    storedAt: string | null;
    failures: number;
    delayed: boolean;
  }>(sql`
    SELECT event_id AS "eventId", stored_at AS "storedAt", delivery_failures AS failures,
      available_at > statement_timestamp() AS delayed FROM memory_session_sources
    WHERE event_id IN (${first.meta.id},${second.meta.id})`);
  expect(receipts.find((row) => row.eventId === first.meta.id)).toMatchObject({
    storedAt: null,
    failures: 1,
    delayed: true,
  });
  expect(
    receipts.find((row) => row.eventId === second.meta.id)?.storedAt
  ).not.toBeNull();
  expect(await drainSessionSources()).toEqual({ stored: 0, configured: true });
});

test("one real drain commits at most five namespace batches", async () => {
  await using fixtures = new AsyncDisposableStack();
  const events = [];
  for (let count = 0; count < 6; count++) {
    const fixture = fixtures.use(await privateMemoryFixture());
    const sessionId = `bounded-journal-${randomUUID()}`;
    await claimSession(fixture.personal, sessionId);
    const event = source();
    events.push(event.meta.id);
    await captureSessionSource(
      fixture.personal,
      sessionSource(event, sessionId)
    );
  }
  expect(await drainSessionSources()).toEqual({ stored: 5, configured: true });
  const [count] = await query<{ stored: number; pending: number }>(sql`
    SELECT count(*) FILTER (WHERE stored_at IS NOT NULL)::int AS stored,
      count(*) FILTER (WHERE stored_at IS NULL)::int AS pending FROM memory_session_sources
    WHERE event_id IN (${sql.join(
      events.map((id) => sql`${id}`),
      sql`, `
    )})`);
  expect(count).toEqual({ stored: 5, pending: 1 });
  expect(await drainSessionSources()).toEqual({ stored: 1, configured: true });
});
