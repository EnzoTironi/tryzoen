import { createHash, randomUUID } from "node:crypto";
import { rm } from "node:fs/promises";
import { afterAll, expect, test, vi } from "vitest";
import { sql } from "drizzle-orm";
import { query } from "@db/queries";
import { claimSession } from "../../db/services/sessions";
import { WorkspaceAccessDenied } from "../../server/workspaces/access";
import {
  captureSessionSource,
  drainSessionSources,
} from "../../server/memory/session-capture";
import {
  sessionSource,
  settledSessionSource,
  type sessionSourceSchema,
  writeSessionSource,
} from "../../server/memory/session-files";
import {
  verifySessionClaimSource,
  rebuildSessionSourceReceipts,
  SessionArchiveUnavailable,
} from "../../server/memory/session-export";
import { PrivateMemoryRepository } from "../../server/memory/repository";
import { workspaceFixture } from "./workspace-fixture";
import type { z } from "zod";

const { directory } = await vi.hoisted(async () => {
  const fs = await import("node:fs/promises");
  const os = await import("node:os");
  const path = await import("node:path");
  return {
    directory: await fs.mkdtemp(
      path.join(os.tmpdir(), "zoen-private-source-proof-")
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
      ZOEN_AI_MEMORY_BINARY: undefined,
    },
  };
});
afterAll(() => rm(directory, { recursive: true, force: true }));
const citation = (
  source: z.infer<typeof sessionSourceSchema>,
  excerpt: string
) => ({
  kind: "session" as const,
  sessionId: source.sessionId,
  eventId: source.eventId,
  sha256: createHash("sha256").update(JSON.stringify(source)).digest("hex"),
  excerpt,
});
const userSource = (sessionId: string) => {
  const source = sessionSource(
    {
      type: "message.received",
      meta: { id: randomUUID(), at: "2026-09-30T14:00:00.000Z" },
      data: {
        message: "I prefer a weekly Cedar report.",
        sequence: 0,
        turnId: "turn_0",
      },
    },
    sessionId
  );
  if (!source) throw new Error("Expected user source");
  return source;
};

test("a private claim cites the actual immutable user event digest only after journal delivery", async () => {
  await using fixture = await workspaceFixture();
  const { actor } = fixture;
  const sessionId = `private-source-${randomUUID()}`;
  await claimSession(actor, sessionId);
  const source = userSource(sessionId);
  const evidence = citation(source, "weekly Cedar report");
  await captureSessionSource(actor, source);
  await expect(
    verifySessionClaimSource(actor, evidence)
  ).rejects.toBeInstanceOf(SessionArchiveUnavailable);
  expect(await drainSessionSources()).toEqual({ configured: true, stored: 1 });
  expect(await verifySessionClaimSource(actor, evidence)).toBe(true);
  expect(
    await verifySessionClaimSource(actor, {
      ...evidence,
      sha256: "f".repeat(64),
    })
  ).toBe(false);
  expect(
    await verifySessionClaimSource(actor, {
      ...evidence,
      excerpt: "Invented monthly preference",
    })
  ).toBe(false);
  const change = {
    action: "assert" as const,
    claimId: randomUUID(),
    operationId: randomUUID(),
    expectedRevision: null,
    body: {
      text: "The user prefers weekly Cedar reports",
      sources: [evidence],
      relations: [],
      validTime: null,
    },
  };
  const result = await PrivateMemoryRepository.change(actor, change);
  if (!result.applied || !result.claim)
    throw new Error("Expected claim publication");
  expect(
    (await PrivateMemoryRepository.read(actor)).snapshot.claims[0]
  ).toEqual(result.claim);
  expect(result.claim.file.state).toMatchObject({
    kind: "active",
    body: { sources: [evidence] },
  });
});

test("assistant stream completion is withheld while the native settled reply is verified without inventing a timestamp", async () => {
  await using fixture = await workspaceFixture();
  const { actor } = fixture;
  const sessionId = `private-source-${randomUUID()}`;
  const turn = { id: "source-turn", sequence: 0 };
  await claimSession(actor, sessionId);
  const unverified = {
    ...userSource(sessionId),
    eventId: randomUUID(),
    kind: "message.completed" as const,
    role: "assistant" as const,
    settlement: "unverified" as const,
  };
  const accepted = settledSessionSource({
    session: { id: sessionId, turn, auth: { current: null, initiator: null } },
    turn: { ...turn, input: [] },
    operationId: randomUUID(),
    messages: [{ role: "assistant", content: "An accepted Cedar reply." }],
  });
  if (!accepted) throw new Error("Expected accepted reply");
  await captureSessionSource(actor, unverified);
  await captureSessionSource(actor, accepted);
  expect(await drainSessionSources()).toEqual({ configured: true, stored: 2 });
  expect(
    await verifySessionClaimSource(
      actor,
      citation(unverified, "weekly Cedar report")
    )
  ).toBe(false);
  expect(
    await verifySessionClaimSource(
      actor,
      citation(accepted, "accepted Cedar reply")
    )
  ).toBe(true);
  expect(accepted.occurredAt).toBeNull();
});

