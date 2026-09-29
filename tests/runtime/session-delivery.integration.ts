import { randomUUID } from "node:crypto";
import { glob, readFile, rm } from "node:fs/promises";
import { join } from "node:path";
import { afterAll, expect, test, vi } from "vitest";
import { sql } from "drizzle-orm";
import { query, transaction } from "@db/queries";
import { claimSession } from "@db/services/sessions";
import archiveSchedule from "@agent/schedules/session-archive";
import { workspaceFixture } from "./workspace-fixture";
import { sessionSource } from "../../server/memory/session-files";
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
      pathModule.join(tmpdir(), "zoen-session-delivery-")
    ),
  };
});
vi.mock("@shared/environment/env", async (original) => {
  const actual = await original<typeof import("@shared/environment/env")>();
  return {
    ...actual,
    env: {
      ...actual.env,
      ZOEN_SESSION_ARCHIVE_DIR: directory,
      ZOEN_MEMORY_INGESTION_CONCURRENCY: 1,
    },
  };
});
afterAll(() => rm(directory, { recursive: true, force: true }));

async function enqueue(
  actor: Parameters<typeof captureSessionSource>[0],
  count: number
) {
  const sessionId = `session-${randomUUID()}`;
  await claimSession(actor, sessionId);
  const ids: string[] = [];
  for (let index = 0; index < count; index++) {
    const id = randomUUID();
    ids.push(id);
    await captureSessionSource(
      actor,
      sessionSource(
        {
          type: "message.received",
          meta: { id, at: "2026-09-28T12:00:00.000Z" },
          data: {
            message: `Synthetic archive event ${index}.`,
            sequence: index,
            turnId: "turn_0",
          },
        },
        sessionId
      )
    );
  }
  const [owner] = await query<{ id: string }>(sql`SELECT namespace_id AS id
    FROM workspace_memory_namespace WHERE workspace_id = ${actor.workspaceId} AND user_id = ${actor.userId}`);
  if (!owner) throw new Error("Expected synthetic memory namespace");
  return { namespaceId: owner.id, sessionId, ids };
}

