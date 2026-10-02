/** Real input handling, authority, receipt lock, reducer and approval policy.
 * SQL, native Session and Matrix transport are owning-boundary mocks.
 * Scope observations do not prove PostgreSQL locks or Eve execution. */
import { AsyncLocalStorage } from "node:async_hooks";
import { afterEach, beforeEach, expect, test, vi } from "vitest";
import { PgDialect } from "drizzle-orm/pg-core";
import type { query, transaction } from "@db/queries";
import type { ChannelReceiveContext, Session } from "eve/channels";
import type { InputRequest, MessageStreamEvent } from "eve/client";
import { channelConsentRevision } from "../../agent/lib/channel-consent";
import { authorizeApprovalResponse } from "../../agent/lib/approval-response";
import type { DeliveryState } from "../../agent/lib/durable-delivery";
import { respondToMatrixInput } from "./inputs";
import { WorkspaceAccessDenied } from "../workspaces/access";
import type { matrixRequest } from "./client";

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
vi.mock("./client", async (original) => ({
  ...(await original<typeof import("./client")>()),
  matrixConfiguration: async () => ({
    serverName: "synthetic.invalid",
    botId: "@bot:synthetic.invalid",
  }),
  matrixRequest: mocks.request,
}));
vi.mock("@db/services/sessions", () => ({
  isSessionOwned() {
    throw new Error("Non-Matrix session lookup is forbidden.");
  },
}));
vi.mock("../channels/principal", () => ({
  requireChannelPrincipal() {
    throw new Error("Private channel authorization is forbidden.");
  },
}));

const fixture = {
  original: "$original-request",
  reply: "$decision-reply",
  sessionId: "synthetic-native-session",
  workspaceId: "synthetic-workspace",
  organizationId: "synthetic-organization",
  bindingId: "10000000-0000-4000-8000-000000000001",
  epoch: "20000000-0000-4000-8000-000000000001",
  roomId: "!synthetic:synthetic.invalid",
  userId: "better-auth:original-requester",
  matrixId: "@requester:synthetic.invalid",
};
const request: InputRequest = {
  requestId: "exact-native-request",
  kind: "tool-approval",
  display: "confirmation",
  prompt: "Approve this exact synthetic publication?",
  options: [
    { id: "approve", label: "Approve" },
    { id: "cancel", label: "Cancel" },
  ],
  action: {
    kind: "tool-call",
    callId: "exact-native-call",
    toolName: "synthetic-publication",
    input: {
      approvalMessage: "Publish exact synthetic details to this group",
      body: "Exact synthetic details",
    },
  },
};
const principal = {
  principalType: "user" as const,
  principalId: fixture.userId,
  authenticator: "matrix",
  attributes: {
    workspaceId: fixture.workspaceId,
    workspaceKind: "company",
    matrixIdentityId: fixture.matrixId,
    groupBindingId: fixture.bindingId,
    groupEpoch: fixture.epoch,
    conversationChannel: "matrix",
    matrixEventId: fixture.original,
  },
};
const boundaries = [
  "resolve",
  "tail",
  "snapshot",
  "context",
  "respond",
  "resolution",
] as const;
const scopes = new AsyncLocalStorage<{
  id: number;
  native: boolean;
  locks: Set<string>;
}>();
const nativeExecution = new AsyncLocalStorage<boolean>();
const openAppScopes = new Set<number>();
const trace: {
  boundary: string;
  openAppTransactions: number;
  locks: string[];
}[] = [];
const nativeDecisions: Awaited<ReturnType<typeof authorizeApprovalResponse>>[] =
  [];
const dialect = new PgDialect();
let nextScope = 0;
let guardedBoundary: (typeof boundaries)[number] | undefined;
let originalState = "dispatched";
let replyState = "pending";
let replyUserId = fixture.userId;
let receipt = {
  workspaceId: fixture.workspaceId,
  eventId: fixture.original,
  sessionId: fixture.sessionId,
};
let revoked = false;
let liveEpoch = fixture.epoch;
let pending: InputRequest[] = [];
let snapshotReads = 0;
let deliveredRevision = channelConsentRevision(request);
let changeFreshRevision = false;
let completeAtContext = false;
let responseSessionId = fixture.sessionId;
let emitResolution = true;
let holdResponse: ReturnType<typeof Promise.withResolvers<void>> | undefined;
let responseEntered: ReturnType<typeof Promise.withResolvers<void>> | undefined;
let holdResolution: ReturnType<typeof Promise.withResolvers<void>> | undefined;
let resolutionEntered:
  | ReturnType<typeof Promise.withResolvers<void>>
  | undefined;

