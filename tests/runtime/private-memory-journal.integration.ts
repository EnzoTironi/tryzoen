import { createHash, randomUUID } from "node:crypto";
import { lstat, readFile, rm } from "node:fs/promises";
import { join } from "node:path";
import { Client } from "pg";
import { expect, test } from "vitest";
import { sql } from "drizzle-orm";
import { query } from "@db/queries";
import { env } from "@shared/environment/env";
import { claimSession } from "../../db/services/sessions";
import {
  PrivateMemoryRepository,
  inspectPrivateMemoryArchive,
} from "../../server/memory/repository";
import {
  captureSessionSource,
  drainSessionSources,
} from "../../server/memory/session-capture";
import {
  sessionSourceSchema,
  writeSessionSource,
} from "../../server/memory/session-files";
import {
  rebuildSessionSourceReceipts,
  exportSessionSources,
  SessionArchiveUnavailable,
} from "../../server/memory/session-export";
import {
  encodePrivateMemoryArchive,
  decodePrivateMemoryArchive,
} from "../../server/memory/archive-codec";
import { WorkspaceAccessDenied } from "../../server/workspaces/access";
import { withDeadline } from "../../server/operations/async";
import { privateMemoryFixture } from "./private-memory-fixture";

const hash = (text: string) => createHash("sha256").update(text).digest("hex");
const source = (sessionId: string, text: string) =>
  sessionSourceSchema.parse({
    version: 2,
    source: "eve",
    sessionId,
    eventId: randomUUID(),
    occurredAt: "2026-10-01T00:00:00.000Z",
    kind: "message.received",
    turnId: "turn_0",
    sequence: 0,
    stepIndex: null,
    role: "user",
    settlement: null,
    text,
  });
const citation = (event: ReturnType<typeof source>, excerpt: string) => ({
  kind: "session" as const,
  sessionId: event.sessionId,
  eventId: event.eventId,
  sha256: hash(JSON.stringify(event)),
  excerpt,
});
const sourcePath = (
  root: string,
  namespace: string,
  event: ReturnType<typeof source>
) =>
  join(
    root,
    namespace,
    "raw",
    "eve",
    hash(event.sessionId),
    `${hash(event.eventId)}.jsonl`
  );

test("raw conversation export retains exact receipt identities and refuses an old lost event after a fresh append", async () => {
  await using fixture = await privateMemoryFixture();
  const actor = fixture.personal;
  const sessionId = `journal-${randomUUID()}`;
  await claimSession(actor, sessionId);
  const old = source(sessionId, "Older accepted Cedar event");
  await captureSessionSource(actor, old);
  await drainSessionSources();
  const namespace = await fixture.namespace(actor);
  const [receipt] =
    await query(sql`SELECT session_id AS "sessionId",payload,stored_at IS NOT NULL AS delivered
    FROM memory_session_sources WHERE namespace_id=${namespace.id} AND event_id=${old.eventId}`);
  expect(receipt).toEqual({ sessionId, payload: null, delivered: true });
  const complete = await exportSessionSources(
    actor,
    sessionId,
    new AbortController().signal
  );
  const bytes = Buffer.from(await complete.arrayBuffer());
  expect(complete.headers.get("content-length")).toBe(String(bytes.byteLength));
  expect(bytes).toEqual(
    await readFile(sourcePath(fixture.root, namespace.id, old))
  );
  await rm(sourcePath(fixture.root, namespace.id, old));
  await expect(
    exportSessionSources(actor, sessionId, new AbortController().signal)
  ).rejects.toBeInstanceOf(SessionArchiveUnavailable);
  const fresh = source(
    sessionId,
    "Fresh Maple append must not hide older loss"
  );
  await captureSessionSource(actor, fresh);
  await drainSessionSources();
  expect((await fixture.namespace(actor)).journalEventCount).toBe(2);
  await expect(
    exportSessionSources(actor, sessionId, new AbortController().signal)
  ).rejects.toBeInstanceOf(SessionArchiveUnavailable);
  await expect(
    PrivateMemoryRepository.backupCorpus(actor)
  ).rejects.toMatchObject({ reason: "unavailable" });
});