test("source coordinates never grant another person, delegated runtime, group or revoked owner access", async () => {
  await using fixture = await workspaceFixture();
  const { actor, guest } = fixture;
  const sessionId = `private-source-${randomUUID()}`;
  await claimSession(actor, sessionId);
  const source = userSource(sessionId);
  const evidence = citation(source, "weekly Cedar report");
  await captureSessionSource(actor, source);
  await drainSessionSources();
  await expect(
    verifySessionClaimSource(guest, evidence)
  ).rejects.toBeInstanceOf(WorkspaceAccessDenied);
  for (const untrusted of [
    { ...actor, agentGrantId: randomUUID() },
    { ...actor, groupBindingId: randomUUID(), groupEpoch: randomUUID() },
    { ...actor, scheduledRunId: randomUUID() },
  ])
    await expect(
      verifySessionClaimSource(untrusted, evidence)
    ).rejects.toBeInstanceOf(WorkspaceAccessDenied);
  await query(
    sql`DELETE FROM workspace_memberships WHERE workspace_id = ${actor.workspaceId} AND user_id = ${actor.userId}`
  );
  await expect(
    verifySessionClaimSource(actor, evidence)
  ).rejects.toBeInstanceOf(WorkspaceAccessDenied);
});

test("source receipt loss rebuilds from files without changing the actual claim version or permitting cross-owner recovery", async () => {
  await using fixture = await workspaceFixture();
  const { actor, guest } = fixture;
  const sessionId = `private-source-${randomUUID()}`;
  await claimSession(actor, sessionId);
  const source = userSource(sessionId);
  const evidence = citation(source, "weekly Cedar report");
  await captureSessionSource(actor, source);
  await drainSessionSources();
  const result = await PrivateMemoryRepository.change(actor, {
    action: "assert",
    claimId: randomUUID(),
    operationId: randomUUID(),
    expectedRevision: null,
    body: {
      text: "Weekly Cedar report",
      sources: [evidence],
      relations: [],
      validTime: null,
    },
  });
  if (!result.applied || !result.claim) throw new Error("Expected publication");
  await query(
    sql`DELETE FROM memory_session_sources WHERE event_id = ${source.eventId}`
  );
  await expect(PrivateMemoryRepository.read(actor)).rejects.toMatchObject({
    reason: "unavailable",
  });
  await expect(
    rebuildSessionSourceReceipts(guest, sessionId)
  ).rejects.toBeInstanceOf(WorkspaceAccessDenied);
  expect(await rebuildSessionSourceReceipts(actor, sessionId)).toEqual({
    restored: 1,
    pending: 0,
  });
  expect(await rebuildSessionSourceReceipts(actor, sessionId)).toEqual({
    restored: 0,
    pending: 0,
  });
  expect((await PrivateMemoryRepository.read(actor)).snapshot.claims).toEqual([
    result.claim,
  ]);
});

test("a source index rebuild does not bypass an existing pending delivery after disk write", async () => {
  await using fixture = await workspaceFixture();
  const { actor } = fixture;
  const sessionId = `private-source-${randomUUID()}`;
  await claimSession(actor, sessionId);
  const source = userSource(sessionId);
  await captureSessionSource(actor, source);
  const [receipt] = await query<{ namespace: string; sequence: number }>(
    sql`SELECT namespace_id AS namespace, capture_sequence::float8 AS sequence FROM memory_session_sources WHERE event_id = ${source.eventId}`
  );
  if (!receipt) throw new Error("Expected source outbox receipt");
  await writeSessionSource(
    directory,
    receipt.namespace,
    source,
    receipt.sequence
  );
  expect(await rebuildSessionSourceReceipts(actor, sessionId)).toEqual({
    restored: 0,
    pending: 1,
  });
  expect(
    await verifySessionClaimSource(
      actor,
      citation(source, "weekly Cedar report")
    )
  ).toBe(false);
  expect(await drainSessionSources()).toEqual({ stored: 1, configured: true });
  expect(
    await verifySessionClaimSource(
      actor,
      citation(source, "weekly Cedar report")
    )
  ).toBe(true);
});
