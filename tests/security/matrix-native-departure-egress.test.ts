/**
 * Real Matrix answer/tool-result delivery and requester authorization; all SQL,
 * native transport and reply lookup boundaries are deterministic mocks.
 * The fixture is a NEW event at the current epoch after local departure. It
 * models a failed native kick/leave: the departed user remains native joined.
 * Native room recipients below are a cross-system assumption, not a provider
 * integration proof. No DB, runtime or provider runs. Acceptance uses the real
 * authority helper and rejects unsafe delivery with WorkspaceAccessDenied.
 * Historical pre-fix PUT/leak reproduction is preserved in
 * /tmp/zoen-security-matrix-red-20260930.log (SHA-256
 * fa87f861c53316d93a4dd8a088b5f974312e27d503fed04bbcad878d22f5b100).
 */
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { z } from "zod";
import type { SQL } from "drizzle-orm";
import { PgDialect } from "drizzle-orm/pg-core";
import type { matrixRequest } from "../../server/matrix/client";
import { publishMatrixAnswer } from "../../server/matrix/delivery";
import { publishMatrixToolResult } from "../../server/matrix/tool-results";
import { WorkspaceAccessDenied } from "../../server/workspaces/access";

const mocks = vi.hoisted(() => ({
  query: vi.fn<(statement: SQL) => Promise<Record<string, unknown>[]>>(),
  request: vi.fn<typeof matrixRequest>(),
}));
vi.mock("@db/queries", () => ({
  query: mocks.query,
  transaction: async <Result>(run: () => Promise<Result>) => run(),
}));
vi.mock("../../server/matrix/client", async () => {
  const { z: schema } = await import("zod");
  return {
    matrixRequest: mocks.request,
    MatrixEventSchema: schema.unknown(),
    MatrixError: class extends Error {},
  };
});
vi.mock("../../server/matrix/replies", () => ({
  matrixReplyRelation: async (_roomId: string, eventId: string) => ({
    "m.in_reply_to": { event_id: eventId },
  }),
}));
vi.mock("../../agent/lib/durable-delivery", () => ({
  sendDurableMessage() {
    throw new Error("Eve runtime calls are forbidden in this mocked test.");
  },
}));

const fixture = {
  eventId: "$synthetic-fresh-event",
  sessionId: "synthetic-fresh-session",
  roomId: "!synthetic-shared-room:synthetic.invalid",
  bindingId: "10000000-0000-4000-8000-000000000001",
  epoch: "20000000-0000-4000-8000-000000000002",
  previousEpoch: "20000000-0000-4000-8000-000000000001",
  workspaceId: "synthetic-workspace",
  organizationId: "synthetic-organization",
  requester: "better-auth:synthetic-remaining-requester",
  requesterMatrixId: "@synthetic-requester:synthetic.invalid",
  departed: "better-auth:synthetic-departed-user",
  output: "Synthetic fresh workspace output produced after departure.",
};
const actor = {
  userId: fixture.requester,
  workspaceId: fixture.workspaceId,
  matrixIdentityId: fixture.requesterMatrixId,
  groupBindingId: fixture.bindingId,
  groupEpoch: fixture.epoch,
};
const principal = {
  authenticator: "matrix",
  principalType: "user" as const,
  principalId: fixture.requester,
  attributes: {
    ...actor,
    matrixEventId: fixture.eventId,
  },
};
const toolContext = {
  getSandbox() {
    throw new Error("Sandbox access is forbidden in this mocked test.");
  },
  getSkill() {
    throw new Error("Skill access is forbidden in this mocked test.");
  },
  session: {
    id: fixture.sessionId,
    auth: { current: principal, initiator: principal },
    turn: { id: "synthetic-fresh-turn", sequence: 1 },
  },
} satisfies Parameters<typeof publishMatrixToolResult>[1];
const toolEvent = {
  status: "completed",
  sequence: 1,
  stepIndex: 1,
  turnId: "synthetic-fresh-turn",
  result: {
    kind: "tool-result",
    toolName: "send_message",
    callId: "synthetic-native-call",
    output: { kind: "message", text: fixture.output },
  },
} satisfies Parameters<typeof publishMatrixToolResult>[0];

const localMembers = new Map<
  string,
  { state: "joined" | "removed" | "left"; native_pending: boolean }
