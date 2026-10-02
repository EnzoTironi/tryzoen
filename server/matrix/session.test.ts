/** Real Matrix publishers and authority; SQL/transport are deterministic mocks.
 * These tests validate admission logic, not PostgreSQL locks or Eve execution. */
import { afterEach, beforeEach, describe, expect, test, vi } from "vitest";
import { z } from "zod";
import type {
  Channel,
  ChannelDefinition,
  ChannelReceiveContext,
  Session,
} from "eve/channels";
import {
  deliveryContext,
  deliverOnce,
  type DeliveryState,
} from "../../agent/lib/durable-delivery";
import { PgDialect } from "drizzle-orm/pg-core";
import type { query, transaction } from "@db/queries";
import type { matrixRequest } from "./client";
import type { InputRequest } from "eve/client";
import { WorkspaceAccessDenied } from "../workspaces/access";
import {
  completeMatrixEvent,
  deliverMatrixEvent,
  finishMatrixEvent,
  publishMatrixAnswer,
  publishMatrixInputNotice,
} from "./delivery";
import { publishMatrixInputs } from "./inputs";
import { publishMatrixToolResult } from "./tool-results";

type MatrixDefinition =
  typeof import("../../agent/channels/matrix").default extends Channel<
    infer State
  >
    ? ChannelDefinition<
        State,
        ReturnType<typeof deliveryContext> & { state: NonNullable<State> }
      >
    : never;
const captured = vi.hoisted(() => {
  const definitions: MatrixDefinition[] = [];
  return { definitions };
});
vi.mock("eve/channels", async (original) => {
  const channels = await original<typeof import("eve/channels")>();
  return {
    ...channels,
    defineChannel(definition: MatrixDefinition) {
      captured.definitions.push(definition);
      return channels.defineChannel(definition);
    },
  };
});

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
  matrixRequest: mocks.request,
}));

// The unrelated A2A channel is never invoked by these callback regressions.
vi.mock("../../agent/channels/a2a", () => ({ default: { routes: [] } }));

// Import registers its authored callbacks without executing an Eve session.
await import("../../agent/channels/matrix");
const capturedMatrix = captured.definitions[0];
if (!capturedMatrix)
  throw new Error("The Matrix channel must register its authored definition.");
const matrix = capturedMatrix;

const fixture = {
  eventId: "$synthetic-native-event",
  sessionId: "session:synthetic-native",
  otherSessionId: "session:synthetic-other",
  roomId: "!synthetic-room:synthetic.invalid",
  workspaceId: "synthetic-company-workspace",
  organizationId: "synthetic-organization",
  bindingId: "10000000-0000-4000-8000-000000000001",
  epoch: "20000000-0000-4000-8000-000000000001",
  userId: "better-auth:synthetic-requester",
  matrixId: "@synthetic-requester:synthetic.invalid",
  output: "Synthetic exact native answer with protected workspace detail.",
};
const actor = {
  userId: fixture.userId,
  workspaceId: fixture.workspaceId,
  matrixIdentityId: fixture.matrixId,
  groupBindingId: fixture.bindingId,
  groupEpoch: fixture.epoch,
};
const principal = {
  principalId: fixture.userId,
  principalType: "user" as const,
  authenticator: "matrix",
  attributes: {
    workspaceId: fixture.workspaceId,
    matrixEventId: fixture.eventId,
  },
};
const context = {
  session: {
    id: fixture.sessionId,
    auth: { current: principal, initiator: principal },
    turn: { id: "synthetic-turn", sequence: 1 },
  },
  getSandbox() {
    throw new Error("Runtime sandbox access is forbidden.");
  },
  getSkill() {
    throw new Error("Runtime skill access is forbidden.");
  },
} satisfies Parameters<typeof publishMatrixToolResult>[1];
const toolResult = {
  sequence: 1,
  stepIndex: 1,
  turnId: "synthetic-turn",
  status: "completed",
  result: {
    kind: "tool-result",
    toolName: "send_message",
    callId: "synthetic-native-call",
    output: { kind: "message", text: fixture.output },
  },
} satisfies Parameters<typeof publishMatrixToolResult>[0];
const inputRequest = {
  requestId: "synthetic-approval",
  kind: "tool-approval",
  display: "confirmation",
  prompt: "Approve this exact synthetic action?",
  options: [
    { id: "approve", label: "Approve" },
    { id: "cancel", label: "Cancel" },
  ],
  action: {
    kind: "tool-call",
    callId: "synthetic-pending-call",
    toolName: "synthetic-action",
    input: { approvalMessage: fixture.output },
  },
} satisfies InputRequest;
const dialect = new PgDialect();
let deliverySessionId: string | null = fixture.sessionId;
let receiptSessionId: string | undefined = fixture.sessionId;
let receiptWorkspaceId = fixture.workspaceId;
let receiptEventId = fixture.eventId;
let receiptDigest = "a".repeat(64);
let deliveryState = "dispatched";
let storedOutput: string | null = fixture.output;
let stagingWrites = 0;
let pendingDeparture = false;
let afterRoomFence: (() => void) | undefined;