test("a damaged batch backs off while other accounts commit; capture cannot bypass it and replay preserves files", async () => {
  await using workspace = await workspaceFixture();
  const broken = await enqueue(workspace.personal, 3);
  const healthy = await enqueue(workspace.guestPersonal, 2);
  await query(sql`UPDATE memory_session_sources SET payload = jsonb_set(payload, '{text}', '"damaged"')
    WHERE namespace_id = ${broken.namespaceId} AND event_id = ${broken.ids[1]}`);
  await expect(drainSessionSources()).rejects.toMatchObject({
    message:
      "Session archive delivery failed for 1 account(s); 2 source(s) stored.",
    errors: [
      expect.objectContaining({
        message: "Session source failed integrity verification.",
      }),
    ],
  });
  const [backoff] = await query<{
    failures: number;
    wait: number;
    failed: boolean;
  }>(sql`
    SELECT delivery_failures AS failures,
      extract(epoch FROM available_at - clock_timestamp())::float AS wait, last_failed_at IS NOT NULL AS failed
    FROM memory_session_sources WHERE event_id = ${broken.ids[0]}`);
  expect(backoff).toMatchObject({ failures: 1, failed: true });
  expect(backoff?.wait).toBeGreaterThan(45);
  expect(backoff?.wait).toBeLessThanOrEqual(60);
  const files = await Array.fromAsync(
    glob(join(directory, broken.namespaceId, "raw/eve/**/*.jsonl"))
  );
  expect(files).toHaveLength(1);
  const firstBytes = await readFile(files[0] ?? "missing");
  const [counts] = await query<{ pending: number; stored: number }>(sql`
    SELECT count(*) FILTER (WHERE namespace_id = ${broken.namespaceId} AND stored_at IS NULL)::int AS pending,
      count(*) FILTER (WHERE namespace_id = ${healthy.namespaceId} AND stored_at IS NOT NULL)::int AS stored
    FROM memory_session_sources WHERE namespace_id IN (${broken.namespaceId}, ${healthy.namespaceId})`);
  expect(counts).toEqual({ pending: 3, stored: 2 });
  await enqueue(workspace.personal, 1);
  const [timing] = await query<{
    versions: number;
  }>(sql`SELECT count(DISTINCT available_at)::int AS versions
    FROM memory_session_sources WHERE namespace_id = ${broken.namespaceId} AND stored_at IS NULL`);
  expect(timing?.versions).toBe(1);
  expect(await drainSessionSources()).toEqual({ stored: 0, configured: true });
  await query(sql`UPDATE memory_session_sources SET available_at = now()
    WHERE namespace_id = ${broken.namespaceId} AND stored_at IS NULL`);
  await expect(drainSessionSources()).rejects.toBeInstanceOf(AggregateError);
  const [second] = await query<{ failures: number; wait: number }>(sql`
    SELECT delivery_failures AS failures, extract(epoch FROM available_at - clock_timestamp())::float AS wait
    FROM memory_session_sources WHERE event_id = ${broken.ids[0]}`);
  expect(second?.failures).toBe(2);
  expect(second?.wait).toBeGreaterThan(105);
  expect(second?.wait).toBeLessThanOrEqual(120);
  await query(sql`UPDATE memory_session_sources SET payload = jsonb_set(payload, '{text}', '"Synthetic archive event 1."')
    WHERE namespace_id = ${broken.namespaceId} AND event_id = ${broken.ids[1]}`);
  await query(sql`UPDATE memory_session_sources SET available_at = now()
    WHERE namespace_id = ${broken.namespaceId} AND stored_at IS NULL`);
  expect(await drainSessionSources()).toEqual({ stored: 4, configured: true });
  expect(await readFile(files[0] ?? "missing")).toEqual(firstBytes);
  expect(await drainSessionSources()).toEqual({ stored: 0, configured: true });
});

test("one account has a 25-source budget and a tick serves at most five accounts in waiting order", async () => {
  await using fixtures = new AsyncDisposableStack();
  const accounts = [];
  for (let i = 0; i < 7; i++) {
    const workspace = fixtures.use(await workspaceFixture());
    accounts.push(await enqueue(workspace.personal, i === 0 ? 26 : 1));
  }
  expect(await drainSessionSources()).toEqual({ stored: 29, configured: true });
  const [next] = await query<{ id: string }>(sql`SELECT namespace_id AS id
    FROM memory_session_sources WHERE stored_at IS NULL ORDER BY available_at, capture_sequence LIMIT 1`);
  expect(next?.id).toBe(accounts[5]?.namespaceId);
  expect(await drainSessionSources()).toEqual({ stored: 3, configured: true });
  expect(await drainSessionSources()).toEqual({ stored: 0, configured: true });
});

test("simultaneous workers do not overlap an account or acknowledge sources twice", async () => {
  await using workspace = await workspaceFixture();
  const owner = await enqueue(workspace.personal, 51);
  await enqueue(workspace.guestPersonal, 2);
  const results = await Promise.all(
    Array.from({ length: 4 }, () => drainSessionSources())
  );
  // Workers that encounter the same locked account return promptly. Later
  // ticks finish its remaining bounded batches instead of waiting on it.
  let delivered = results.reduce((total, result) => total + result.stored, 0);
  for (let tick = 0; tick < 3; tick++)
    delivered += (await drainSessionSources()).stored;
  expect(delivered).toBe(53);
  const [receipt] = await query<{ stored: number; pending: number }>(sql`
    SELECT count(*) FILTER (WHERE stored_at IS NOT NULL)::int AS stored,
      count(*) FILTER (WHERE stored_at IS NULL)::int AS pending
    FROM memory_session_sources WHERE namespace_id = ${owner.namespaceId}`);
  expect(receipt).toEqual({ stored: 51, pending: 0 });
  expect(
    await Array.fromAsync(
      glob(join(directory, owner.namespaceId, "raw/eve/**/*.jsonl"))
    )
  ).toHaveLength(51);
});