>();
const nativeJoined = new Set<string>();
const nativeReceipts: { recipientId: string; body: string }[] = [];
const dialect = new PgDialect();

function mockRows(statement: SQL) {
  const { sql: text, params } = dialect.sqlToQuery(statement);
  const sql = text.replace(/\s+/gu, " ").trim();
  if (sql.startsWith("SELECT 1 FROM matrix_erasure_departures")) return [];
  if (sql.startsWith("WITH audience AS MATERIALIZED (")) {
    // Interpret the authored egress CTE at its SQL boundary, never replace the
    // real requireMatrixEgress helper or return an unconditional safe audience.
    expect(params).toEqual([
      fixture.bindingId,
      fixture.organizationId,
      fixture.workspaceId,
      fixture.workspaceId,
    ]);
    expect(sql).toContain(
      "SELECT m.user_id, m.state, m.native_pending FROM matrix_room_members m WHERE m.binding_id = $1 FOR SHARE OF m"
    );
    expect(sql).toContain("o.organization_id = $2");
    expect(sql).toContain("w.workspace_id = $3 FOR SHARE OF w, o");
    expect(sql).toContain(
      "m.workspace_id = $4 AND m.revoked_at IS NULL FOR SHARE OF m"
    );
    expect(sql).toContain(
      "SELECT a.user_id FROM audience a WHERE a.native_pending"
    );
    expect(sql).toContain("a.state = 'joined'");
    expect(sql).toContain(
      "NOT EXISTS (SELECT 1 FROM human_access h WHERE h.user_id = a.user_id)"
    );
    expect(sql).toContain(
      "NOT EXISTS (SELECT 1 FROM agent_access g WHERE g.user_id = a.user_id)"
    );
    const unsafe = [...localMembers].find(
      ([userId, member]) =>
        member.native_pending ||
        (member.state === "joined" && userId !== fixture.requester)
    );
    return unsafe ? [{ user_id: unsafe[0] }] : [];
  }
  if (
    sql.startsWith(
      'SELECT w.id AS "workspaceId", w.organization_id AS "organizationId"'
    )
  )
    return [
      {
        workspaceId: fixture.workspaceId,
        organizationId: fixture.organizationId,
      },
    ];
  if (sql.startsWith("SELECT id FROM organizations"))
    return [{ id: fixture.organizationId }];
  if (sql.startsWith("SELECT pg_advisory_xact_lock")) return [];
  if (sql.startsWith("UPDATE matrix_deliveries d SET session_id")) {
    expect(sql).toContain("r.workspace_id");
    expect(sql).toContain("r.input_id = d.event_id");
    expect(sql).toContain("r.session_id");
    expect(params).toEqual([
      fixture.sessionId,
      fixture.eventId,
      fixture.sessionId,
      fixture.workspaceId,
      fixture.sessionId,
    ]);
    // The exact synthetic native consumption receipt belongs to this event,
    // workspace and session; the native departure varies independently.
    return [{ event_id: fixture.eventId }];
  }
  if (sql.startsWith('SELECT d.user_id AS "userId"')) {
    expect(params).toContain(fixture.eventId);
    return [actor];
  }
  if (sql.startsWith("SELECT m.role, w.organization_id")) {
    expect(params).toEqual([fixture.requester, fixture.workspaceId]);
    return [{ role: "owner", organization_id: fixture.organizationId }];
  }
  if (sql.startsWith("SELECT user_id FROM organization_memberships")) {
    expect(params).toEqual([fixture.organizationId, fixture.requester]);
    return [{ user_id: fixture.requester }];
  }
  if (sql.startsWith("SELECT b.id FROM workspace_group_bindings b")) {
    // The real workspace authority checks the requester; room-wide egress
    // admission must also account for other members' pending departures.
    expect(params).toEqual([
      fixture.requester,
      fixture.requesterMatrixId,
      fixture.bindingId,
      fixture.epoch,
      fixture.workspaceId,
    ]);
    return localMembers.get(fixture.requester)?.state === "joined"
      ? [{ id: fixture.bindingId }]
      : [];
  }
  if (sql.startsWith('SELECT b.conversation_id AS "roomId", d.output')) {
    expect(params).toEqual([fixture.eventId]);
    return [
      {
        roomId: fixture.roomId,
        output: fixture.output,
        sessionId: fixture.sessionId,
      },
    ];
  }
  if (
    sql.startsWith(
      'SELECT b.conversation_id AS "roomId" FROM matrix_deliveries'
    )
  ) {
    expect(params).toEqual([fixture.eventId, fixture.sessionId]);
    return [{ roomId: fixture.roomId }];
  }
  if (sql.startsWith("UPDATE matrix_deliveries SET state = 'completed'")) {
    expect(params).toContain(fixture.eventId);
    return [];
  }
  throw new Error(`Unexpected mocked SQL boundary: ${sql}`);
}