function nativeBoundary(boundary: (typeof boundaries)[number]) {
  trace.push({
    boundary,
    openAppTransactions: openAppScopes.size,
    locks: [...(scopes.getStore()?.locks ?? [])],
  });
  if (guardedBoundary === boundary && openAppScopes.size > 0) {
    throw new Error(`Application SQL transaction spans native ${boundary}`);
  }
}
function actorFor(eventId: string) {
  const userId = eventId === fixture.reply ? replyUserId : fixture.userId;
  return {
    userId,
    workspaceId: fixture.workspaceId,
    matrixIdentityId:
      userId === fixture.userId ? fixture.matrixId : "@other:synthetic.invalid",
    groupBindingId: fixture.bindingId,
    groupEpoch: fixture.epoch,
  };
}
function exactReceipt() {
  return (
    receipt.workspaceId === fixture.workspaceId &&
    receipt.eventId === fixture.original &&
    receipt.sessionId === fixture.sessionId
  );
}
function queryRows(statement: Parameters<typeof query>[0]) {
  const { sql: raw, params } = dialect.sqlToQuery(statement);
  const text = raw.replace(/\s+/gu, " ").trim();
  if (/FOR (SHARE|UPDATE)|pg_advisory_xact_lock/u.test(text))
    scopes.getStore()?.locks.add(text);
  if (text.startsWith('SELECT d.user_id AS "userId"')) {
    const eventId = String(params[0]);
    const state = eventId === fixture.original ? originalState : replyState;
    return ["pending", "dispatched", "answer_ready"].includes(state)
      ? [actorFor(eventId)]
      : [];
  }
  if (text.startsWith('SELECT w.id AS "workspaceId"'))
    return [
      {
        workspaceId: fixture.workspaceId,
        organizationId: fixture.organizationId,
      },
    ];
  if (text.startsWith("SELECT id FROM organizations"))
    return [{ id: fixture.organizationId }];
  if (text.startsWith("SELECT pg_advisory_xact_lock")) return [];
  if (text.startsWith("SELECT m.role, w.organization_id"))
    return revoked
      ? []
      : [{ role: "member", organization_id: fixture.organizationId }];
  if (text.startsWith("SELECT user_id FROM organization_memberships"))
    return revoked ? [] : [{ user_id: params[1] }];
  if (text.startsWith("SELECT b.id FROM workspace_group_bindings b")) {
    return !revoked && liveEpoch === params[3]
      ? [{ id: fixture.bindingId }]
      : [];
  }
  if (text.startsWith("SELECT d.message, b.conversation_id"))
    return [{ message: "@Zoen aprovar", roomId: fixture.roomId }];
  if (text.startsWith('SELECT d.event_id AS "eventId"')) {
    return originalState === "dispatched" && replyUserId === fixture.userId
      ? [{ eventId: fixture.original, sessionId: fixture.sessionId }]
      : [];
  }
  if (text.startsWith("UPDATE matrix_deliveries d SET session_id")) {
    expect(params).toEqual([
      fixture.sessionId,
      fixture.original,
      fixture.sessionId,
      fixture.workspaceId,
      fixture.sessionId,
    ]);
    return exactReceipt() &&
      ["pending", "dispatched", "answer_ready"].includes(originalState)
      ? [{ event_id: fixture.original }]
      : [];
  }
  if (
    text.startsWith("SELECT d.event_id FROM matrix_deliveries d") &&
    text.includes("EXISTS (SELECT 1 FROM native_delivery_receipts")
  ) {
    if (text.includes("NOT EXISTS"))
      return params[0] === fixture.reply ? [{ event_id: fixture.reply }] : [];
    expect(params).toEqual([
      fixture.original,
      fixture.bindingId,
      fixture.epoch,
      fixture.userId,
      fixture.sessionId,
      fixture.workspaceId,
      fixture.sessionId,
    ]);
    expect(text).toContain("d.binding_id =");
    expect(text).toContain("d.epoch =");
    expect(text).toContain("d.user_id =");
    expect(text).toContain("d.session_id =");
    expect(text).toContain("r.workspace_id =");
    expect(text).toContain("r.input_id = d.event_id");
    expect(text).toContain("r.session_id =");
    const eligible =
      ["pending", "dispatched", "answer_ready"].includes(originalState) ||
      (originalState === "completed" && text.includes("'completed'"));
    return exactReceipt() &&
      eligible &&
      replyUserId === fixture.userId &&
      liveEpoch === fixture.epoch &&
      !revoked
      ? [{ event_id: fixture.original }]
      : [];
  }
  if (text.startsWith("SELECT 1 FROM matrix_erasure_departures")) return [];
  if (text.startsWith("WITH audience AS MATERIALIZED")) return [];
  if (text.startsWith('SELECT b.conversation_id AS "roomId"'))
    return [{ roomId: fixture.roomId }];
  if (text.startsWith("UPDATE matrix_deliveries SET state")) {
    expect(params).toContain(fixture.reply);
    replyState = text.includes("state = 'completed'")
      ? "completed"
      : String(params[0]);
    return [];
  }
  throw new Error(`Unhandled approval SQL: ${text}`);
}
function inputRequested(): MessageStreamEvent {
  return {
    type: "input.requested",
    meta: { at: "2026-10-01T00:00:00Z", id: "synthetic-requested" },
    data: {
      requests: structuredClone(pending),
      turnId: "synthetic-turn",
      stepIndex: 0,
      sequence: 1,
    },
  };
}
function inputResolved(): MessageStreamEvent {
  return {
    type: "input.resolved",
    meta: { at: "2026-10-01T00:00:01Z", id: "synthetic-resolved" },
    data: {
      resolutions: [
        {
          kind: "tool-approval",
          outcome: "approved",
          requestId: request.requestId,
          response: { requestId: request.requestId, optionId: "approve" },
        },
      ],
      turnId: "synthetic-turn",
      stepIndex: 0,
      sequence: 2,
    },
  };
}
function nativeSession() {
  const session = {
    id: fixture.sessionId,
    send: vi.fn<Session["send"]>(),
    cancel: vi.fn<Session["cancel"]>(),
    clear: vi.fn<Session["clear"]>(),
    compact: vi.fn<Session["compact"]>(),
    reset: vi.fn<Session["reset"]>(),
    getStreamTailIndex: vi.fn<Session["getStreamTailIndex"]>(async () => {
      nativeBoundary("tail");
      return 0;
    }),
    getEventStream: vi.fn<Session["getEventStream"]>(async (options) => {
      const snapshot = (options?.startIndex ?? 0) === 0;
      nativeBoundary(snapshot ? "snapshot" : "resolution");
      if (snapshot) {
        snapshotReads++;
        if (changeFreshRevision && snapshotReads > 1)
          pending = [
            {
              ...request,
              action: {
                ...request.action,
                input: { ...request.action.input, body: "Changed payload" },
              },
            },
          ];
        return new ReadableStream<MessageStreamEvent>({
          start(controller) {
            controller.enqueue(inputRequested());
            controller.close();
          },
        });
      }
      resolutionEntered?.resolve();
      if (holdResolution) await holdResolution.promise;
      return new ReadableStream<MessageStreamEvent>({
        start(controller) {
          if (emitResolution) controller.enqueue(inputResolved());
          controller.close();
        },
      });
    }),
    respond: vi.fn<Session["respond"]>(async (responses, options) => {
      nativeBoundary("respond");
      expect(responses).toEqual([
        { requestId: request.requestId, optionId: "approve" },
      ]);
      expect(options.auth).toEqual(principal);
      responseEntered?.resolve();
      if (holdResponse) await holdResponse.promise;
      const decision = await nativeExecution.run(true, () =>
        scopes.exit(() =>
          authorizeApprovalResponse({
            responder: principal,
            session: { id: fixture.sessionId, initiator: principal },
          })
        )
      );
      nativeDecisions.push(decision);
      expect(decision).toEqual({ status: "allowed" });
      return { status: "accepted", sessionId: responseSessionId };
    }),
  } satisfies Session;
  const channel: ChannelReceiveContext<DeliveryState> = {
    resolveSession: async (address) => {
      nativeBoundary("resolve");
      expect(address).toBe(`session:${fixture.sessionId}`);
      return session;
    },
    from() {
      throw new Error("Native sends are forbidden in approval tests.");
    },
  };
  return { session, channel };
}
function observe<Value>(promise: Promise<Value>) {
  let settled = false;
  const outcome = promise.then(
    (value) => {
      settled = true;
      return { status: "fulfilled" as const, value };
    },
    (reason: unknown) => {
      settled = true;
      return { status: "rejected" as const, reason };
    }
  );
  return {
    outcome,
    settled: () => settled,
    async rejection() {
      const result = await outcome;
      if (result.status !== "rejected") {
        throw new Error("Expected denied Matrix approval completion.");
      }
      return result.reason;
    },
  };
}

