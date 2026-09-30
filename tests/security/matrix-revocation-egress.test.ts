/**
 * Acceptance tests keep the production Matrix authority, access, rendering and
 * reply paths. Only SQL and provider transport are mocked. The fake reply GET
 * changes live membership/epoch after the last successful authority read and
 * before the production PUT. This exposes the missing post-read admission
 * fence; it does not exercise PostgreSQL locking, native Eve replay, homeserver
 * membership propagation, or prove cross-system revocation linearizability.
 * The four acceptance cases intentionally remain ordinary failing tests until
 * the owning publish paths reject this transition before payload egress.
 */
import { afterEach, beforeEach, describe, expect, test, vi } from "vitest";
import { PgDialect } from "drizzle-orm/pg-core";
import type { query, transaction } from "@db/queries";
import type { matrixRequest } from "../../server/matrix/client";
import { publishMatrixInputs } from "../../server/matrix/inputs";
import { publishMatrixToolResult } from "../../server/matrix/tool-results";
import { WorkspaceAccessDenied } from "../../server/workspaces/access";
import type { InputRequest } from "eve/client";

const mocks = vi.hoisted(() => ({
  query: vi.fn<typeof query>(),
  transaction: vi.fn<typeof transaction>(),
  request: vi.fn<typeof matrixRequest>(),
  fetch: vi.fn<typeof fetch>(),
}));
vi.mock("@db/queries", () => ({
  query: mocks.query,
  transaction: mocks.transaction,
}));
vi.mock("../../server/matrix/client", async (original) => ({
  ...(await original<typeof import("../../server/matrix/client")>()),
  matrixRequest: mocks.request,
}));

const eventId = "$synthetic-request";
const roomId = "!synthetic-room:synthetic.invalid";
const sessionId = "synthetic-session";
const originalEpoch = "10000000-0000-4000-8000-000000000001";
const replacementEpoch = "10000000-0000-4000-8000-000000000002";
const actor = {
  userId: "better-auth:synthetic-requester",
  workspaceId: "synthetic-company-workspace",
  matrixIdentityId: "@synthetic-requester:synthetic.invalid",
  groupBindingId: "20000000-0000-4000-8000-000000000001",
  groupEpoch: originalEpoch,
};
const principal = {
  authenticator: "matrix",
  principalType: "user" as const,
  principalId: actor.userId,
  attributes: { workspaceId: actor.workspaceId, matrixEventId: eventId },
};
const context = {
  session: {
    id: sessionId,
    auth: { current: principal, initiator: principal },
    turn: { id: "synthetic-turn", sequence: 1 },
  },
  async getSandbox() {
    throw new Error("Sandbox access is forbidden in this acceptance harness.");
  },
  getSkill() {
    throw new Error("Skill access is forbidden in this acceptance harness.");
  },
} satisfies Parameters<typeof publishMatrixToolResult>[1];
const toolResult = {
  sequence: 1,
  stepIndex: 0,
  turnId: "synthetic-turn",
  status: "completed",
  result: {
    callId: "synthetic-message-call",
    kind: "tool-result",
    toolName: "send_message",
    output: { kind: "message", text: "Synthetic protected tool output" },
  },
} satisfies Parameters<typeof publishMatrixToolResult>[0];
const request = {
  requestId: "synthetic-approval-request",
  kind: "tool-approval",
  prompt: "Approve the synthetic action",
  display: "confirmation",
  allowFreeform: false,
  options: [
    { id: "approve", label: "Approve" },
    { id: "cancel", label: "Cancel" },
  ],
  action: {
    callId: "synthetic-approved-call",
    kind: "tool-call",
    toolName: "synthetic-action",
    input: { approvalMessage: "Synthetic protected approval payload" },
  },
} satisfies InputRequest;
const publishers = [
  {
    name: "publishMatrixToolResult",
    body: "Synthetic protected tool output",
    publish: () => publishMatrixToolResult(toolResult, context),
  },
  {
    name: "publishMatrixInputs",
    body: "Synthetic protected approval payload",
    publish: () => publishMatrixInputs(eventId, sessionId, [request]),
  },
] as const;

let requesterMember = true;
let currentEpoch = originalEpoch;
let successfulAuthorityChecks = 0;
let checksAtRevocation = 0;
let afterReplyRead: (() => void) | undefined;
const revocations = [
  {
    name: "requester membership",
    revoke: () => {
      requesterMember = false;
    },
  },
  {
    name: "audience epoch",
    revoke: () => {
      currentEpoch = replacementEpoch;
    },
  },
] as const;
const dialect = new PgDialect();
const putCalls = () =>
  mocks.request.mock.calls.filter(([method]) => method === "PUT");

