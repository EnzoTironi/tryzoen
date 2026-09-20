import { query, transaction as withDatabaseTransaction } from "@db/queries";
import { sql } from "drizzle-orm";
import { sleep } from "../operations/async";
import { isValid } from "@shared/validation";
import { z } from "zod";
import { createHash, randomUUID } from "node:crypto";

import {
  requireWorkspaceAccess,
  WorkspaceAccessDenied,
  type WorkspaceActorSchema,
} from "../workspaces/access";

const identifier = z.string().min(1).max(128);
export const A2AMessageSchema = z.object({
  message: z.object({
    messageId: identifier,
    role: z.literal("ROLE_USER"),
    parts: z
      .array(z.object({ text: z.string().max(8000) }))
      .min(1)
      .max(4),
    contextId: z.optional(z.uuid()),
    taskId: z.optional(z.uuid()),
  }),
  configuration: z.optional(
    z.object({
      returnImmediately: z.optional(z.boolean()),
      acceptedOutputModes: z.optional(z.array(z.literal("text/plain"))),
    })
  ),
});
const taskSchema = z.object({
  id: z.string(),
  contextId: z.string(),
  messageId: z.string(),
  requestHash: z.string(),
  prompt: z.string(),
  sessionId: z.nullable(z.string()),
  state: z.string(),
  output: z.nullable(z.string()),
  correlationId: z.string(),
  round: z.number(),
  originTaskId: z.nullable(z.string()),
  updatedAt: z.string(),
});
export interface ProtocolTaskChain {
  correlationId: string;
  round: number;
  originTaskId: string;
}
export class A2AError extends Error {
  readonly _tag = "A2AError";
  declare readonly code: number;
  constructor(input: { readonly code: number; readonly message: string }) {
    super(input.message);
    this.name = "A2AError";
    Object.assign(this, input);
  }
}

export const readProtocolTask = async function (
  actor: z.output<typeof WorkspaceActorSchema>,
  id: string
) {
  await requireWorkspaceAccess(actor);
  if (!actor.agentGrantId) throw new WorkspaceAccessDenied();

  const rows =
    await query(sql`SELECT id, context_id AS "contextId", message_id AS "messageId", request_hash AS "requestHash", prompt, session_id AS "sessionId", state, output, correlation_id AS "correlationId", round, origin_task_id AS "originTaskId", updated_at::text AS "updatedAt"
    FROM agent_protocol_tasks WHERE id = ${id} AND grant_id = ${actor.agentGrantId}`);
  if (!rows[0]) throw new A2AError({ code: -32001, message: "Task not found" });
  return await taskSchema.parseAsync(rows[0]);
};

export const acceptProtocolTask = async function (
  actor: z.output<typeof WorkspaceActorSchema>,
  raw: z.output<typeof A2AMessageSchema>,
  chain?: ProtocolTaskChain
) {
  const input = await A2AMessageSchema.strict().parseAsync(raw);
  if (input.message.taskId)
    throw new A2AError({
      code: -32004,
      message:
        "Start a new task in the same context instead of reopening a terminal task",
    });

  const hash = createHash("sha256")
    .update(JSON.stringify(input.message))
    .digest("hex");
  return await withDatabaseTransaction(async () => {
    // Serialize submissions before taking shared authority locks: two callers
    // must not both try to upgrade a shared grant lock to an exclusive lock.
    await query(
      sql`SELECT pg_advisory_xact_lock(hashtextextended(${actor.agentGrantId ?? ""}, 2))`
    );
    await requireWorkspaceAccess(actor);
    if (!actor.agentGrantId) throw new WorkspaceAccessDenied();
    const previous = await query<{
      id: string;
      request_hash: string;
    }>(
      sql`SELECT id, request_hash FROM agent_protocol_tasks WHERE grant_id = ${actor.agentGrantId} AND message_id = ${input.message.messageId}`
    );
    if (previous[0]) {
      if (previous[0].request_hash !== hash)
        throw new A2AError({
          code: -32602,
          message: "Message ID was reused with different content",
        });
      return await readProtocolTask(actor, previous[0].id);
    }
    const recent = await query<{
      active: number;
      recent: number;
    }>(
      sql`SELECT count(*) FILTER (WHERE state IN ('TASK_STATE_SUBMITTED', 'TASK_STATE_WORKING'))::int AS active, count(*) FILTER (WHERE created_at > now() - interval '1 hour')::int AS recent FROM agent_protocol_tasks WHERE grant_id = ${actor.agentGrantId}`
    );
    if ((recent[0]?.active ?? 0) >= 5 || (recent[0]?.recent ?? 0) >= 60)
      throw new A2AError({
        code: -32000,
        message: "Task limit reached; retry later",
      });
    if (input.message.contextId) {
      const context = await query(
        sql`SELECT id FROM agent_protocol_tasks WHERE grant_id = ${actor.agentGrantId} AND context_id = ${input.message.contextId} LIMIT 1`
      );
      if (!context.length)
        throw new A2AError({
          code: -32001,
          message: "Context not found",
        });
      const active = await query(
        sql`SELECT id FROM agent_protocol_tasks WHERE grant_id = ${actor.agentGrantId} AND context_id = ${input.message.contextId} AND state IN ('TASK_STATE_SUBMITTED', 'TASK_STATE_WORKING')`
      );
      if (active.length)
        throw new A2AError({
          code: -32000,
          message: "A task is already running in this context",
        });
    }
    const id = randomUUID();
    const round = chain?.round ?? 1;
    if (round < 1 || round > 8)
      throw new A2AError({
        code: -32000,
        message: "Task chain limit reached",
      });
    await query(sql`INSERT INTO agent_protocol_tasks(id, grant_id, context_id, message_id, request_hash, prompt, correlation_id, round, origin_task_id)
      VALUES (${id}, ${actor.agentGrantId}, ${input.message.contextId ?? randomUUID()}, ${input.message.messageId}, ${hash}, ${input.message.parts.map((part) => part.text).join("\n\n")}, ${chain?.correlationId ?? id}, ${round}, ${chain?.originTaskId ?? null})`);
    return await readProtocolTask(actor, id);
  });
};

