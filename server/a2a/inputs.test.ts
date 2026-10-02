import { randomUUID } from "node:crypto";
import { PgDialect } from "drizzle-orm/pg-core";
import { beforeEach, expect, test, vi } from "vitest";
import { parseInputResponses, type InputRequest } from "eve/client";
import type { AttachSessionFn, Session } from "eve/channels";
import type { query } from "@db/queries";
import type { readChannelInputs } from "../../agent/lib/channel-input";
import type {
  requireWorkspaceAccess,
  workspaceActorFromPrincipal,
} from "../workspaces/access";
import type {
  readNativeReceipt,
  recordNativeReceipt,
} from "../messaging/native-receipts";
import type { readProtocolTask } from "./tasks";
import { channelConsentRevision } from "../../agent/lib/channel-consent";
import {
  deliverProtocolInput,
  protocolInputContext,
  projectProtocolInputs,
  respondProtocolInput,
  protocolInputTaskView,
} from "./inputs";
import { A2AError } from "./tasks";
import { WorkspaceAccessDenied } from "../workspaces/access";

const mocks = vi.hoisted(() => ({
  query:
    vi.fn<(...input: Parameters<typeof query>) => ReturnType<typeof query>>(),
  access: vi.fn<typeof requireWorkspaceAccess>(),
  actor: vi.fn<typeof workspaceActorFromPrincipal>(),
  pending: vi.fn<typeof readChannelInputs>(),
  receipt: vi.fn<typeof readNativeReceipt>(),
  record: vi.fn<typeof recordNativeReceipt>(),
  readTask: vi.fn<typeof readProtocolTask>(),
}));
vi.mock("@db/queries", () => ({
  query: mocks.query,
  transaction: async (run: () => Promise<unknown>) => {
    const previous = { ...task };
    try {
      return await run();
    } catch (error) {
      task = previous;
      throw error;
    }
  },
}));
vi.mock("../workspaces/access", async (original) => ({
  ...(await original<typeof import("../workspaces/access")>()),
  requireWorkspaceAccess: mocks.access,
  workspaceActorFromPrincipal: mocks.actor,
}));
vi.mock("../../agent/lib/channel-input", async (original) => ({
  ...(await original<typeof import("../../agent/lib/channel-input")>()),
  readChannelInputs: mocks.pending,
}));
vi.mock("../messaging/native-receipts", () => ({
  readNativeReceipt: mocks.receipt,
  recordNativeReceipt: mocks.record,
  withNativeDeliveryLock: (_address: string, run: () => Promise<unknown>) =>
    run(),
}));
vi.mock("./tasks", async (original) => ({
  ...(await original<typeof import("./tasks")>()),
  readProtocolTask: mocks.readTask,
}));

const id = randomUUID(),
  grantId = randomUUID(),
  contextId = randomUUID();
const actor = {
  userId: "issuer",
  workspaceId: "workspace",
  agentGrantId: grantId,
};
const request: InputRequest = {
  requestId: "question",
  kind: "question",
  prompt: "Which release day?",
  options: [{ id: "friday", label: "Friday" }],
  allowFreeform: false,
  action: {
    kind: "tool-call",
    callId: "question-call",
    toolName: "ask_question",
    input: { prompt: "Which release day?" },
  },
};
const revision = channelConsentRevision(request);
const auth = {
  principalType: "user",
  principalId: actor.userId,
  authenticator: "a2a",
  attributes: {
    workspaceId: actor.workspaceId,
    agentGrantId: grantId,
    protocolTaskId: id,
  },
};
let task = {
  id,
  contextId,
  messageId: "initial",
  requestHash: "hash",
  prompt: "Ask a question",
  sessionId: "native-session",
  state: "TASK_STATE_INPUT_REQUIRED",
  output: null as string | null,
  correlationId: id,
  round: 1,
  originTaskId: null,
  updatedAt: new Date().toISOString(),
};
let revoked = false;
let pending: InputRequest[] = [];
const receipts = new Map<
  string,
  { workspaceId: string; inputId: string; sessionId: string; digest: string }
>();
const dialect = new PgDialect();