test("v2 retains every cited correction/clear source while v3 also keeps uncited and unverified journal events", async () => {
  await using fixture = await privateMemoryFixture();
  const actor = fixture.personal;
  const sessionId = `journal-${randomUUID()}`;
  await claimSession(actor, sessionId);
  const weekly = source(sessionId, "Weekly Cedar reports");
  const monthly = source(sessionId, "Monthly Cedar reports");
  const unverified = sessionSourceSchema.parse({
    ...source(sessionId, "Unverified uncited speculation"),
    kind: "message.completed",
    role: "assistant",
    settlement: "unverified",
  });
  for (const event of [weekly, monthly, unverified])
    await captureSessionSource(actor, event);
  expect(await drainSessionSources()).toEqual({ configured: true, stored: 3 });
  const claimId = randomUUID();
  const first = await PrivateMemoryRepository.change(actor, {
    action: "assert",
    operationId: randomUUID(),
    claimId,
    expectedRevision: null,
    body: {
      text: "Weekly Cedar reports",
      sources: [citation(weekly, "Weekly Cedar")],
      validTime: null,
      relations: [],
    },
  });
  const corrected = await PrivateMemoryRepository.change(actor, {
    action: "correct",
    operationId: randomUUID(),
    claimId,
    expectedRevision: first.receipt.revision,
    body: {
      text: "Monthly Cedar reports",
      sources: [citation(monthly, "Monthly Cedar")],
      validTime: null,
      relations: [],
    },
  });
  const cleared = await PrivateMemoryRepository.change(actor, {
    action: "clear",
    operationId: randomUUID(),
    expectedRevision: corrected.receipt.revision,
  });
  const claims = await PrivateMemoryRepository.backup(actor);
  const corpus = await PrivateMemoryRepository.backupCorpus(actor);
  expect(claims.sources.map((event) => event.eventId).sort()).toEqual(
    [weekly.eventId, monthly.eventId].sort()
  );
  expect(corpus.sources.map((event) => event.eventId).sort()).toEqual(
    [weekly.eventId, monthly.eventId, unverified.eventId].sort()
  );
  const namespace = await fixture.namespace(actor);
  expect(corpus.capturedThrough).toBe(namespace.journalHighWater);
  expect(namespace.journalEventCount).toBe(3);
  const bytes = encodePrivateMemoryArchive(corpus);
  expect(await inspectPrivateMemoryArchive(actor, bytes)).toMatchObject({
    coverage: "complete-journal",
    version: 3,
    sourceEvents: 3,
    revision: cleared.receipt.revision,
    expectedRevision: cleared.receipt.revision,
  });
  const decoded = decodePrivateMemoryArchive(bytes);
  if (decoded.version !== 3)
    throw new Error("Expected complete journal wire object");
  expect(
    await PrivateMemoryRepository.restoreCorpus(actor, {
      expectedRevision: cleared.receipt.revision,
      archive: decoded,
    })
  ).toEqual({ applied: false, revision: cleared.receipt.revision });
  expect(
    (await PrivateMemoryRepository.search(actor, { query: "Cedar" })).matches
  ).toEqual([]);
  await expect(
    PrivateMemoryRepository.change(actor, {
      action: "assert",
      operationId: randomUUID(),
      claimId: randomUUID(),
      expectedRevision: cleared.receipt.revision,
      body: {
        text: "Speculation",
        sources: [citation(unverified, "speculation")],
        validTime: null,
        relations: [],
      },
    })
  ).rejects.toMatchObject({ reason: "invalid_input" });
});

test("exact duplicate capture does not allocate again and pending delivery cannot masquerade as a complete snapshot", async () => {
  await using fixture = await privateMemoryFixture();
  const actor = fixture.personal;
  const sessionId = `journal-${randomUUID()}`;
  await claimSession(actor, sessionId);
  const event = source(sessionId, "An uncited pending Cedar event");
  await captureSessionSource(actor, event);
  const captured = await fixture.namespace(actor);
  await captureSessionSource(actor, event);
  const duplicate = await fixture.namespace(actor);
  expect(duplicate.journalEventCount).toBe(1);
  expect(duplicate.journalHighWater).toBe(captured.journalHighWater);
  await expect(
    PrivateMemoryRepository.backupCorpus(actor)
  ).rejects.toMatchObject({ reason: "unavailable" });
  if (captured.journalHighWater === null)
    throw new Error("Expected retained capture checkpoint");
  // Real immutable bytes can survive a delivery rollback, but are not an ACK.
  await writeSessionSource(
    fixture.root,
    captured.id,
    event,
    captured.journalHighWater
  );
  expect(await rebuildSessionSourceReceipts(actor, sessionId)).toEqual({
    restored: 0,
    pending: 1,
  });
  await expect(
    PrivateMemoryRepository.backupCorpus(actor)
  ).rejects.toMatchObject({ reason: "unavailable" });
  await drainSessionSources();
  await captureSessionSource(actor, event);
  expect((await fixture.namespace(actor)).journalEventCount).toBe(1);
  expect(
    (await PrivateMemoryRepository.backupCorpus(actor)).sources
  ).toHaveLength(1);
});