beforeEach(() => {
  vi.resetAllMocks();
  nextScope = 0;
  openAppScopes.clear();
  trace.length = 0;
  nativeDecisions.length = 0;
  guardedBoundary = undefined;
  originalState = "dispatched";
  replyState = "pending";
  replyUserId = fixture.userId;
  receipt = {
    workspaceId: fixture.workspaceId,
    eventId: fixture.original,
    sessionId: fixture.sessionId,
  };
  revoked = false;
  liveEpoch = fixture.epoch;
  pending = [structuredClone(request)];
  snapshotReads = 0;
  deliveredRevision = channelConsentRevision(request);
  changeFreshRevision = false;
  completeAtContext = false;
  responseSessionId = fixture.sessionId;
  emitResolution = true;
  holdResponse = undefined;
  responseEntered = undefined;
  holdResolution = undefined;
  resolutionEntered = undefined;
  mocks.fetch.mockRejectedValue(new Error("Real providers are forbidden."));
  vi.stubGlobal("fetch", mocks.fetch);
  mocks.transaction.mockImplementation(async (run, options) => {
    const previous = scopes.getStore();
    if (previous) {
      if (options?.outermost)
        throw new Error("A top-level transaction is required.");
      return run();
    }
    const scope = {
      id: ++nextScope,
      native: nativeExecution.getStore() === true,
      locks: new Set<string>(),
    };
    if (!scope.native) openAppScopes.add(scope.id);
    try {
      return await scopes.run(scope, run);
    } finally {
      openAppScopes.delete(scope.id);
    }
  });
  mocks.query.mockImplementation(async (statement) => queryRows(statement));
  mocks.request.mockImplementation(
    async (method, path): ReturnType<typeof matrixRequest> => {
      if (method === "GET" && path.includes("/context/")) {
        nativeBoundary("context");
        if (completeAtContext) {
          originalState = "completed";
          pending = [];
        }
        return {
          events_before: [
            {
              sender: "@bot:synthetic.invalid",
              content: {
                "dev.zoen.input": {
                  eventId: fixture.original,
                  requestId: request.requestId,
                  revision: deliveredRevision,
                },
              },
            },
          ],
        };
      }
      if (method === "GET" && path.includes("/event/"))
        return {
          event_id: fixture.reply,
          type: "m.room.message",
          room_id: fixture.roomId,
          sender: fixture.matrixId,
          content: { msgtype: "m.text", body: "@Zoen aprovar" },
        };
      if (method === "PUT") return { event_id: "$synthetic-notice" };
      throw new Error(`Unhandled Matrix transport: ${method} ${path}`);
    }
  );
});
afterEach(() => {
  vi.unstubAllGlobals();
});

