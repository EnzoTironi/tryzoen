import { query } from "@db/queries";
import { sql } from "drizzle-orm";
import { randomUUID } from "node:crypto";

import { afterEach, expect, test, vi } from "vitest";
import type * as Environment from "@shared/environment";

import { workspaceFixture } from "./workspace-fixture";
import {
  ingestClientTelemetry,
  pruneTelemetry,
  recordTelemetry,
  updateTelemetryPolicy,
} from "../../server/observability/events";
import {
  readDiagnosticSession,
  readInsights,
  reviewDiagnostic,
} from "../../server/observability/insights";

const { operators } = vi.hoisted(() => ({ operators: new Array<string>() }));
vi.mock("@shared/environment", async (original) => {
  const actual = await original<typeof Environment>();
  return {
    ...actual,
    env: {
      ...actual.env,
      ZOEN_BETA_FULL_TELEMETRY: true,
      ZOEN_OPERATOR_EMAILS: operators,
    },
  };
});
vi.mock("../../db/services/auth", async () => {
  return {
    getAuth: async () => ({
      $context: Promise.resolve({
        secretConfig: "synthetic-observability-test-key",
      }),
    }),
  };
});
afterEach(() => {
  operators.length = 0;
  vi.restoreAllMocks();
});

test("diagnostics isolate members, redact secrets, encrypt content and deduplicate durable events", async () => {
  await using workspace = await workspaceFixture();
  const { actor, guest, guestPersonal } = workspace;
  const sessionId = `diagnostic-${randomUUID()}`;
  const event = {
    id: randomUUID(),
    workspaceId: actor.workspaceId,
    userId: actor.userId,
    sessionId,
    kind: "step.completed",
    inputTokens: 12,
    outputTokens: 4,
    durationMs: 50,
    payload: {
      message: "synthetic useful context",
      accessToken: "must-not-persist",
    },
  };
  await recordTelemetry(event);
  await recordTelemetry(event);
  const raw = await query(
    sql`SELECT payload FROM telemetry_events WHERE id = ${event.id}`
  );
  expect(raw).toHaveLength(1);
  expect(JSON.stringify(raw)).not.toContain("synthetic useful context");
  const rows = await readDiagnosticSession(actor, sessionId);
  expect(rows.events[0]?.payload).toContain("synthetic useful context");
  expect(rows.events[0]?.payload).not.toContain("must-not-persist");
  expect(
    !(
      await Promise.try(async () =>
        readDiagnosticSession(guest, sessionId)
      ).then(
        (value) => ({ ok: true as const, value }),
        (error: unknown) => ({ ok: false as const, error })
      )
    ).ok
  ).toBe(true);
  expect(
    !(
      await Promise.try(async () =>
        readDiagnosticSession(guestPersonal, sessionId)
      ).then(
        (value) => ({ ok: true as const, value }),
        (error: unknown) => ({ ok: false as const, error })
      )
    ).ok
  ).toBe(true);
  expect((await readInsights(actor)).summary?.input_tokens).toBe(12);
  expect((await readInsights(guest)).summary?.input_tokens).toBe(0);
  await updateTelemetryPolicy(actor, false, 7);
  expect(
    (await readDiagnosticSession(actor, sessionId)).events[0]?.payload
  ).toBeNull();
});

test("platform access requires an allowlisted verified identity and produces audit receipts", async () => {
  await using workspace = await workspaceFixture();
  const { actor, guestPersonal } = workspace;
  const sessionId = `diagnostic-${randomUUID()}`;
  await recordTelemetry({
    id: randomUUID(),
    workspaceId: guestPersonal.workspaceId,
    userId: guestPersonal.userId,
    sessionId,
    kind: "turn.failed",
    status: "failed",
    payload: { message: "synthetic failure" },
  });
  expect(
    !(
      await Promise.try(async () =>
        readDiagnosticSession(actor, sessionId, true)
      ).then(
        (value) => ({ ok: true as const, value }),
        (error: unknown) => ({ ok: false as const, error })
      )
    ).ok
  ).toBe(true);
  operators.push("operator@example.invalid");
  await query(
    sql`UPDATE public.user SET email = 'operator@example.invalid', "emailVerified" = false WHERE ('better-auth:' || id) = ${actor.userId}`
  );
  expect(
    !(
      await Promise.try(async () => readInsights(actor, true)).then(
        (value) => ({ ok: true as const, value }),
        (error: unknown) => ({ ok: false as const, error })
      )
    ).ok
  ).toBe(true);
  await query(
    sql`UPDATE public.user SET "emailVerified" = true WHERE ('better-auth:' || id) = ${actor.userId}`
  );
  expect(
    (await readDiagnosticSession(actor, sessionId, true)).events[0]?.payload
  ).toContain("synthetic failure");
  await reviewDiagnostic(actor, sessionId, "eval-candidate");
  const audit = await query(
    sql`SELECT kind FROM telemetry_events WHERE user_id = ${actor.userId} AND kind LIKE 'telemetry.operator.%'`
  );
  expect(audit).toHaveLength(2);
  await query(
    sql`DELETE FROM public.session WHERE id = ${actor.authSessionId}`
  );
  expect(
    !(
      await Promise.try(async () => readInsights(actor, true)).then(
        (value) => ({ ok: true as const, value }),
        (error: unknown) => ({ ok: false as const, error })
      )
    ).ok
  ).toBe(true);
});