test("missing both an uncited file and its receipt fails closed; authenticated v3 replay repairs it without resetting retained counters", async () => {
  await using fixture = await privateMemoryFixture();
  const actor = fixture.personal;
  const sessionId = `journal-${randomUUID()}`;
  await claimSession(actor, sessionId);
  const first = source(sessionId, "First uncited Cedar event");
  const second = source(sessionId, "Second uncited Maple event");
  for (const event of [first, second]) await captureSessionSource(actor, event);
  await drainSessionSources();
  const namespace = await fixture.namespace(actor);
  const archive = await PrivateMemoryRepository.backupCorpus(actor);
  const [allocator] = await query(
    sql`SELECT pg_sequence_last_value(pg_get_serial_sequence('memory_session_sources','capture_sequence')::regclass)::text AS value`
  );
  await query(
    sql`DELETE FROM memory_session_sources WHERE namespace_id=${namespace.id} AND event_id=${first.eventId}`
  );
  await rm(sourcePath(fixture.root, namespace.id, first));
  await expect(
    PrivateMemoryRepository.backupCorpus(actor)
  ).rejects.toMatchObject({ reason: "unavailable" });
  expect((await fixture.namespace(actor)).journalEventCount).toBe(2);
  expect(
    await PrivateMemoryRepository.restoreCorpus(actor, {
      expectedRevision: null,
      archive,
    })
  ).toEqual({ applied: false, revision: null });
  const repaired = await PrivateMemoryRepository.backupCorpus(actor);
  expect(repaired.sources).toEqual(archive.sources);
  expect(repaired.capturedThrough).toBe(archive.capturedThrough);
  expect((await fixture.namespace(actor)).journalHighWater).toBe(
    namespace.journalHighWater
  );
  expect(
    (
      await query(
        sql`SELECT pg_sequence_last_value(pg_get_serial_sequence('memory_session_sources','capture_sequence')::regclass)::text AS value`
      )
    )[0]
  ).toEqual(allocator);
  const archived = archive.sources.find(
    (event) => event.eventId === first.eventId
  );
  if (!archived) throw new Error("Expected lost uncited source");
  expect(await readFile(sourcePath(fixture.root, namespace.id, first))).toEqual(
    Buffer.from(archived.content)
  );
});

test("older corpus repair preserves newer uncited events and never moves the retained namespace checkpoint backwards", async () => {
  await using fixture = await privateMemoryFixture();
  const actor = fixture.personal;
  const sessionId = `journal-${randomUUID()}`;
  await claimSession(actor, sessionId);
  const first = source(sessionId, "Older uncited Cedar event");
  await captureSessionSource(actor, first);
  await drainSessionSources();
  const older = await PrivateMemoryRepository.backupCorpus(actor);
  const second = source(sessionId, "Newer uncited Maple event");
  await captureSessionSource(actor, second);
  await drainSessionSources();
  const current = await fixture.namespace(actor);
  await query(
    sql`DELETE FROM memory_session_sources WHERE namespace_id=${current.id} AND event_id=${first.eventId}`
  );
  await rm(sourcePath(fixture.root, current.id, first));
  await PrivateMemoryRepository.restoreCorpus(actor, {
    expectedRevision: null,
    archive: older,
  });
  const repaired = await PrivateMemoryRepository.backupCorpus(actor);
  expect(repaired.sources.map((event) => event.eventId)).toEqual([
    first.eventId,
    second.eventId,
  ]);
  expect(repaired.capturedThrough).toBe(current.journalHighWater);
  expect((await fixture.namespace(actor)).journalEventCount).toBe(2);
});