test.each(boundaries)(
  "holds no application SQL transaction during native %s",
  async (boundary) => {
    guardedBoundary = boundary;
    const { channel, session } = nativeSession();
    const result = await observe(respondToMatrixInput(fixture.reply, channel))
      .outcome;
    expect(result).toEqual({
      status: "fulfilled",
      value: { handled: true, session },
    });
    const observations = trace.filter((item) => item.boundary === boundary);
    expect(observations.length).toBeGreaterThan(0);
    expect(observations.every((item) => item.openAppTransactions === 0)).toBe(
      true
    );
    expect(replyState).toBe("completed");
    expect(openAppScopes.size).toBe(0);
  }
);

test("releases admission before a held native response checker and waits for exact resolution", async () => {
  holdResponse = Promise.withResolvers<void>();
  responseEntered = Promise.withResolvers<void>();
  const { channel, session } = nativeSession();
  const result = observe(respondToMatrixInput(fixture.reply, channel));
  await responseEntered.promise;
  try {
    expect(openAppScopes.size).toBe(0);
    expect(result.settled()).toBe(false);
    expect(replyState).toBe("pending");
  } finally {
    holdResponse.resolve();
  }
  expect(await result.outcome).toEqual({
    status: "fulfilled",
    value: { handled: true, session },
  });
  expect(replyState).toBe("completed");
});