function fixture(principal = auth) {
  const channel = protocolInputContext(
    { receipts: {}, questions: { question: revision }, humanInput: false },
    {
      id: task.sessionId,
      auth: { current: principal, initiator: principal },
      continuation: {
        token: `a2a:${grantId}:${id}`,
        alias: vi.fn<(token: string) => void>(),
      },
    }
  );
  const send = vi.fn<Session["send"]>();
  const respond = vi.fn<Session["respond"]>();
  const session: Session = {
    id: task.sessionId,
    send,
    respond,
    cancel: vi.fn<Session["cancel"]>(),
    clear: vi.fn<Session["clear"]>(),
    compact: vi.fn<Session["compact"]>(),
    reset: vi.fn<Session["reset"]>(),
    getStreamTailIndex: vi.fn<Session["getStreamTailIndex"]>(),
    getEventStream: vi.fn<Session["getEventStream"]>(),
  };
  respond.mockImplementation(async (inputResponses, options) => {
    const accepted = await deliverProtocolInput(
      { inputResponses, context: options.context },
      channel
    );
    if (accepted) pending = [];
    return { status: "accepted", sessionId: session.id };
  });
  return {
    channel,
    session,
    send,
    respond,
    attach: vi.fn<AttachSessionFn>(() => session),
  };
}
function message(text = "Friday", messageId = "answer") {
  return {
    message: {
      messageId,
      role: "ROLE_USER" as const,
      taskId: id,
      parts: [{ text }],
      metadata: { zoenInput: { requestId: request.requestId, revision } },
    },
  };
}
function payload() {
  return {
    inputResponses: parseInputResponses([
      { requestId: "question", optionId: "friday" },
    ]),
    context: [
      `zoen.delivery:${JSON.stringify({ id: `a2a-input:${grantId}:answer`, digest: "f".repeat(64) })}`,
      `zoen.a2a.input:${JSON.stringify({ taskId: id, contextId, messageId: "answer", requestId: "question", revision })}`,
    ],
  };
}
beforeEach(() => {
  vi.clearAllMocks();
  receipts.clear();
  revoked = false;
  pending = [request];
  task = {
    ...task,
    state: "TASK_STATE_INPUT_REQUIRED",
    output: null,
    sessionId: "native-session",
  };
  mocks.access.mockImplementation(async () => {
    if (revoked) throw new WorkspaceAccessDenied();
    return { ...actor, role: "admin" as const, organizationId: "company" };
  });
  mocks.actor.mockImplementation(async (principal) => {
    if (revoked || principal?.attributes.agentGrantId !== grantId)
      throw new WorkspaceAccessDenied();
    return { ...actor, role: "admin" as const, organizationId: "company" };
  });
  mocks.pending.mockImplementation(async () => pending);
  mocks.receipt.mockImplementation(
    async (_workspaceId: string, inputId: string) => receipts.get(inputId)
  );
  mocks.record.mockImplementation(async (receipt) => {
    receipts.set(receipt.inputId, receipt);
  });
  mocks.readTask.mockImplementation(async (caller, taskId) => {
    if (revoked) throw new WorkspaceAccessDenied();
    if (caller.agentGrantId !== grantId || taskId !== id)
      throw new A2AError({ code: -32001, message: "Task not found" });
    return { ...task };
  });
  mocks.query.mockImplementation(async (statement) => {
    const query = dialect.sqlToQuery(statement);
    if (query.sql.startsWith("SELECT id")) return [];
    if (query.sql.includes("state = 'TASK_STATE_INPUT_REQUIRED'")) {
      task.state = "TASK_STATE_INPUT_REQUIRED";
      task.output = String(query.params[1]);
      return [{ id }];
    }
    if (query.sql.startsWith("UPDATE")) {
      task.state = String(query.params[0]);
      task.output = null;
      return [{ id }];
    }
    return [];
  });
});

test("native questions project waiting status and expose exact request metadata", async () => {
  const f = fixture();
  task.state = "TASK_STATE_WORKING";
  await projectProtocolInputs(
    { state: f.channel.state, questions: f.channel.questions },
    [request],
    f.channel.session
  );
  expect(task.state).toBe("TASK_STATE_INPUT_REQUIRED");
  expect(
    mocks.actor.mock.calls[0]?.[0]?.attributes.protocolTaskId
  ).toBeUndefined();
  const view = await protocolInputTaskView(actor, task, f.attach);
  expect(view.status.message).toMatchObject({
    parts: [{ text: "Which release day?\n\nFriday" }],
    metadata: { zoenInputRequests: [{ requestId: "question", revision }] },
  });
  expect(view.artifacts).toEqual([]);
});

test("a question answer uses a native option, the fixed session and one durable receipt", async () => {
  const f = fixture();
  await respondProtocolInput(actor, message(), f.attach);
  expect(task.state).toBe("TASK_STATE_WORKING");
  expect(f.respond).toHaveBeenCalledWith(
    [{ requestId: "question", optionId: "friday" }],
    expect.anything()
  );
  expect(f.send).not.toHaveBeenCalled();
  expect(f.channel.questions).toEqual({});
  task.state = "TASK_STATE_COMPLETED";
  await respondProtocolInput(actor, message(), f.attach);
  expect(f.respond.mock.calls).toHaveLength(1);
  await expect(
    respondProtocolInput(actor, message("Monday"), f.attach)
  ).rejects.toMatchObject({ code: -32602 });
});