test("an orphan immutable file cannot be silently exported or turned into a delivered receipt", async () => {
  await using fixture = await privateMemoryFixture();
  const actor = fixture.personal;
  const sessionId = `journal-${randomUUID()}`;
  await claimSession(actor, sessionId);
  const event = source(sessionId, "Actual captured source");
  await captureSessionSource(actor, event);
  await drainSessionSources();
  const namespace = await fixture.namespace(actor);
  if (namespace.journalHighWater === null)
    throw new Error("Expected checkpoint");
  const orphan = source(
    sessionId,
    "File bytes alone grant no source authority"
  );
  await writeSessionSource(
    fixture.root,
    namespace.id,
    orphan,
    namespace.journalHighWater
  );
  await expect(
    PrivateMemoryRepository.backupCorpus(actor)
  ).rejects.toMatchObject({ reason: "unavailable" });
  await expect(
    rebuildSessionSourceReceipts(actor, sessionId)
  ).rejects.toThrow();
  expect(
    await query(
      sql`SELECT event_id FROM memory_session_sources WHERE namespace_id=${namespace.id} AND event_id=${orphan.eventId}`
    )
  ).toEqual([]);
});

test("a corrupt account backs off while a healthy account commits its actual JSONL delivery", async () => {
  await using fixture = await privateMemoryFixture();
  const badSession = `journal-${randomUUID()}`;
  const healthySession = `journal-${randomUUID()}`;
  await claimSession(fixture.personal, badSession);
  await claimSession(fixture.guestPersonal, healthySession);
  const bad = source(badSession, "Bad account before corruption");
  const healthy = source(healthySession, "Healthy account must make progress");
  await captureSessionSource(fixture.personal, bad);
  await captureSessionSource(fixture.guestPersonal, healthy);
  const badNamespace = await fixture.namespace(fixture.personal);
  const healthyNamespace = await fixture.namespace(fixture.guestPersonal);
  await query(sql`UPDATE memory_session_sources SET payload=jsonb_set(payload,'{text}',to_jsonb('corrupt bytes'::text))
    WHERE namespace_id=${badNamespace.id} AND event_id=${bad.eventId}`);
  await expect(drainSessionSources()).rejects.toBeInstanceOf(AggregateError);
  const rows = await query<{
    eventId: string;
    delivered: boolean;
    failures: number;
  }>(sql`SELECT event_id AS "eventId",
    stored_at IS NOT NULL AS delivered,delivery_failures AS failures FROM memory_session_sources
    WHERE namespace_id IN (${badNamespace.id},${healthyNamespace.id})`);
  expect(rows.find((row) => row.eventId === bad.eventId)).toMatchObject({
    delivered: false,
    failures: 1,
  });
  expect(rows.find((row) => row.eventId === healthy.eventId)).toMatchObject({
    delivered: true,
    failures: 0,
  });
  expect(
    (await PrivateMemoryRepository.backupCorpus(fixture.guestPersonal)).sources
  ).toHaveLength(1);
});