function receiptMatches(sessionId: string) {
  return (
    receiptSessionId === sessionId &&
    receiptWorkspaceId === fixture.workspaceId &&
    receiptEventId === fixture.eventId
  );
}

function queryRows(statement: Parameters<typeof query>[0]) {
  const { sql: raw, params } = dialect.sqlToQuery(statement);
  const text = raw.replace(/\s+/gu, " ").trim();
  if (text.includes("native_delivery_receipts")) {
    if (
      text.startsWith(
        'SELECT session_id AS "sessionId", digest FROM native_delivery_receipts'
      )
    ) {
      expect(params).toEqual([fixture.workspaceId, fixture.eventId]);
      return receiptSessionId !== undefined &&
        receiptWorkspaceId === fixture.workspaceId &&
        receiptEventId === fixture.eventId
        ? [{ sessionId: receiptSessionId, digest: receiptDigest }]
        : [];
    }
    if (text.startsWith("INSERT INTO native_delivery_receipts")) {
      const [workspaceId, inputId, sessionId, digest] = z
        .tuple([z.string(), z.string(), z.string(), z.string()])
        .parse(params);
      receiptWorkspaceId = workspaceId;
      receiptEventId = inputId;
      receiptSessionId = sessionId;
      receiptDigest = digest;
      return [{ input_id: inputId }];
    }
    if (text.includes("NOT EXISTS")) {
      expect(params).toEqual([fixture.eventId, fixture.workspaceId]);
      const exists =
        receiptSessionId !== undefined &&
        receiptWorkspaceId === fixture.workspaceId &&
        receiptEventId === fixture.eventId;
      return deliverySessionId === null && !exists
        ? [{ event_id: fixture.eventId }]
        : [];
    }
    const requested = params.find(
      (value) => typeof value === "string" && value.startsWith("session:")
    );
    if (typeof requested !== "string") return [];
    if (
      text.startsWith("SELECT d.event_id") &&
      text.includes("d.state = 'completed'")
    ) {
      expect(text).toContain("d.session_id =");
      return deliveryState === "completed" &&
        deliverySessionId === requested &&
        receiptMatches(requested)
        ? [{ event_id: fixture.eventId }]
        : [];
    }
    expect(params).toContain(fixture.eventId);
    if (
      !receiptMatches(requested) ||
      (deliverySessionId !== null && deliverySessionId !== requested)
    )
      return [];
    if (text.startsWith("UPDATE matrix_deliveries")) {
      expect(text).toContain(
        "d.state IN ('pending', 'dispatched', 'answer_ready')"
      );
      if (!["pending", "dispatched", "answer_ready"].includes(deliveryState))
        return [];
      deliverySessionId = requested;
    }
    return [
      {
        event_id: fixture.eventId,
        sessionId: requested,
        session_id: requested,
      },
    ];
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
  if (text.startsWith("SELECT pg_advisory_xact_lock")) {
    const transition = afterRoomFence;
    afterRoomFence = undefined;
    transition?.();
    return [];
  }
  if (text.startsWith("SELECT d.prompt, d.message, d.state"))
    return [
      {
        prompt: "Synthetic native prompt",
        message: "Synthetic input",
        roomId: fixture.roomId,
        state: deliveryState,
      },
    ];
  if (text.startsWith("SELECT prompt FROM matrix_deliveries"))
    return [{ prompt: "Synthetic native prompt" }];
  if (text.startsWith('SELECT d.user_id AS "userId"'))
    return ["pending", "dispatched", "answer_ready"].includes(deliveryState)
      ? [actor]
      : [];
  if (text.startsWith("SELECT m.role, w.organization_id"))
    return [{ role: "owner", organization_id: fixture.organizationId }];
  if (text.startsWith("SELECT user_id FROM organization_memberships"))
    return [{ user_id: fixture.userId }];
  if (text.startsWith("SELECT b.id FROM workspace_group_bindings b"))
    return [{ id: fixture.bindingId }];
  if (text.startsWith("SELECT 1 FROM matrix_erasure_departures")) {
    expect(params).toEqual([fixture.bindingId]);
    return pendingDeparture ? [{ "?column?": 1 }] : [];
  }
  if (text.startsWith("WITH audience AS MATERIALIZED")) return [];
  if (text.startsWith('SELECT b.conversation_id AS "roomId", d.output'))
    return deliveryState === "answer_ready"
      ? [
          {
            roomId: fixture.roomId,
            output: storedOutput,
            sessionId: deliverySessionId,
          },
        ]
      : [];
  if (text.startsWith('SELECT b.conversation_id AS "roomId"')) {
    const requested = params.find(
      (value) => typeof value === "string" && value.startsWith("session:")
    );
    return requested === undefined ||
      deliverySessionId === null ||
      requested === deliverySessionId
      ? [{ roomId: fixture.roomId }]
      : [];
  }
  if (text.startsWith("UPDATE matrix_deliveries SET session_id")) {
    const requested = params.find(
      (value) => typeof value === "string" && value.startsWith("session:")
    );
    if (
      typeof requested !== "string" ||
      (deliverySessionId !== null && deliverySessionId !== requested)
    )
      return [];
    deliverySessionId = requested;
    deliveryState = "dispatched";
    return [{ event_id: fixture.eventId }];
  }
  if (text.startsWith("UPDATE matrix_deliveries SET output")) {
    const output = params[0];
    if (typeof output !== "string")
      throw new Error("Synthetic answer staging must preserve exact text.");
    storedOutput = output;
    stagingWrites++;
    deliveryState = "answer_ready";
    return [{ event_id: fixture.eventId }];
  }
  if (text.startsWith("UPDATE matrix_deliveries SET state = 'completed'")) {
    deliveryState = "completed";
    return [{ event_id: fixture.eventId }];
  }
  throw new Error(`Unexpected exact-session SQL: ${text}`);
}

beforeEach(() => {
  vi.resetAllMocks();
  deliverySessionId = fixture.sessionId;
  receiptSessionId = fixture.sessionId;
  receiptWorkspaceId = fixture.workspaceId;
  receiptEventId = fixture.eventId;
  receiptDigest = "a".repeat(64);
  deliveryState = "dispatched";
  storedOutput = fixture.output;
  stagingWrites = 0;
  pendingDeparture = false;
  afterRoomFence = undefined;
  mocks.fetch.mockRejectedValue(
    new Error("Real providers are forbidden in this acceptance test.")
  );
  vi.stubGlobal("fetch", mocks.fetch);
  mocks.transaction.mockImplementation(async (run) => run());
  mocks.query.mockImplementation(async (statement) => queryRows(statement));
  mocks.request.mockImplementation(
    async (method, path): ReturnType<typeof matrixRequest> => {
      if (
        method === "GET" &&
        path.endsWith(`/event/${encodeURIComponent(fixture.eventId)}`)
      )
        return {
          event_id: fixture.eventId,
          type: "m.room.message",
          sender: fixture.matrixId,
          content: { body: "Synthetic input" },
        };
      if (method === "PUT") return { event_id: "$synthetic-output" };
      throw new Error(`Unexpected synthetic transport: ${method} ${path}`);
    }
  );
});
afterEach(() => vi.unstubAllGlobals());

const publishers = [
  {
    name: "native tool result",
    publish: () => publishMatrixToolResult(toolResult, context),
  },
  {
    name: "native approval",
    publish: () =>
      publishMatrixInputs(fixture.eventId, fixture.sessionId, [inputRequest]),
  },
  {
    name: "native answer",
    publish: () =>
      finishMatrixEvent(fixture.eventId, fixture.sessionId, fixture.output),
  },
];
const invalidBindings = [
  {
    name: "missing native receipt",
    alter: () => {
      receiptSessionId = undefined;
    },
  },
  {
    name: "receipt from another workspace",
    alter: () => {
      receiptWorkspaceId = "another-workspace";
    },
  },
  {
    name: "receipt from another event",
    alter: () => {
      receiptEventId = "$another-event";
    },
  },
  {
    name: "receipt from another session",
    alter: () => {
      receiptSessionId = fixture.otherSessionId;
    },
  },
  {
    name: "delivery already bound to another session",
    alter: () => {
      deliverySessionId = fixture.otherSessionId;
    },
  },
];

describe.each(publishers)(
  "Matrix $name exact native provenance",
  ({ publish }) => {
    test.each(invalidBindings)(
      "rejects $name before any native output",
      async ({ alter }) => {
        alter();
        await expect(publish()).rejects.toThrow(WorkspaceAccessDenied);
        expect(mocks.request).not.toHaveBeenCalled();
        expect(mocks.fetch).not.toHaveBeenCalled();
        expect(deliveryState).toBe("dispatched");
      }
    );
    test("denies a callback whose delivery completed while waiting for the room fence", async () => {
      afterRoomFence = () => {
        deliveryState = "completed";
      };
      await expect(publish()).rejects.toThrow(WorkspaceAccessDenied);
      expect(deliveryState).toBe("completed");
      expect(stagingWrites).toBe(0);
      expect(mocks.request).not.toHaveBeenCalled();
    });
    test.each(["already-bound", "first-fast-callback"])(
      "accepts an exact receipt for %s without replacing its session",
      async (mode) => {
        if (mode === "first-fast-callback") deliverySessionId = null;
        await publish();
        expect(deliverySessionId).toBe(fixture.sessionId);
        const puts = mocks.request.mock.calls.filter(
          ([method]) => method === "PUT"
        );
        expect(puts).toHaveLength(1);
        expect(
          z.object({ body: z.string() }).parse(puts[0]?.[2]).body
        ).toContain(fixture.output);
        expect(mocks.fetch).not.toHaveBeenCalled();
      }
    );
  }
);

test.each(invalidBindings)(
  "persisted answer rejects $name without releasing its stored output",
  async ({ alter }) => {
    deliveryState = "answer_ready";
    alter();
    await expect(publishMatrixAnswer(fixture.eventId)).rejects.toThrow(
      WorkspaceAccessDenied
    );
    expect(mocks.request).not.toHaveBeenCalled();
    expect(deliveryState).toBe("answer_ready");
  }
);

test("persisted answer cannot release an unbound session", async () => {
  deliveryState = "answer_ready";
  deliverySessionId = null;
  await expect(publishMatrixAnswer(fixture.eventId)).rejects.toThrow(
    WorkspaceAccessDenied
  );
  expect(mocks.request).not.toHaveBeenCalled();
});

test("pending independent departure prevents releasing a persisted native answer", async () => {
  deliveryState = "answer_ready";
  pendingDeparture = true;
  await expect(publishMatrixAnswer(fixture.eventId)).rejects.toThrow(
    WorkspaceAccessDenied
  );
  expect(
    mocks.request.mock.calls.filter(([method]) => method === "PUT")
  ).toHaveLength(0);
  expect(storedOutput).toBe(fixture.output);
  expect(deliveryState).toBe("answer_ready");
  expect(mocks.fetch).not.toHaveBeenCalled();
});

test("pending independent departure also blocks the fixed pre-native notice", async () => {
  deliveryState = "pending";
  deliverySessionId = null;
  receiptSessionId = undefined;
  pendingDeparture = true;
  await expect(
    publishMatrixInputNotice(fixture.eventId, "ambiguous")
  ).rejects.toThrow(WorkspaceAccessDenied);
  expect(mocks.request).not.toHaveBeenCalled();
  expect(deliveryState).toBe("pending");
  expect(stagingWrites).toBe(0);
});

test("native completion cannot retire another session's delivery", async () => {
  receiptSessionId = fixture.otherSessionId;
  await expect(
    completeMatrixEvent(fixture.eventId, fixture.sessionId)
  ).rejects.toThrow(WorkspaceAccessDenied);
  expect(deliveryState).toBe("dispatched");
  expect(mocks.request).not.toHaveBeenCalled();
});

test.each(["ambiguous", "resolved", "undelivered"] as const)(
  "publishes only fixed %s notices for a pre-native inbound event",
  async (notice) => {
    deliverySessionId = null;
    receiptSessionId = undefined;
    deliveryState = "pending";
    await publishMatrixInputNotice(fixture.eventId, notice);
    const puts = mocks.request.mock.calls.filter(
      ([method]) => method === "PUT"
    );
    expect(puts).toHaveLength(1);
    const body = z.object({ body: z.string() }).parse(puts[0]?.[2]).body;
    expect(body).toContain("Nenhuma");
    expect(body).not.toContain(fixture.output);
    expect(stagingWrites).toBe(0);
    expect(deliverySessionId).toBeNull();
    expect(deliveryState).toBe("completed");
  }
);

test.each(["bound session", "unbound consumed event"])(
  "fixed notices reject a %s",
  async (mode) => {
    if (mode === "unbound consumed event") deliverySessionId = null;
    await expect(
      publishMatrixInputNotice(fixture.eventId, "ambiguous")
    ).rejects.toThrow(WorkspaceAccessDenied);
    expect(mocks.request).not.toHaveBeenCalled();
    expect(deliveryState).toBe("dispatched");
  }
);

function callbackChannel() {
  if (!matrix.context)
    throw new Error(
      "The authored Matrix channel requires its context factory."
    );
  const continuation = {
    token: `matrix:${fixture.eventId}`,
    alias: vi.fn<(token: string) => void>(),
  };
  return {
    ...matrix.context(
      { receipts: {} },
      { id: fixture.sessionId, auth: context.session.auth, continuation }
    ),
    continuation,
  };
}

test("settled native callback forwards its exact session and answer", async () => {
  const channel = callbackChannel();
  const events = matrix.events;
  if (!events?.["message.completed"] || !events["turn.completed"])
    throw new Error("Native Matrix callbacks are required.");
  await events["message.completed"](
    {
      sequence: 1,
      stepIndex: 1,
      turnId: "synthetic-turn",
      finishReason: "stop",
      message: fixture.output,
    },
    channel,
    context
  );
  await events["turn.completed"](
    { sequence: 1, turnId: "synthetic-turn" },
    channel,
    context
  );
  const puts = mocks.request.mock.calls.filter(([method]) => method === "PUT");
  expect(puts).toHaveLength(1);
  expect(z.object({ body: z.string() }).parse(puts[0]?.[2]).body).toBe(
    fixture.output
  );
  expect(deliveryState).toBe("completed");
});

test("session.failed forwards the event's exact native session", async () => {
  const handler = matrix.events?.["session.failed"];
  if (!handler) throw new Error("Native Matrix failure callback is required.");
  await handler(
    {
      code: "SYNTHETIC_FAILURE",
      message: "Synthetic failure",
      sessionId: fixture.sessionId,
    },
    callbackChannel()
  );
  const puts = mocks.request.mock.calls.filter(([method]) => method === "PUT");
  expect(puts).toHaveLength(1);
  expect(z.object({ body: z.string() }).parse(puts[0]?.[2]).body).toContain(
    "Não consegui concluir"
  );
  expect(deliveryState).toBe("completed");
});

test("session.failed ignores a stale event from a different session than its channel context", async () => {
  const handler = matrix.events?.["session.failed"];
  if (!handler) throw new Error("Native Matrix failure callback is required.");
  await handler(
    {
      code: "SYNTHETIC_FAILURE",
      message: "Synthetic failure",
      sessionId: fixture.otherSessionId,
    },
    callbackChannel()
  );
  expect(mocks.query).not.toHaveBeenCalled();
  expect(mocks.request).not.toHaveBeenCalled();
  expect(stagingWrites).toBe(0);
});

function nativeSession(id: string): Session {
  return {
    id,
    cancel: vi.fn<Session["cancel"]>(),
    clear: vi.fn<Session["clear"]>(),
    compact: vi.fn<Session["compact"]>(),
    getEventStream: vi.fn<Session["getEventStream"]>(),
    getStreamTailIndex: vi.fn<Session["getStreamTailIndex"]>(),
    reset: vi.fn<Session["reset"]>(),
    respond: vi.fn<Session["respond"]>(),
    send: vi.fn<Session["send"]>(),
  };
}

test.each(["exact", "unbound"] as const)(
  "fast-terminal acknowledgement requires an %s existing session binding",
  async (mode) => {
    deliveryState = "pending";
    deliverySessionId = null;
    receiptSessionId = undefined;
    const aliases = new Set<string>();
    const consumer = nativeSession(fixture.sessionId);
    const channelContext = deliveryContext(
      { receipts: {} },
      {
        id: fixture.sessionId,
        auth: context.session.auth,
        continuation: {
          token: `matrix:${fixture.eventId}`,
          alias: (address) => {
            aliases.add(address);
          },
        },
      }
    );
    const source: ReturnType<ChannelReceiveContext<DeliveryState>["from"]> = {
      cancel:
        vi.fn<
          ReturnType<ChannelReceiveContext<DeliveryState>["from"]>["cancel"]
        >(),
      clear:
        vi.fn<
          ReturnType<ChannelReceiveContext<DeliveryState>["from"]>["clear"]
        >(),
      compact:
        vi.fn<
          ReturnType<ChannelReceiveContext<DeliveryState>["from"]>["compact"]
        >(),
      reset:
        vi.fn<
          ReturnType<ChannelReceiveContext<DeliveryState>["from"]>["reset"]
        >(),
      respond:
        vi.fn<
          ReturnType<ChannelReceiveContext<DeliveryState>["from"]>["respond"]
        >(),
      send: async (message, options) => {
        if (typeof message !== "string")
          throw new Error("The fake runtime accepts text only.");
        await deliverOnce(
          { message, context: options.context },
          channelContext
        );
        await completeMatrixEvent(fixture.eventId, fixture.sessionId);
        return nativeSession("session:losing-candidate");
      },
    };
    const channel: ChannelReceiveContext<DeliveryState> = {
      from: () => source,
      resolveSession: async (address) => {
        if (!aliases.has(address)) return undefined;
        if (mode === "unbound") deliverySessionId = null;
        return consumer;
      },
    };
    const result = await deliverMatrixEvent(fixture.eventId, channel).then(
      (session) => ({ session, error: undefined }),
      (error: unknown) => ({ session: undefined, error })
    );
    expect(result.session).toBe(mode === "exact" ? consumer : undefined);
    expect(result.error instanceof WorkspaceAccessDenied).toBe(
      mode === "unbound"
    );
    expect(deliveryState).toBe("completed");
    expect(deliverySessionId).toBe(mode === "exact" ? fixture.sessionId : null);
    expect(mocks.request).not.toHaveBeenCalled();
    expect(stagingWrites).toBe(0);
  }
);