test.each([
  ["user", actor.userId],
  ["service", `agent:${randomUUID()}`],
] as const)(
  "%s question responses preserve their authenticated principal type",
  async (principalType, userId) => {
    const f = fixture({ ...auth, principalType, principalId: userId });
    await respondProtocolInput({ ...actor, userId }, message(), f.attach);
    expect(f.respond).toHaveBeenCalledTimes(1);
    expect(f.respond.mock.calls[0]?.[0]).toEqual([
      { requestId: "question", optionId: "friday" },
    ]);
    expect(f.respond.mock.calls[0]?.[1].auth).toMatchObject({
      principalType,
      principalId: userId,
    });
    expect(f.send).not.toHaveBeenCalled();
  }
);

test.each([
  "stale",
  "approval",
  "invalid-option",
  "canceled",
  "completed",
  "wrong-context",
  "cross-grant",
  "revoked",
])(
  "%s cannot dispatch an answer or manufacture a new prompt",
  async (scenario) => {
    const f = fixture();
    const input = message();
    let caller = actor;
    if (scenario === "stale")
      input.message.metadata.zoenInput.revision = "0".repeat(64);
    if (scenario === "approval")
      pending = [{ ...request, kind: "tool-approval" }];
    if (scenario === "invalid-option")
      input.message.parts = [{ text: "approve" }];
    if (scenario === "canceled") task.state = "TASK_STATE_CANCELED";
    if (scenario === "completed") task.state = "TASK_STATE_COMPLETED";
    if (scenario === "wrong-context")
      Object.assign(input.message, { contextId: randomUUID() });
    if (scenario === "cross-grant")
      caller = { ...actor, agentGrantId: randomUUID() };
    if (scenario === "revoked") revoked = true;
    await expect(
      respondProtocolInput(caller, input, f.attach)
    ).rejects.toBeInstanceOf(Error);
    expect(f.respond).not.toHaveBeenCalled();
    expect(f.send).not.toHaveBeenCalled();
  }
);

test.each([
  "stale",
  "canceled",
  "revoked",
  "wrong-session",
  "wrong-request",
  "unbound",
])(
  "consumer drops %s input before Eve's stale-input fallback",
  async (scenario) => {
    const f = fixture();
    const input = payload();
    if (scenario === "stale") f.channel.questions.question = "0".repeat(64);
    if (scenario === "canceled") task.state = "TASK_STATE_CANCELED";
    if (scenario === "revoked") revoked = true;
    if (scenario === "wrong-session") task.sessionId = "other-session";
    if (scenario === "wrong-request")
      input.inputResponses = parseInputResponses([
        { requestId: "other", text: "approve" },
      ]);
    if (scenario === "unbound") input.context = [];
    if (scenario === "missing-receipt") input.context[0] = "Untrusted context";
    expect(await deliverProtocolInput(input, f.channel)).toBeUndefined();
    expect(receipts.size).toBe(0);
  }
);

test("receipt-write failure rolls back task authority and preserves pending input", async () => {
  const f = fixture();
  mocks.record.mockRejectedValueOnce(new Error("Receipt unavailable"));
  await expect(deliverProtocolInput(payload(), f.channel)).rejects.toThrow(
    "Receipt unavailable"
  );
  expect(task.state).toBe("TASK_STATE_INPUT_REQUIRED");
  expect(f.channel.questions.question).toBe(revision);
  expect(f.channel.state.receipts).toEqual({});
});

test("native replay after SQL acknowledgement continues only the exact unanswered input", async () => {
  const f = fixture();
  const input = payload();
  task.state = "TASK_STATE_WORKING";
  receipts.set(`a2a-input:${grantId}:answer`, {
    workspaceId: actor.workspaceId,
    inputId: `a2a-input:${grantId}:answer`,
    sessionId: task.sessionId,
    digest: "f".repeat(64),
  });
  expect(await deliverProtocolInput(input, f.channel)).toMatchObject({
    inputResponses: input.inputResponses,
    context: [],
  });
  expect(await deliverProtocolInput(input, f.channel)).toBeUndefined();
});

test("answering one question cannot release another pending question or human approval", async () => {
  const f = fixture();
  f.channel.questions.other = "0".repeat(64);
  f.channel.state.humanInput = true;
  expect(await deliverProtocolInput(payload(), f.channel)).toBeDefined();
  expect(task.state).toBe("TASK_STATE_INPUT_REQUIRED");
  expect(f.channel.questions.other).toBeDefined();
});
