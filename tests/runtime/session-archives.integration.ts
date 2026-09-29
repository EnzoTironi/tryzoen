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
import { afterAll, expect, test, vi } from "vitest";
import { sql } from "drizzle-orm";
import { query, transaction } from "@db/queries";
import type { HookEvent } from "eve/hooks";
import { workspaceFixture } from "./workspace-fixture";
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

const { directory } = await vi.hoisted(async () => {
  const { mkdtemp } = await import("node:fs/promises");
  const { tmpdir } = await import("node:os");
  const pathModule = await import("node:path");
  return {
    directory: await mkdtemp(
      pathModule.join(tmpdir(), "zoen-session-archive-integration-")
    ),
  };
});
vi.mock("@shared/environment/env", async (original) => {
  const actual = await original<typeof import("@shared/environment/env")>();
  return {
    ...actual,
    env: { ...actual.env, ZOEN_SESSION_ARCHIVE_DIR: directory },
  };
});
afterAll(async () => {
  await rm(directory, { recursive: true, force: true });
});

const source = (
  id: string = randomUUID(),
  text = "Synthetic club meets at Cedarfield."
): HookEvent<"message.received"> => ({
  type: "message.received",
  meta: { id, at: "2026-09-28T12:00:00.000Z" },
  data: { message: text, sequence: 0, turnId: "turn_0" },
});

test("resumed Eve turns with empty turn IDs have separate native receipts and do not block later sources", async () => {
  if (!process.env.ZOEN_AI_MEMORY_BINARY)
    throw new Error(
      "This case requires the qualified native memory executable."
    );
  await using workspace = await workspaceFixture();
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
  await using workspace = await workspaceFixture();
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
  await using workspace = await workspaceFixture();
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
  await using workspace = await workspaceFixture();
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
  await using workspace = await workspaceFixture();
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
  await using workspace = await workspaceFixture();
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
  await using workspace = await workspaceFixture();
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
  await using workspace = await workspaceFixture();
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
  await using workspace = await workspaceFixture();
  const actor = workspace.personal;
  const sessionId = `session-${randomUUID()}`;
  const event = source();
  await claimSession(actor, sessionId);
  await captureSessionSource(actor, sessionSource(event, sessionId));
  await expect(
    transaction(async () => {
      expect(await drainSessionSources()).toEqual({
        stored: 1,
        configured: true,
      });
      throw new Error("Synthetic acknowledgement failure");
    })
  ).rejects.toThrow("acknowledgement failure");
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
  expect(await drainSessionSources()).toEqual({ stored: 1, configured: true });
  expect(await readFile(files[0] ?? "missing", "utf8")).toBe(before);
});

test("preserves long escaped text and rejects excess queued bytes atomically", async () => {
  await using workspace = await workspaceFixture();
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
  await using workspace = await workspaceFixture();
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

test("pausing memory fences delivery of already queued sources until it is resumed", async () => {
  await using workspace = await workspaceFixture();
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
  await using workspace = await workspaceFixture();
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
