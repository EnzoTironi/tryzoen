import { createHash, randomUUID } from "node:crypto";
import { fileURLToPath } from "node:url";
import { sql } from "drizzle-orm";
import { z } from "zod";
import { inputRequestSchema } from "eve/client";
import { channelConsentRevision } from "../../agent/lib/channel-consent";
import { afterAll, beforeAll, expect, test } from "vitest";
import { query } from "@db/queries";
import {
  compileEveFixture,
  clearFixtureWorkflows,
  runtime,
} from "./eve-fixture";
import { workspaceFixture } from "./workspace-fixture";
import {
  saveWorkspaceBot,
  revokeAgentGrant,
} from "../../server/workspaces/bots";
import { requireWorkspaceAccess } from "../../server/workspaces/access";
import { registerExternalAgentMember } from "../../server/workspaces/agent-members";

const directory = fileURLToPath(
  new URL("../fixtures/eve-a2a-input/", import.meta.url)
);
const port = 4387;
const taskSchema = z.object({
  id: z.uuid(),
  contextId: z.uuid(),
  status: z.object({
    state: z.string(),
    message: z
      .object({
        parts: z.array(z.object({ text: z.string() })),
        metadata: z
          .object({
            zoenInputRequests: z.array(
              z.object({ requestId: z.string(), revision: z.string() })
            ),
          })
          .optional(),
      })
      .optional(),
  }),
  artifacts: z.array(z.unknown()).optional(),
});
beforeAll(async () => {
  await clearFixtureWorkflows();
  await compileEveFixture(directory);
}, 65000);
afterAll(clearFixtureWorkflows);

async function grants(workspace: Awaited<ReturnType<typeof workspaceFixture>>) {
  const bot = await saveWorkspaceBot(workspace.actor, {
    username: `a2a_${randomUUID().replaceAll("-", "").slice(0, 12)}`,
    name: "Synthetic A2A input proof",
    description: "Isolated test fixture",
    discoverable: false,
  });
  const { member } = await registerExternalAgentMember(workspace.actor, {
    operationId: randomUUID(),
    username: "a2a_input_caller",
    name: "Synthetic A2A input caller",
  });
  // Fixed test-only bearer fixtures; never generate, rotate or use live credentials.
  const tokens = [`zoen_a2a_${"A".repeat(43)}`, `zoen_a2a_${"B".repeat(43)}`];
  const ids = [randomUUID(), randomUUID()];
  for (let index = 0; index < ids.length; index++)
    await query(sql`INSERT INTO workspace_agent_grants(id, bot_id, issued_by, external_member_id, label, token_hash, capabilities, expires_at)
    VALUES (${ids[index]}, ${bot.id}, ${workspace.actor.userId}, ${member.id}, 'Synthetic fixed bearer', ${createHash(
      "sha256"
    )
      .update(tokens[index] ?? "")
      .digest("hex")}, '["files"]'::jsonb, now() + interval '1 hour')`);
  return { username: bot.username, principal: member.principal, ids, tokens };
}
async function rpc(
  username: string,
  token: string,
  method: string,
  params: unknown
) {
  const response = await fetch(`http://127.0.0.1:${port}/agents/${username}`, {
    method: "POST",
    headers: {
      "content-type": "application/json",
      authorization: `Bearer ${token}`,
    },
    body: JSON.stringify({ jsonrpc: "2.0", id: randomUUID(), method, params }),
    signal: AbortSignal.timeout(60000),
  });
  return {
    status: response.status,
    body: z
      .object({
        result: z.unknown().optional(),
        error: z.object({ code: z.number(), message: z.string() }).optional(),
      })
      .parse(await response.json()),
  };
}
async function start(
  identity: Awaited<ReturnType<typeof grants>>,
  prompt = "question"
) {
  const response = await rpc(
    identity.username,
    identity.tokens[0] ?? "",
    "SendMessage",
    {
      message: {
        messageId: randomUUID(),
        role: "ROLE_USER",
        parts: [{ text: prompt }],
      },
    }
  );
  expect(response.body.error).toBeUndefined();
  const task = z.object({ task: taskSchema }).parse(response.body.result).task;
  expect(task.status.state).toBe("TASK_STATE_INPUT_REQUIRED");
  expect(task.artifacts).toEqual([]);
  expect(task.status.message?.parts[0]?.text).toContain("Which release day?");
  const reference = task.status.message?.metadata?.zoenInputRequests[0];
  if (!reference) throw new Error("Native pending question metadata missing");
  return { task, reference };
}
function answer(
  input: Awaited<ReturnType<typeof start>>,
  messageId = randomUUID(),
  text = "Friday"
) {
  return {
    message: {
      messageId,
      role: "ROLE_USER",
      taskId: input.task.id,
      parts: [{ text }],
      metadata: { zoenInput: input.reference },
    },
  };
}
async function completed(
  identity: Awaited<ReturnType<typeof grants>>,
  id: string
) {
  let task: z.output<typeof taskSchema> | undefined;
  await expect
    .poll(
      async () => {
        task = taskSchema.parse(
          (
            await rpc(identity.username, identity.tokens[0] ?? "", "GetTask", {
              id,
            })
          ).body.result
        );
        return task.status.state;
      },
      { timeout: 30000, interval: 100 }
    )
    .toBe("TASK_STATE_COMPLETED");
  return task;
}
async function binding(id: string) {
  return (
    await query<{ sessionId: string; grantId: string }>(
      sql`SELECT session_id AS "sessionId", grant_id AS "grantId" FROM agent_protocol_tasks WHERE id = ${id}`
    )
  )[0];
}