export const bindProtocolSession = async function (
  actor: z.output<typeof WorkspaceActorSchema>,
  id: string,
  sessionId: string
) {
  await readProtocolTask(actor, id);

  const bound =
    await query(sql`UPDATE agent_protocol_tasks SET session_id = ${sessionId}, state = CASE WHEN state = 'TASK_STATE_SUBMITTED' THEN 'TASK_STATE_WORKING' ELSE state END, updated_at = now()
    WHERE id = ${id} AND grant_id = ${actor.agentGrantId} AND (session_id IS NULL OR session_id = ${sessionId}) RETURNING id`);
  if (!bound.length) throw new WorkspaceAccessDenied();
  return undefined;
};

export const cancelProtocolTask = async function (
  actor: z.output<typeof WorkspaceActorSchema>,
  id: string
) {
  return await withDatabaseTransaction(async () => {
    await readProtocolTask(actor, id);
    // Persist cancellation before delivering it. A racing dispatch or tool call
    // then fails the same live authority check, even if no session is bound yet.
    const changed =
      await query(sql`UPDATE agent_protocol_tasks SET state = 'TASK_STATE_CANCELED', updated_at = now()
      WHERE id = ${id} AND grant_id = ${actor.agentGrantId}
      AND state IN ('TASK_STATE_SUBMITTED', 'TASK_STATE_WORKING', 'TASK_STATE_INPUT_REQUIRED', 'TASK_STATE_CANCELED') RETURNING id`);
    if (!changed.length)
      throw new A2AError({
        code: -32002,
        message: "Task cannot be canceled",
      });
    return await readProtocolTask(actor, id);
  });
};

export const awaitProtocolTask = async function (
  actor: z.output<typeof WorkspaceActorSchema>,
  id: string
) {
  for (;;) {
    const task = await readProtocolTask(actor, id);
    if (
      task.state !== "TASK_STATE_SUBMITTED" &&
      task.state !== "TASK_STATE_WORKING"
    )
      return task;
    await sleep(500);
  }
};

export const finishProtocolTask = async function (
  actor: z.output<typeof WorkspaceActorSchema>,
  id: string,
  state: "TASK_STATE_COMPLETED" | "TASK_STATE_FAILED" | "TASK_STATE_CANCELED",
  output?: string
) {
  await readProtocolTask(actor, id);

  await query(sql`UPDATE agent_protocol_tasks SET state = ${state}, output = ${output?.slice(0, 32000) ?? null}, updated_at = now()
    WHERE id = ${id} AND grant_id = ${actor.agentGrantId} AND state IN ('TASK_STATE_SUBMITTED', 'TASK_STATE_WORKING', 'TASK_STATE_INPUT_REQUIRED')`);
};

export function protocolTaskView(
  task: z.output<typeof taskSchema>,
  includeArtifacts = true
) {
  const message = task.output
    ? {
        messageId: `${task.id}:result`,
        contextId: task.contextId,
        taskId: task.id,
        role: "ROLE_AGENT",
        parts: [{ text: task.output }],
      }
    : undefined;
  return {
    id: task.id,
    contextId: task.contextId,
    status: {
      state: task.state,
      timestamp: new Date(task.updatedAt).toISOString(),
      message,
    },
    artifacts: includeArtifacts
      ? task.state === "TASK_STATE_COMPLETED" && task.output
        ? [{ artifactId: `${task.id}:answer`, parts: [{ text: task.output }] }]
        : []
      : undefined,
  };
}

/** Native failure events can arrive before the acceptance receipt is bound. */
export const failProtocolSession = async function (
  sessionId: string,
  continuation: string | undefined
) {
  const parts = continuation?.split(":");
  if (
    parts?.length !== 3 ||
    parts[0] !== "a2a" ||
    !isValid(z.uuid(), parts[1]) ||
    !isValid(z.uuid(), parts[2])
  )
    return;

  await query(sql`UPDATE agent_protocol_tasks SET state = 'TASK_STATE_FAILED', session_id = ${sessionId},
    output = 'The task could not be completed. Start a new task to retry.', updated_at = now()
    WHERE id = ${parts[2]} AND grant_id = ${parts[1]} AND (session_id IS NULL OR session_id = ${sessionId})
      AND state IN ('TASK_STATE_SUBMITTED', 'TASK_STATE_WORKING')`);
};