test("a locked account is skipped while an unrelated account delivers", async () => {
  await using workspace = await workspaceFixture();
  const owner = await enqueue(workspace.personal, 2);
  await enqueue(workspace.guestPersonal, 1);
  const locked = Promise.withResolvers<void>();
  const release = Promise.withResolvers<void>();
  const holding = transaction(async () => {
    await query(
      sql`SELECT namespace_id FROM workspace_memory_namespace WHERE namespace_id = ${owner.namespaceId} FOR UPDATE`
    );
    locked.resolve();
    await release.promise;
  });
  await locked.promise;
  try {
    expect(await drainSessionSources()).toEqual({
      stored: 1,
      configured: true,
    });
  } finally {
    release.resolve();
    await holding;
  }
  expect(await drainSessionSources()).toEqual({ stored: 2, configured: true });
});

test("organization revocation fences queued sources even if the workspace membership remains", async () => {
  await using workspace = await workspaceFixture();
  const queued = await enqueue(workspace.actor, 1);
  await query(sql`DELETE FROM organization_memberships WHERE user_id = ${workspace.actor.userId}
    AND organization_id = (SELECT organization_id FROM workspaces WHERE id = ${workspace.actor.workspaceId})`);
  expect(await drainSessionSources()).toEqual({ stored: 0, configured: true });
  const [receipt] = await query<{
    stored: string | null;
    failures: number;
  }>(sql`
    SELECT stored_at AS stored, delivery_failures AS failures FROM memory_session_sources
    WHERE namespace_id = ${queued.namespaceId}`);
  expect(receipt).toEqual({ stored: null, failures: 0 });
  expect(
    await Array.fromAsync(
      glob(join(directory, queued.namespaceId, "raw/eve/**/*.jsonl"))
    )
  ).toHaveLength(0);
});

test("one scheduled invocation drains multiple fair rounds and preserves damaged accounts for retry", async () => {
  await using fixtures = new AsyncDisposableStack();
  const brokenWorkspace = fixtures.use(await workspaceFixture());
  const broken = await enqueue(brokenWorkspace.personal, 3);
  await query(sql`UPDATE memory_session_sources SET payload = jsonb_set(payload, '{text}', '"damaged"')
    WHERE namespace_id = ${broken.namespaceId} AND event_id = ${broken.ids[1]}`);
  const healthy = [];
  for (let i = 0; i < 7; i++) {
    const workspace = fixtures.use(await workspaceFixture());
    healthy.push(await enqueue(workspace.personal, 25));
  }

  const running = archiveSchedule.run();
  expect(archiveSchedule.run()).toBe(running);
  await expect(running).rejects.toBeInstanceOf(AggregateError);

  for (const account of healthy) {
    const [receipt] = await query<{ stored: number; pending: number }>(sql`
      SELECT count(*) FILTER (WHERE stored_at IS NOT NULL)::int AS stored,
        count(*) FILTER (WHERE stored_at IS NULL)::int AS pending
      FROM memory_session_sources WHERE namespace_id = ${account.namespaceId}`);
    expect(receipt).toEqual({ stored: 25, pending: 0 });
    expect(
      await Array.fromAsync(
        glob(join(directory, account.namespaceId, "raw/eve/**/*.jsonl"))
      )
    ).toHaveLength(25);
  }
  const [deferred] = await query<{ pending: number; failures: number }>(sql`
    SELECT count(*) FILTER (WHERE stored_at IS NULL)::int AS pending,
      sum(delivery_failures)::int AS failures
    FROM memory_session_sources WHERE namespace_id = ${broken.namespaceId}`);
  expect(deferred).toEqual({ pending: 3, failures: 1 });
  await expect(archiveSchedule.run()).resolves.toBeUndefined();
});