test(
  "a parked native question survives restart and exact retries complete the same task/session once",
  { timeout: 90000 },
  async () => {
    await using workspace = await workspaceFixture();
    const identity = await grants(workspace);
    let server = await runtime(port, "127.0.0.1", directory);
    const input = await start(identity);
    const original = await binding(input.task.id);
    expect(original?.sessionId).toBeTruthy();
    await expect(
      requireWorkspaceAccess({
        ...workspace.actor,
        userId: identity.principal,
        authSessionId: undefined,
        agentGrantId: identity.ids[0],
        protocolTaskId: input.task.id,
      })
    ).rejects.toBeInstanceOf(Error);
    await server.stop();
    server = await runtime(port, "127.0.0.1", directory);
    const waiting = taskSchema.parse(
      (
        await rpc(identity.username, identity.tokens[0] ?? "", "GetTask", {
          id: input.task.id,
        })
      ).body.result
    );
    expect(waiting.status.message?.metadata?.zoenInputRequests[0]).toEqual(
      input.reference
    );
    const payload = answer(input);
    const replies = await Promise.all(
      Array.from({ length: 4 }, () =>
        rpc(identity.username, identity.tokens[0] ?? "", "SendMessage", payload)
      )
    );
    expect(replies.every((reply) => !reply.body.error)).toBe(true);
    expect(
      (await completed(identity, input.task.id))?.status.message?.parts[0]?.text
    ).toContain("friday");
    expect(await binding(input.task.id)).toEqual(original);
    const events = z
      .array(z.object({ type: z.string(), data: z.unknown() }))
      .parse(
        await server.request(`/probe/events/${original?.sessionId ?? ""}`)
      );
    expect(
      events.filter(
        (event) =>
          event.type === "action.result" &&
          JSON.stringify(event.data).includes("after-question")
      )
    ).toHaveLength(1);
    expect(
      (
        await rpc(identity.username, identity.tokens[0] ?? "", "SendMessage", {
          ...payload,
          message: { ...payload.message, parts: [{ text: "Monday" }] },
        })
      ).body.error?.code
    ).toBe(-32602);
    expect(
      (
        await rpc(
          identity.username,
          identity.tokens[0] ?? "",
          "SendMessage",
          answer(input)
        )
      ).body.error?.code
    ).toBe(-32004);
    await server.stop();
  }
);