test("keeps accepted input pending with no SQL transaction while its exact resolution stream is held", async () => {
  holdResolution = Promise.withResolvers<void>();
  resolutionEntered = Promise.withResolvers<void>();
  const { channel, session } = nativeSession();
  const result = observe(respondToMatrixInput(fixture.reply, channel));
  await resolutionEntered.promise;
  try {
    expect(session.respond).toHaveBeenCalledTimes(1);
    expect(openAppScopes.size).toBe(0);
    expect(result.settled()).toBe(false);
    expect(replyState).toBe("pending");
  } finally {
    holdResolution.resolve();
  }
  expect(await result.outcome).toEqual({
    status: "fulfilled",
    value: { handled: true, session },
  });
  expect(replyState).toBe("completed");
});

test.each(["workspaceId", "eventId", "sessionId"] as const)(
  "rejects an original native receipt with mismatched %s",
  async (field) => {
    receipt[field] = "unrelated";
    const { channel, session } = nativeSession();
    await expect(
      respondToMatrixInput(fixture.reply, channel)
    ).rejects.toBeInstanceOf(WorkspaceAccessDenied);
    expect(session.respond).not.toHaveBeenCalled();
    expect(replyState).toBe("pending");
  }
);

test("never transfers another human's reply to the original requester", async () => {
  replyUserId = "better-auth:other-human";
  const { channel, session } = nativeSession();
  expect(await respondToMatrixInput(fixture.reply, channel)).toEqual({
    handled: true,
  });
  expect(session.respond).not.toHaveBeenCalled();
  expect(originalState).toBe("dispatched");
});

test("does not respond when the native request action changed under the same request ID", async () => {
  changeFreshRevision = true;
  const { channel, session } = nativeSession();
  expect(await respondToMatrixInput(fixture.reply, channel)).toEqual({
    handled: true,
  });
  expect(session.respond).not.toHaveBeenCalled();
  expect(originalState).toBe("dispatched");
});

test("does not transfer a delivered proposal from a different consent revision", async () => {
  deliveredRevision = "f".repeat(64);
  const { channel, session } = nativeSession();
  expect(await respondToMatrixInput(fixture.reply, channel)).toEqual({
    handled: true,
  });
  expect(session.respond).not.toHaveBeenCalled();
  expect(originalState).toBe("dispatched");
});

test("queue acceptance without the exact resolved request keeps the reply dispatched", async () => {
  emitResolution = false;
  const { channel, session } = nativeSession();
  expect(await respondToMatrixInput(fixture.reply, channel)).toEqual({
    handled: true,
    session,
  });
  expect(session.respond).toHaveBeenCalledTimes(1);
  expect(replyState).toBe("dispatched");
  expect(originalState).toBe("dispatched");
});

test("an accepted response for a foreign native session remains unavailable", async () => {
  responseSessionId = "foreign-native-session";
  const { channel } = nativeSession();
  await expect(
    respondToMatrixInput(fixture.reply, channel)
  ).rejects.toMatchObject({ reason: "unavailable" });
  expect(replyState).toBe("pending");
});

test("acknowledges a fast-completed original only after observing its request is no longer pending", async () => {
  completeAtContext = true;
  const { channel, session } = nativeSession();
  expect(await respondToMatrixInput(fixture.reply, channel)).toEqual({
    handled: true,
  });
  expect(session.respond).not.toHaveBeenCalled();
  expect(originalState).toBe("completed");
  expect(replyState).toBe("completed");
});

test.each(["revocation", "epoch", "receipt"] as const)(
  "denies final completion when %s changes after native policy allowed and before resolution",
  async (change) => {
    holdResolution = Promise.withResolvers<void>();
    resolutionEntered = Promise.withResolvers<void>();
    const { channel, session } = nativeSession();
    const result = observe(respondToMatrixInput(fixture.reply, channel));
    await resolutionEntered.promise;
    try {
      expect(nativeDecisions).toEqual([{ status: "allowed" }]);
      expect(session.respond).toHaveBeenCalledTimes(1);
      expect(openAppScopes.size).toBe(0);
      expect(result.settled()).toBe(false);
      expect(replyState).toBe("pending");
      if (change === "revocation") {
        revoked = true;
      } else if (change === "epoch") {
        liveEpoch = "20000000-0000-4000-8000-000000000002";
      } else {
        receipt.sessionId = "foreign-native-session";
      }
    } finally {
      holdResolution.resolve();
    }
    expect(await result.rejection()).toBeInstanceOf(WorkspaceAccessDenied);
    expect(replyState).toBe("pending");
    expect(originalState).toBe("dispatched");
    expect(openAppScopes.size).toBe(0);
  }
);
