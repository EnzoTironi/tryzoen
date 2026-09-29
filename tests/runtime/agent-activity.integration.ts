import { randomUUID } from "node:crypto";
import { sql } from "drizzle-orm";
import { expect, test } from "vitest";
import { query } from "@db/queries";
import { listAgentActivity } from "@db/services/agent-activity";
import { recordTelemetry } from "../../server/observability/events";
import { claimSession } from "@db/services/sessions";
import { saveChat } from "@db/services/chats";
import { WorkspaceAccessDenied } from "../../server/workspaces/access";
import { workspaceFixture } from "./workspace-fixture";

test("globally pages retained lifecycle metadata without leaking another owner's activity or payload", async () => {
  await using fixture = await workspaceFixture();
  const sessionId = randomUUID();
  const guestSession = randomUUID();
  await claimSession(fixture.actor, sessionId);
  await claimSession(fixture.guest, guestSession);
  await saveChat(fixture.actor, {
    sessionId,
    title: "Synthetic activity review",
  });
  await saveChat(fixture.guest, {
    sessionId: guestSession,
    title: "Private guest conversation",
  });
  const ids = Array.from({ length: 34 }, () => randomUUID());
  for (const [index, id] of ids.entries()) {
    await recordTelemetry({
      id,
      ...fixture.actor,
      sessionId,
      kind: "turn.completed",
      metadata: { private: "Never return this diagnostic" },
    });
    await query(
      sql`UPDATE telemetry_events SET created_at = '2026-09-28T10:00:00Z'::timestamptz + ${index} * interval '1 microsecond', payload = 'Not a decryptable product payload' WHERE id = ${id}`
    );
  }
  await recordTelemetry({
    id: randomUUID(),
    ...fixture.guest,
    sessionId: guestSession,
    kind: "turn.completed",
  });
  // A matching metadata owner is insufficient when the source session belongs to someone else.
  await recordTelemetry({
    id: randomUUID(),
    ...fixture.actor,
    sessionId: guestSession,
    kind: "turn.completed",
  });
  const approval = randomUUID();
  await recordTelemetry({
    id: approval,
    ...fixture.actor,
    sessionId,
    kind: "approval.candidate",
  });
  const first = await listAgentActivity(fixture.actor, {});
  expect(first.items).toHaveLength(30);
  expect(first.items.map((item) => item.id)).toEqual(ids.slice(4).toReversed());
  expect(first.nextCursor).toEqual({
    id: ids[4],
    at: "2026-09-28T10:00:00.000004Z",
  });
  const second = await listAgentActivity(fixture.actor, {
    cursor: first.nextCursor,
  });
  expect(second.items.map((item) => item.id)).toEqual(
    ids.slice(0, 4).toReversed()
  );
  expect(second.nextCursor).toBeNull();
  expect(JSON.stringify(first)).not.toMatch(
    /Private guest|Never return|decryptable/
  );
  expect(
    (await listAgentActivity(fixture.actor, { approvals: true })).items.map(
      (item) => item.id
    )
  ).toEqual([approval]);
  expect((await listAgentActivity(fixture.personal, {})).items).toEqual([]);
  await query(
    sql`DELETE FROM public.session WHERE id = ${fixture.actor.authSessionId}`
  );
  await expect(listAgentActivity(fixture.actor, {})).rejects.toBeInstanceOf(
    WorkspaceAccessDenied
  );
});

test("ties use event identity, and deleting a source conversation removes access to its activity", async () => {
  await using fixture = await workspaceFixture();
  const sessionId = randomUUID();
  await claimSession(fixture.actor, sessionId);
  await saveChat(fixture.actor, {
    sessionId,
    title: "Synthetic cancelled work",
  });
  const prefix = randomUUID();
  for (const suffix of ["a", "b", "c"]) {
    const id = `${prefix}-${suffix}`;
    await recordTelemetry({
      id,
      ...fixture.actor,
      sessionId,
      kind: "turn.cancelled",
    });
    await query(
      sql`UPDATE telemetry_events SET created_at = '2026-09-28T10:00:00.123456Z' WHERE id = ${id}`
    );
  }
  const page = await listAgentActivity(fixture.actor, {
    cursor: { at: "2026-09-28T10:00:00.123456Z", id: `${prefix}-b` },
  });
  expect(page.items.map((item) => item.id)).toEqual([`${prefix}-a`]);
  await query(sql`DELETE FROM chats WHERE session_id = ${sessionId}`);
  expect((await listAgentActivity(fixture.actor, {})).items).toEqual([]);
});