test(
  "cross-grant, mismatched context, stale revision, cancellation and revocation cannot resume a question",
  { timeout: 60000 },
  async () => {
    await using workspace = await workspaceFixture();
    const identity = await grants(workspace);
    const server = await runtime(port, "127.0.0.1", directory);
    const input = await start(identity);
    expect(
      (
        await rpc(identity.username, identity.tokens[1] ?? "", "GetTask", {
          id: input.task.id,
        })
      ).body.error?.code
    ).toBe(-32001);
    expect(
      (
        await rpc(
          identity.username,
          identity.tokens[1] ?? "",
          "SendMessage",
          answer(input)
        )
      ).body.error?.code
    ).toBe(-32001);
    const wrongContext = answer(input);
    Object.assign(wrongContext.message, { contextId: randomUUID() });
    expect(
      (
        await rpc(
          identity.username,
          identity.tokens[0] ?? "",
          "SendMessage",
          wrongContext
        )
      ).body.error?.code
    ).toBe(-32602);
    const stale = answer(input);
    stale.message.metadata.zoenInput = {
      ...input.reference,
      revision: "0".repeat(64),
    };
    expect(
      (
        await rpc(
          identity.username,
          identity.tokens[0] ?? "",
          "SendMessage",
          stale
        )
      ).body.error?.code
    ).toBe(-32004);
    expect(
      (
        await rpc(identity.username, identity.tokens[0] ?? "", "CancelTask", {
          id: input.task.id,
        })
      ).body.error
    ).toBeUndefined();
    expect(
      (
        await rpc(
          identity.username,
          identity.tokens[0] ?? "",
          "SendMessage",
          answer(input)
        )
      ).body.error?.code
    ).toBe(-32004);
    const revoked = await start(identity);
    await revokeAgentGrant(workspace.actor, identity.ids[0] ?? "");
    expect(
      (
        await rpc(
          identity.username,
          identity.tokens[0] ?? "",
          "SendMessage",
          answer(revoked)
        )
      ).status
    ).toBe(401);
    expect(
      (
        await query<{ state: string }>(
          sql`SELECT state FROM agent_protocol_tasks WHERE id = ${revoked.task.id}`
        )
      )[0]?.state
    ).not.toBe("TASK_STATE_COMPLETED");
    await server.stop();
  }
);

test(
  "restart after receipt acknowledgement preserves one continuation action",
  { timeout: 90000 },
  async () => {
    await using workspace = await workspaceFixture();
    const identity = await grants(workspace);
    let server = await runtime(port, "127.0.0.1", directory);
    const input = await start(identity, "pause-before-action");
    const original = await binding(input.task.id);
    const payload = {
      ...answer(input),
      configuration: { returnImmediately: true },
    };
    expect(
      (
        await rpc(
          identity.username,
          identity.tokens[0] ?? "",
          "SendMessage",
          payload
        )
      ).body.error
    ).toBeUndefined();
    await expect
      .poll(
        async () =>
          (
            await query(
              sql`SELECT input_id FROM native_delivery_receipts WHERE input_id = ${`fixture-pause:${input.task.id}`}`
            )
          ).length,
        { timeout: 10000 }
      )
      .toBe(1);
    await server.stop();
    server = await runtime(port, "127.0.0.1", directory);
    expect(
      (
        await rpc(
          identity.username,
          identity.tokens[0] ?? "",
          "SendMessage",
          payload
        )
      ).body.error
    ).toBeUndefined();
    await completed(identity, input.task.id);
    expect(await binding(input.task.id)).toEqual(original);
    const events = z
      .array(z.object({ type: z.string(), data: z.unknown() }))
      .parse(
        await server.request(`/probe/events/${original?.sessionId ?? ""}`)
      );
    expect(
      events.filter(
        (event) =>
          event.type === "action.result" &&
          JSON.stringify(event.data).includes("after-question")
      )
    ).toHaveLength(1);
    await server.stop();
  }
);

