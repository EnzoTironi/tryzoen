import { randomUUID } from "node:crypto";
import { glob, mkdir, readFile, rm, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { afterAll, expect, test, vi } from "vitest";
import { sql } from "drizzle-orm";
import { query, transaction } from "@db/queries";
import type { HookEvent } from "eve/hooks";
import { workspaceFixture } from "./workspace-fixture";
import { claimSession } from "../../db/services/sessions";
import { WorkspaceAccessDenied } from "../../server/workspaces/access";
import {
  captureSessionSource,
  drainSessionSources,
} from "../../server/memory/session-capture";

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

test("owns capture by persisted session and retires outbox content only after private disk delivery", async () => {
  await using workspace = await workspaceFixture();
  const actor = workspace.personal;
  const sessionId = `session-${randomUUID()}`;
  await claimSession(actor, sessionId);
  const event = source();
  await captureSessionSource(actor, sessionId, event);
  await captureSessionSource(actor, sessionId, event);
  await expect(
    captureSessionSource(workspace.guestPersonal, sessionId, source())
  ).rejects.toBeInstanceOf(WorkspaceAccessDenied);
  await expect(
    captureSessionSource(actor, sessionId, source(event.meta.id, "Conflict"))
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
  await captureSessionSource(actor, sessionId, event);
  expect(await drainSessionSources()).toEqual({ stored: 0, configured: true });
  await query(
    sql`UPDATE workspace_memory_namespace SET enabled = false WHERE namespace_id = ${receipt?.namespaceId}`
  );
  await captureSessionSource(actor, sessionId, source());
  expect(await drainSessionSources()).toEqual({ stored: 0, configured: true });
});

test("disk errors retain queued content for retry; account deletion fences sources and leaves an erasure receipt", async () => {
  await using workspace = await workspaceFixture();
  const actor = workspace.personal;
  const sessionId = `session-${randomUUID()}`;
  const event = source();
  await claimSession(actor, sessionId);
  await captureSessionSource(actor, sessionId, event);
  const [owner] = await query<{ id: string }>(
    sql`SELECT namespace_id AS id FROM workspace_memory_namespace WHERE workspace_id = ${actor.workspaceId} AND user_id = ${actor.userId}`
  );
  if (!owner) throw new Error("Expected namespace");
  const raw = join(directory, owner.id, "raw");
  await mkdir(raw, { recursive: true, mode: 0o700 });
  await writeFile(join(raw, "eve"), "Synthetic failed volume layout");
  await expect(drainSessionSources()).rejects.toThrow(/EEXIST|ENOTDIR/);
  const [pending] = await query<{ payload: unknown }>(
    sql`SELECT payload FROM memory_session_sources WHERE event_id = ${event.meta.id}`
  );
  expect(pending?.payload).toMatchObject({ eventId: event.meta.id });
  await rm(join(raw, "eve"));
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
    captureSessionSource(actor, sessionId, source())
  ).rejects.toBeInstanceOf(WorkspaceAccessDenied);
});

test("drains at most 25 events and serializes capture identity inside its owner boundary", async () => {
  await using workspace = await workspaceFixture();
  const actor = workspace.personal;
  const sessionId = `session-${randomUUID()}`;
  await claimSession(actor, sessionId);
  const events = Array.from({ length: 26 }, () => source());
  await Promise.all(
    events.map((event) => captureSessionSource(actor, sessionId, event))
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
  await captureSessionSource(actor, sessionId, event);
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
  await captureSessionSource(actor, sessionId, event);
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
