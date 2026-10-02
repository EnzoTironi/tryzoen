import { randomUUID } from "node:crypto";
import { PgDialect } from "drizzle-orm/pg-core";
import { beforeEach, expect, test, vi } from "vitest";
import type { query } from "@db/queries";
import type { requireWorkspaceAccess } from "../workspaces/access";
import type { readNativeReceipt } from "../messaging/native-receipts";
import { acceptProtocolTask, awaitProtocolTask } from "./tasks";

const mocks = vi.hoisted(() => ({
  query:
    vi.fn<(...input: Parameters<typeof query>) => ReturnType<typeof query>>(),
  access: vi.fn<typeof requireWorkspaceAccess>(),
  receipt: vi.fn<typeof readNativeReceipt>(),
}));
vi.mock("@db/queries", () => ({
  query: mocks.query,
  transaction: (run: () => Promise<unknown>) => run(),
}));
vi.mock("../workspaces/access", async (original) => ({
  ...(await original<typeof import("../workspaces/access")>()),
  requireWorkspaceAccess: mocks.access,
}));
vi.mock("../messaging/native-receipts", () => ({
  readNativeReceipt: mocks.receipt,
}));
const id = randomUUID(),
  grantId = randomUUID(),
  contextId = randomUUID();
const actor = {
  userId: "issuer",
  workspaceId: "workspace",
  agentGrantId: grantId,
};
const task = {
  id,
  contextId,
  messageId: "initial",
  requestHash: "hash",
  prompt: "question",
  sessionId: "session",
  state: "TASK_STATE_INPUT_REQUIRED",
  output: "Question?",
  correlationId: id,
  round: 1,
  originTaskId: null,
  updatedAt: new Date().toISOString(),
};
const dialect = new PgDialect();
let active = 0;
function message() {
  return {
    message: {
      messageId: "answer",
      role: "ROLE_USER" as const,
      parts: [{ text: "Yes" }],
      taskId: id,
      metadata: {
        zoenInput: { requestId: "question", revision: "f".repeat(64) },
      },
    },
  };
}
beforeEach(() => {
  vi.clearAllMocks();
  active = 0;
  mocks.access.mockResolvedValue({
    ...actor,
    role: "admin",
    organizationId: "company",
  });
  mocks.receipt.mockResolvedValue(undefined);
  mocks.query.mockImplementation(async (statement) => {
    const query = dialect.sqlToQuery(statement);
    if (query.sql.startsWith("SELECT pg_advisory")) return [];
    if (query.sql.startsWith("SELECT id, request_hash")) return [];
    if (query.sql.startsWith("SELECT id, context_id"))
      return query.params[0] === id && query.params[1] === grantId
        ? [task]
        : [];
    if (query.sql.startsWith("SELECT count"))
      return [
        {
          active: query.sql.includes("TASK_STATE_INPUT_REQUIRED") ? active : 0,
          recent: 0,
        },
      ];
    if (query.sql.includes("LIMIT 1")) return [{ id }];
    if (query.sql.startsWith("SELECT id"))
      return query.sql.includes("TASK_STATE_INPUT_REQUIRED") ? [{ id }] : [];
    throw new Error("Unexpected task query");
  });
});
test("an exact task continuation infers its context and creates no replacement task", async () => {
  expect(await acceptProtocolTask(actor, message())).toMatchObject({
    id,
    contextId,
    sessionId: "session",
  });
  expect(
    mocks.query.mock.calls.some(([statement]) =>
      dialect.sqlToQuery(statement).sql.startsWith("INSERT")
    )
  ).toBe(false);
});
test("mismatched context, missing reference and another grant cannot reopen a task", async () => {
  const wrong = message();
  Object.assign(wrong.message, { contextId: randomUUID() });
  await expect(acceptProtocolTask(actor, wrong)).rejects.toMatchObject({
    code: -32602,
  });
  const { metadata: _metadata, ...missing } = message().message;
  await expect(
    acceptProtocolTask(actor, { message: missing })
  ).rejects.toMatchObject({ code: -32602 });
  await expect(
    acceptProtocolTask({ ...actor, agentGrantId: randomUUID() }, message())
  ).rejects.toMatchObject({ code: -32001 });
});
test("waiting tasks consume active quota and prevent a second task in their context", async () => {
  const { taskId: _taskId, metadata: _metadata, ...start } = message().message;
  active = 5;
  await expect(acceptProtocolTask(actor, { message: start })).rejects.toThrow(
    "Task limit reached"
  );
  active = 0;
  await expect(
    acceptProtocolTask(actor, { message: { ...start, contextId } })
  ).rejects.toThrow("already running in this context");
});
test("a response message ID cannot be reused to start another task", async () => {
  mocks.receipt.mockResolvedValue({
    sessionId: "session",
    digest: "f".repeat(64),
  });
  const { taskId: _taskId, metadata: _metadata, ...start } = message().message;
  await expect(
    acceptProtocolTask(actor, { message: start })
  ).rejects.toMatchObject({ code: -32602 });
});
test("blocking task wait returns when native input is required", async () => {
  expect(await awaitProtocolTask(actor, id)).toMatchObject({
    state: "TASK_STATE_INPUT_REQUIRED",
  });
});