beforeEach(() => {
  vi.resetAllMocks();
  requesterMember = true;
  currentEpoch = originalEpoch;
  successfulAuthorityChecks = 0;
  checksAtRevocation = 0;
  afterReplyRead = undefined;
  mocks.fetch.mockRejectedValue(
    new Error("Real network access is forbidden in this acceptance harness.")
  );
  vi.stubGlobal("fetch", mocks.fetch);
  // This executes callbacks only; it intentionally simulates no DB locks.
  mocks.transaction.mockImplementation(async (run) => run());
  mocks.query.mockImplementation(async (statement) => {
    const { sql: text, params } = dialect.sqlToQuery(statement);
    if (text.includes('SELECT d.user_id AS "userId"')) return [{ ...actor }];
    if (text.includes("SELECT m.role, w.organization_id"))
      return requesterMember
        ? [{ role: "owner", organization_id: "synthetic-organization" }]
        : [];
    if (text.includes("SELECT user_id FROM organization_memberships"))
      return requesterMember ? [{ user_id: actor.userId }] : [];
    if (text.includes("JOIN matrix_room_members")) {
      if (!params.includes(originalEpoch))
        throw new Error("Authority must check the event's captured epoch.");
      if (currentEpoch !== originalEpoch) return [];
      successfulAuthorityChecks++;
      return [{ id: actor.groupBindingId }];
    }
    if (text.includes('SELECT b.conversation_id AS "roomId"'))
      return [{ roomId }];
    if (text.includes("UPDATE matrix_deliveries SET session_id"))
      return [{ event_id: eventId }];
    throw new Error(`Unexpected SQL in mocked acceptance path: ${text}`);
  });
  mocks.request.mockImplementation(
    async (method, path): ReturnType<typeof matrixRequest> => {
      if (
        method === "GET" &&
        path ===
          `rooms/${encodeURIComponent(roomId)}/event/${encodeURIComponent(eventId)}`
      ) {
        afterReplyRead?.();
        return {
          event_id: eventId,
          type: "m.room.message",
          sender: actor.matrixIdentityId,
          content: { body: "Synthetic original request" },
        };
      }
      if (
        method === "PUT" &&
        path.startsWith(`rooms/${encodeURIComponent(roomId)}/send/`)
      )
        return { event_id: "$synthetic-delivered" };
      throw new Error(`Unexpected Matrix transport call: ${method} ${path}`);
    }
  );
});

afterEach(() => {
  vi.unstubAllGlobals();
});

describe.each(publishers)("$name revocation admission", ({ body, publish }) => {
  test("authorized baseline publishes its material payload to the current room", async () => {
    await publish();
    expect(successfulAuthorityChecks).toBeGreaterThanOrEqual(2);
    expect(putCalls()).toHaveLength(1);
    const sentBody = putCalls()[0]?.[2];
    expect(sentBody).toMatchObject({
      msgtype: "m.text",
      "m.relates_to": { "m.in_reply_to": { event_id: eventId } },
    });
    if (
      sentBody === null ||
      typeof sentBody !== "object" ||
      Array.isArray(sentBody)
    )
      throw new Error("The synthetic provider PUT must have an object body.");
    expect(sentBody.body).toContain(body);
    expect(mocks.fetch).not.toHaveBeenCalled();
  });

  test.each(revocations)(
    "denies $name already revoked before authority admission",
    async ({ revoke }) => {
      revoke();
      await expect(publish()).rejects.toThrow(WorkspaceAccessDenied);
      expect(mocks.request).not.toHaveBeenCalled();
      expect(mocks.fetch).not.toHaveBeenCalled();
    }
  );

  test.each(revocations)(
    "acceptance: $name revoked during reply GET prevents provider PUT (expected red)",
    async ({ revoke }) => {
      afterReplyRead = () => {
        checksAtRevocation = successfulAuthorityChecks;
        revoke();
      };
      // Fail-closed delivery may throw or return without sending. Preserve its
      // outcome while checking the material egress boundary, not an error label.
      await Promise.allSettled([publish()]);
      expect(checksAtRevocation).toBeGreaterThanOrEqual(2);
      expect(mocks.fetch).not.toHaveBeenCalled();
      expect(
        putCalls(),
        "A previously authorized snapshot must not admit protected output after revocation."
      ).toHaveLength(0);
    }
  );
});