test("a retained-erasure receipt arriving after selection blocks the actual worker mutation, cached recall and renewed capture", async () => {
  await using fixture = await privateMemoryFixture();
  const actor = fixture.personal;
  const firstClaim = await PrivateMemoryRepository.change(actor, {
    action: "assert",
    operationId: randomUUID(),
    claimId: randomUUID(),
    expectedRevision: null,
    body: {
      text: "Cached Cedar preference",
      sources: [],
      relations: [],
      validTime: null,
    },
  });
  const namespace = await fixture.namespace(actor);
  const scopeKey = `scope-${namespace.id}`;
  const recallId = randomUUID();
  expect(
    (await PrivateMemoryRepository.recall(actor, scopeKey, recallId, "Cedar"))
      .matches
  ).toHaveLength(1);
  const sessionId = `journal-${randomUUID()}`;
  await claimSession(actor, sessionId);
  const first = source(sessionId, "First pending event");
  const second = source(sessionId, "Second pending event");
  for (const event of [first, second]) await captureSessionSource(actor, event);
  const holder = new Client({ connectionString: env.DATABASE_URL });
  let connected = false;
  let worker:
    | Promise<
        PromiseSettledResult<Awaited<ReturnType<typeof drainSessionSources>>>
      >
    | undefined;
  try {
    await holder.connect();
    connected = true;
    await holder.query("BEGIN");
    await holder.query(
      "SELECT event_id FROM memory_session_sources WHERE namespace_id=$1 AND event_id=$2 FOR UPDATE",
      [namespace.id, second.eventId]
    );
    worker = withDeadline(
      () => drainSessionSources(),
      Date.now() + 10_000
    ).then(
      (value) => ({ status: "fulfilled" as const, value }),
      (reason: unknown) => ({ status: "rejected" as const, reason })
    );
    await expect
      .poll(
        async () =>
          (
            await query(sql`SELECT 1 FROM pg_stat_activity WHERE datname=current_database()
      AND wait_event_type='Lock' AND query LIKE '%ORDER BY capture_sequence LIMIT 25 FOR UPDATE%'`)
          ).length,
        { timeout: 3000, interval: 25 }
      )
      .toBeGreaterThan(0);
    await query(sql`INSERT INTO workspace_memory_erasure(namespace_id,owner_user_id,available_at)
      VALUES (${namespace.id},${actor.userId},now()+interval '1 day')`);
    await holder.query("ROLLBACK");
    const result = await worker;
    expect(result.status).toBe("rejected");
    if (result.status === "rejected")
      expect(result.reason).toBeInstanceOf(AggregateError);
    expect(
      await query(
        sql`SELECT event_id FROM memory_session_sources WHERE namespace_id=${namespace.id} AND stored_at IS NOT NULL`
      )
    ).toEqual([]);
    expect(
      await lstat(join(fixture.root, namespace.id)).catch((error: unknown) => {
        if (
          error instanceof Error &&
          "code" in error &&
          error.code === "ENOENT"
        )
          return null;
        throw error;
      })
    ).toBeNull();
    await expect(
      PrivateMemoryRepository.recall(actor, scopeKey, recallId, "Cedar")
    ).rejects.toMatchObject({ reason: "conflict" });
    await expect(
      captureSessionSource(
        actor,
        source(sessionId, "Renewed capture must remain denied")
      )
    ).rejects.toMatchObject({ reason: "erased" });
    expect(
      await query(
        sql`SELECT namespace_id FROM workspace_memory_erasure WHERE namespace_id=${namespace.id}`
      )
    ).toHaveLength(1);
    const [retained] = await query(
      sql`SELECT head_sha AS head FROM private_memory_repository WHERE namespace_id=${namespace.id}`
    );
    expect(retained?.head).toBe(firstClaim.receipt.revision);
  } finally {
    if (connected) {
      try {
        await holder.query("ROLLBACK");
      } finally {
        await holder.end();
      }
    }
    if (worker) await worker;
  }
});

test("wrong owner/generation, older tombstones and lost session authority deny actual wire recovery", async () => {
  await using fixture = await privateMemoryFixture();
  const actor = fixture.personal;
  const sessionId = `journal-${randomUUID()}`;
  await claimSession(actor, sessionId);
  const event = source(sessionId, "Verified Cedar source");
  await captureSessionSource(actor, event);
  await drainSessionSources();
  const claimId = randomUUID();
  const initial = await PrivateMemoryRepository.change(actor, {
    action: "assert",
    operationId: randomUUID(),
    claimId,
    expectedRevision: null,
    body: {
      text: "Cedar fact",
      sources: [citation(event, "Cedar")],
      relations: [],
      validTime: null,
    },
  });
  const archive = await PrivateMemoryRepository.backupCorpus(actor);
  await expect(
    PrivateMemoryRepository.restoreCorpus(fixture.guestPersonal, {
      expectedRevision: null,
      archive,
    })
  ).rejects.toBeInstanceOf(WorkspaceAccessDenied);
  await expect(
    PrivateMemoryRepository.restoreCorpus(actor, {
      expectedRevision: initial.receipt.revision,
      archive: { ...archive, namespaceId: randomUUID() },
    })
  ).rejects.toBeInstanceOf(WorkspaceAccessDenied);
  await PrivateMemoryRepository.change(actor, {
    action: "tombstone",
    operationId: randomUUID(),
    claimId,
    expectedRevision: initial.receipt.revision,
  });
  await expect(
    inspectPrivateMemoryArchive(actor, encodePrivateMemoryArchive(archive))
  ).rejects.toMatchObject({ reason: "conflict" });
  await expect(
    PrivateMemoryRepository.restoreCorpus(actor, {
      expectedRevision: archive.revision,
      archive,
    })
  ).rejects.toMatchObject({ reason: "conflict" });
  await query(
    sql`DELETE FROM agent_sessions WHERE session_id=${sessionId} AND created_by_user_id=${actor.userId}`
  );
  await expect(
    PrivateMemoryRepository.history(actor, claimId)
  ).rejects.toBeInstanceOf(WorkspaceAccessDenied);
  await expect(
    PrivateMemoryRepository.backupCorpus(actor)
  ).rejects.toBeInstanceOf(WorkspaceAccessDenied);
});