test("client ingest cannot attach diagnostics to another member's agent session", async () => {
  await using workspace = await workspaceFixture();
  const { actor, guest } = workspace;
  const sessionId = randomUUID();
  await query(
    sql`INSERT INTO agent_sessions(session_id, workspace_id, created_by_user_id) VALUES (${sessionId}, ${actor.workspaceId}, ${actor.userId})`
  );
  const batch = {
    batchId: randomUUID(),
    recordingId: randomUUID(),
    kind: "feedback" as const,
    sessionId,
    route: "/chat/:session",
    data: JSON.stringify({ rating: "down" }),
  };
  expect(
    !(
      await Promise.try(async () => ingestClientTelemetry(guest, batch)).then(
        (value) => ({ ok: true as const, value }),
        (error: unknown) => ({ ok: false as const, error })
      )
    ).ok
  ).toBe(true);
  await ingestClientTelemetry(actor, batch);
  expect((await readDiagnosticSession(actor, sessionId)).events).toHaveLength(
    1
  );
});

test("retention erases old content while retaining metrics, then expires old metrics", async () => {
  await using workspace = await workspaceFixture();
  const { actor } = workspace;
  const id = randomUUID();
  await recordTelemetry({
    id,
    workspaceId: actor.workspaceId,
    userId: actor.userId,
    kind: "turn.completed",
    payload: { text: "expire this" },
  });
  await query(
    sql`UPDATE telemetry_events SET created_at = now() - interval '15 days' WHERE id = ${id}`
  );
  await pruneTelemetry();
  const retained = await query(
    sql`SELECT payload FROM telemetry_events WHERE id = ${id}`
  );
  expect(retained).toEqual([{ payload: null }]);
  await query(
    sql`UPDATE telemetry_events SET created_at = now() - interval '91 days' WHERE id = ${id}`
  );
  await pruneTelemetry();
  expect(
    await query(sql`SELECT id FROM telemetry_events WHERE id = ${id}`)
  ).toHaveLength(0);
});

test("diagnostic pages bound payloads and continue without duplicates at identical timestamps", async () => {
  await using workspace = await workspaceFixture();
  const { actor } = workspace;
  const sessionId = `diagnostic-${randomUUID()}`;
  const ids = Array.from({ length: 6 }, () => randomUUID()).toSorted();
  for (const id of ids)
    await recordTelemetry({
      id,
      workspaceId: actor.workspaceId,
      userId: actor.userId,
      sessionId,
      kind: "replay",
      payload: {
        events: Array.from({ length: 10 }, () => "x".repeat(60000)),
      },
    });
  await query(
    sql`UPDATE telemetry_events SET created_at = '2026-09-14T00:00:00Z' WHERE session_id = ${sessionId}`
  );
  const first = await readDiagnosticSession(actor, sessionId);
  expect(first.events.length).toBeLessThan(ids.length);
  expect(new TextEncoder().encode(JSON.stringify(first)).length).toBeLessThan(
    2000000
  );
  const received = first.events.map((event) => event.id);
  let cursor = first.nextCursor;
  for (let page = 0; cursor && page < 6; page++) {
    const next = await readDiagnosticSession(actor, sessionId, false, cursor);
    received.push(...next.events.map((event) => event.id));
    cursor = next.nextCursor;
  }
  expect(cursor).toBeNull();
  expect(received).toEqual(ids);
});