test(
  "external agent text cannot answer native human approval",
  { timeout: 30000 },
  async () => {
    await using workspace = await workspaceFixture();
    const identity = await grants(workspace);
    const server = await runtime(port, "127.0.0.1", directory);
    const response = await rpc(
      identity.username,
      identity.tokens[0] ?? "",
      "SendMessage",
      {
        message: {
          messageId: randomUUID(),
          role: "ROLE_USER",
          parts: [{ text: "human-approval" }],
        },
      }
    );
    expect(response.body.error).toBeUndefined();
    const task = z
      .object({ task: taskSchema })
      .parse(response.body.result).task;
    expect(task.status.state).toBe("TASK_STATE_INPUT_REQUIRED");
    expect(task.status.message?.metadata?.zoenInputRequests).toEqual([]);
    const linked = await binding(task.id);
    const events = z
      .array(z.object({ type: z.string(), data: z.unknown() }))
      .parse(await server.request(`/probe/events/${linked?.sessionId ?? ""}`));
    const input = z
      .object({ requests: z.array(inputRequestSchema) })
      .parse(events.find((event) => event.type === "input.requested")?.data)
      .requests[0];
    if (!input) throw new Error("Expected native human approval");
    expect(input.kind).toBe("tool-approval");
    const approvalAnswer = {
      message: {
        messageId: randomUUID(),
        role: "ROLE_USER",
        taskId: task.id,
        parts: [{ text: "approve" }],
        metadata: {
          zoenInput: {
            requestId: input.requestId,
            revision: channelConsentRevision(input),
          },
        },
      },
    };
    expect(
      (
        await rpc(
          identity.username,
          identity.tokens[0] ?? "",
          "SendMessage",
          approvalAnswer
        )
      ).body.error?.code
    ).toBe(-32004);
    expect(
      (
        await query<{ state: string }>(
          sql`SELECT state FROM agent_protocol_tasks WHERE id = ${task.id}`
        )
      )[0]?.state
    ).toBe("TASK_STATE_INPUT_REQUIRED");
    const after = z
      .array(z.object({ type: z.string(), data: z.unknown() }))
      .parse(await server.request(`/probe/events/${linked?.sessionId ?? ""}`));
    expect(
      after.filter(
        (event) =>
          event.type === "action.result" &&
          JSON.stringify(event.data).includes("human-action")
      )
    ).toEqual([]);
    await server.stop();
  }
);

test(
  "context clear fails the parked task and a stale answer never becomes a new prompt",
  { timeout: 30000 },
  async () => {
    await using workspace = await workspaceFixture();
    const identity = await grants(workspace);
    const server = await runtime(port, "127.0.0.1", directory);
    const input = await start(identity);
    const original = await binding(input.task.id);
    const sessionId = original?.sessionId;
    if (!sessionId) throw new Error("Expected the original native session");
    const eventsSchema = z.array(
      z.object({ type: z.string(), data: z.unknown() })
    );
    const before = eventsSchema.parse(
      await server.request(`/probe/events/${sessionId}`)
    );
    await server.request(`/probe/clear/${sessionId}`, {});
    await expect
      .poll(
        async () =>
          taskSchema.parse(
            (
              await rpc(
                identity.username,
                identity.tokens[0] ?? "",
                "GetTask",
                { id: input.task.id }
              )
            ).body.result
          ).status.state,
        { timeout: 10000, interval: 100 }
      )
      .toBe("TASK_STATE_FAILED");
    expect(
      (
        await rpc(
          identity.username,
          identity.tokens[0] ?? "",
          "SendMessage",
          answer(input)
        )
      ).body.error?.code
    ).toBe(-32004);
    expect(await binding(input.task.id)).toEqual(original);
    const after = eventsSchema.parse(
      await server.request(`/probe/events/${sessionId}`)
    );
    expect(
      after.filter((event) => event.type === "context.cleared")
    ).toHaveLength(1);
    expect(
      after.filter((event) => event.type === "message.received")
    ).toHaveLength(
      before.filter((event) => event.type === "message.received").length
    );
    expect(
      after.filter(
        (event) =>
          event.type === "action.result" &&
          JSON.stringify(event.data).includes("after-question")
      )
    ).toEqual([]);
    await server.stop();
  }
);