beforeEach(() => {
  vi.stubGlobal("fetch", () => {
    throw new Error("Real network calls are forbidden in this mocked test.");
  });
  localMembers.clear();
  localMembers.set(fixture.requester, {
    state: "joined",
    native_pending: false,
  });
  nativeJoined.clear();
  nativeJoined.add(fixture.requester);
  nativeReceipts.length = 0;
  mocks.query
    .mockReset()
    .mockImplementation(async (statement) => mockRows(statement));
  mocks.request.mockReset().mockImplementation(async (method, path, body) => {
    z.literal("PUT").parse(method);
    z.string()
      .startsWith(
        `rooms/${encodeURIComponent(fixture.roomId)}/send/m.room.message/zoen_`
      )
      .parse(path);
    const message = z.object({ body: z.string() }).parse(body);
    // Conditional model of native room delivery: still-joined members receive
    // the room event regardless of the application's local membership state.
    for (const recipientId of nativeJoined)
      nativeReceipts.push({ recipientId, body: message.body });
    return { event_id: "$synthetic-outbound-event" };
  });
});

afterEach(() => {
  vi.unstubAllGlobals();
});

function pendingNativeDeparture(state: "removed" | "left") {
  localMembers.set(fixture.departed, { state, native_pending: true });
  nativeJoined.add(fixture.departed);
  // Epoch mismatch is deliberately absent: this is output for a fresh event
  // from the remaining requester AFTER the revocation changed the room epoch.
}

const deliveryBoundaries = [
  { name: "answer", publish: () => publishMatrixAnswer(fixture.eventId) },
  {
    name: "native tool result",
    publish: () => publishMatrixToolResult(toolEvent, toolContext),
  },
];

describe.each(deliveryBoundaries)(
  "Matrix $name egress during native departure",
  ({ publish }) => {
    it("delivers fresh output to the remaining authorized requester when the native audience is safe", async () => {
      await publish();
      expect(mocks.request).toHaveBeenCalledTimes(1);
      expect(nativeReceipts).toEqual([
        { recipientId: fixture.requester, body: fixture.output },
      ]);
    });

    it.each(["removed", "left"] as const)(
      "delivers fresh output after a locally %s member's native departure is confirmed",
      async (state) => {
        localMembers.set(fixture.departed, { state, native_pending: false });
        nativeJoined.delete(fixture.departed);
        await publish();
        expect(actor.groupEpoch).toBe(fixture.epoch);
        expect(actor.groupEpoch).not.toBe(fixture.previousEpoch);
        expect(localMembers.get(fixture.departed)).toEqual({
          state,
          native_pending: false,
        });
        expect(mocks.request).toHaveBeenCalledTimes(1);
        expect(nativeReceipts).toEqual([
          { recipientId: fixture.requester, body: fixture.output },
        ]);
      }
    );

    it.each(["removed", "left"] as const)(
      "acceptance: denies room output until a locally %s member's native departure is verified",
      async (state) => {
        pendingNativeDeparture(state);
        expect(actor.groupEpoch).toBe(fixture.epoch);
        expect(actor.groupEpoch).not.toBe(fixture.previousEpoch);
        expect(localMembers.get(fixture.departed)).toEqual({
          state,
          native_pending: true,
        });
        expect(nativeJoined.has(fixture.departed)).toBe(true);
        await expect(publish()).rejects.toThrow(WorkspaceAccessDenied);
        expect(
          mocks.request,
          "A fresh authorized requester does not make a native room with a pending departed member safe for output."
        ).not.toHaveBeenCalled();
        expect(nativeReceipts).toEqual([]);
      }
    );
  }
);
