import { query, transaction } from "@db/queries";
import { sql } from "drizzle-orm";
import { z } from "zod";
import {
  parseInputResponses,
  resolveTextToResponses,
  type InputRequest,
} from "eve/client";
import type { AttachSessionFn, ChannelDefinition } from "eve/channels";
import {
  deliverOnce,
  type deliveryContext,
  respondDurableInput,
  ConflictingDeliveryReplay,
  type DeliveryState,
} from "../../agent/lib/durable-delivery";
import {
  readChannelInputs,
  renderChannelInput,
} from "../../agent/lib/channel-input";
import { channelConsentRevision } from "../../agent/lib/channel-consent";
import { jsonString } from "@shared/validation";
import { operationSignal } from "../operations/async";
import { readNativeReceipt } from "../messaging/native-receipts";
import {
  requireWorkspaceAccess,
  workspaceActorFromPrincipal,
  WorkspaceAccessDenied,
  type WorkspaceActorSchema,
} from "../workspaces/access";
import {
  A2AError,
  type A2AMessageSchema,
  protocolInputReceiptId,
  protocolTaskView,
  readProtocolTask,
} from "./tasks";

export interface ProtocolInputState extends DeliveryState {
  questions?: Record<string, string>;
  humanInput?: boolean;
}
export function protocolInputContext(
  state: ProtocolInputState,
  session: Parameters<typeof deliveryContext>[1]
) {
  const questions = (state.questions ??= {});
  return { state, session, questions };
}
const marker = "zoen.a2a.input:";
const responseSchema = z.strictObject({
  taskId: z.uuid(),
  contextId: z.uuid(),
  messageId: z.string().min(1).max(128),
  requestId: z.string().min(1).max(128),
  revision: z.string().regex(/^[a-f0-9]{64}$/),
});

/** Task control checks grant authority without granting a parked task tool access. */
async function protocolControlActor(
  principal: Parameters<typeof workspaceActorFromPrincipal>[0]
) {
  if (principal?.authenticator !== "a2a") throw new WorkspaceAccessDenied();
  const { protocolTaskId: _taskId, ...attributes } = principal.attributes;
  return workspaceActorFromPrincipal({ ...principal, attributes });
}

export async function projectProtocolInputs(
  channel: Pick<ReturnType<typeof protocolInputContext>, "state" | "questions">,
  requests: readonly InputRequest[],
  session: Pick<Parameters<typeof deliveryContext>[1], "id" | "auth">
) {
  const caller = session.auth.current;
  const taskId = caller?.attributes.protocolTaskId;
  if (typeof taskId !== "string") return;
  await transaction(async () => {
    const actor = await protocolControlActor(caller ?? undefined);
    const text =
      requests
        .filter((request) => request.kind === "question")
        .map(renderChannelInput)
        .join("\n\n") || "This task requires human input.";
    const changed =
      await query(sql`UPDATE agent_protocol_tasks SET session_id = ${session.id},
      state = 'TASK_STATE_INPUT_REQUIRED', output = ${text.slice(0, 32000)}, updated_at = now()
      WHERE id = ${taskId} AND grant_id = ${actor.agentGrantId}
        AND (session_id IS NULL OR session_id = ${session.id})
        AND state IN ('TASK_STATE_SUBMITTED', 'TASK_STATE_WORKING', 'TASK_STATE_INPUT_REQUIRED') RETURNING id`);
    if (!changed.length) return;
    for (const request of requests) {
      if (request.kind === "question")
        channel.questions[request.requestId] = channelConsentRevision(request);
      else channel.state.humanInput = true;
    }
  });
}

/** The consumer fence runs before Eve can reinterpret a stale answer as a prompt. */
export async function deliverProtocolInput(
  payload: Parameters<NonNullable<ChannelDefinition["deliver"]>>[0],
  channel: ReturnType<typeof protocolInputContext>
) {
  if (!payload.inputResponses) return deliverOnce(payload, channel);
  if (payload.message !== undefined) return undefined;
  const source = payload.context?.[1];
  if (!source?.startsWith(marker)) return undefined;
  const parsed = jsonString(responseSchema).safeParse(
    source.slice(marker.length)
  );
  if (!parsed.success || payload.inputResponses.length !== 1) return undefined;
  const input = parsed.data;
  if (payload.inputResponses[0]?.requestId !== input.requestId)
    return undefined;
  const accepted = await transaction(async () =>
    deliverOnce(payload, channel, async (receipt) => {
      try {
        const actor = await protocolControlActor(
          channel.session.auth.current ?? undefined
        );
        const task = await readProtocolTask(actor, input.taskId);
        if (
          task.contextId !== input.contextId ||
          task.sessionId !== channel.session.id ||
          channel.session.auth.current?.attributes.protocolTaskId !== task.id ||
          receipt.id !==
            protocolInputReceiptId(actor.agentGrantId ?? "", input.messageId) ||
          channel.questions[input.requestId] !== input.revision
        )
          return false;
        const previous = await readNativeReceipt(actor.workspaceId, receipt.id);
        const replay =
          previous?.digest === receipt.digest &&
          previous.sessionId === channel.session.id;
        if (
          task.state !== "TASK_STATE_INPUT_REQUIRED" &&
          !(task.state === "TASK_STATE_WORKING" && replay)
        )
          return false;
        const original = await query(
          sql`SELECT id FROM agent_protocol_tasks WHERE grant_id = ${actor.agentGrantId} AND message_id = ${input.messageId}`
        );
        if (original.length) return false;
        const remaining = Object.keys(channel.questions).filter(
          (id) => id !== input.requestId
        );
        const state =
          remaining.length || channel.state.humanInput
            ? "TASK_STATE_INPUT_REQUIRED"
            : "TASK_STATE_WORKING";
        const changed =
          await query(sql`UPDATE agent_protocol_tasks SET state = ${state}, output = NULL, updated_at = now()
        WHERE id = ${task.id} AND grant_id = ${actor.agentGrantId} AND session_id = ${channel.session.id}
          AND state IN ('TASK_STATE_INPUT_REQUIRED', 'TASK_STATE_WORKING') RETURNING id`);
        return changed.length === 1;
      } catch (error) {
        if (error instanceof WorkspaceAccessDenied || error instanceof A2AError)
          return false;
        throw error;
      }
    })
  );
  if (accepted) {
    const { [input.requestId]: _answered, ...remaining } = channel.questions;
    channel.state.questions = remaining;
    channel.questions = remaining;
    return { ...accepted, context: accepted.context?.slice(1) };
  }
  return undefined;
}

export async function respondProtocolInput(
  actor: z.output<typeof WorkspaceActorSchema>,
  message: z.output<typeof A2AMessageSchema>,
  attachSession: AttachSessionFn
) {
  const taskId = message.message.taskId;
  const reference = message.message.metadata?.zoenInput;
  if (!taskId || !reference || !actor.agentGrantId)
    throw new A2AError({
      code: -32602,
      message: "An exact pending question reference is required",
    });
  const task = await readProtocolTask(actor, taskId);
  if (!task.sessionId)
    throw new A2AError({
      code: -32004,
      message: "Task has no pending native question",
    });
  if (message.message.contextId && message.message.contextId !== task.contextId)
    throw new A2AError({
      code: -32602,
      message: "Context does not match the task",
    });
  const session = attachSession(task.sessionId);
  const text = message.message.parts.map((part) => part.text).join("\n\n");
  // A receipt retry needs its original structured answer even after the native request settled.
  // Fingerprint the authored answer before resolving its native option ID.
  const responses = parseInputResponses([
    { requestId: reference.requestId, text },
  ]);
  const access = await requireWorkspaceAccess(actor);
  const auth = {
    principalType: "user" as const,
    principalId: actor.userId,
    authenticator: "a2a",
    attributes: {
      workspaceId: actor.workspaceId,
      workspaceKind: access.organizationId === null ? "personal" : "company",
      agentGrantId: actor.agentGrantId,
      protocolTaskId: task.id,
      conversationChannel: "a2a",
    },
  };
  const binding = {
    taskId: task.id,
    contextId: task.contextId,
    messageId: message.message.messageId,
    ...reference,
  };
  // Resolve only a live question; matching receipts bypass this check on retries.
  await respondDurableInput(
    session,
    protocolInputReceiptId(actor.agentGrantId, message.message.messageId),
    responses,
    { auth, context: [marker + JSON.stringify(binding)] },
    async () => {
      const current = await readProtocolTask(actor, task.id);
      const live = (await readChannelInputs(session, operationSignal())).find(
        (pending) => pending.requestId === reference.requestId
      );
      if (
        current.state !== "TASK_STATE_INPUT_REQUIRED" ||
        current.sessionId !== session.id ||
        live?.kind !== "question" ||
        channelConsentRevision(live) !== reference.revision
      )
        throw new A2AError({
          code: -32004,
          message: "Question is stale or task is not waiting for input",
        });
      const resolved = parseInputResponses(
        resolveTextToResponses(text, [live])
      );
      if (resolved.length !== 1)
        throw new A2AError({
          code: -32602,
          message: "Answer does not match the pending question",
        });
      return resolved;
    }
  ).catch((error: unknown) => {
    if (error instanceof ConflictingDeliveryReplay)
      throw new A2AError({
        code: -32602,
        message: "Message ID was reused with different content",
      });
    throw error;
  });
  return readProtocolTask(actor, task.id);
}

export async function protocolInputTaskView(
  actor: z.output<typeof WorkspaceActorSchema>,
  task: Awaited<ReturnType<typeof readProtocolTask>>,
  attachSession: AttachSessionFn,
  includeArtifacts = true
) {
  const view = protocolTaskView(task, includeArtifacts);
  if (task.state !== "TASK_STATE_INPUT_REQUIRED" || !task.sessionId)
    return view;
  await requireWorkspaceAccess(actor);
  const requests = await readChannelInputs(
    attachSession(task.sessionId),
    operationSignal()
  );
  const questions = requests.filter((request) => request.kind === "question");
  return {
    ...view,
    status: {
      ...view.status,
      message: {
        messageId: `${task.id}:input`,
        contextId: task.contextId,
        taskId: task.id,
        role: "ROLE_AGENT",
        parts: [
          {
            text:
              questions.map(renderChannelInput).join("\n\n") ||
              (task.output ?? "This task requires human input."),
          },
        ],
        metadata: {
          zoenInputRequests: questions.map((request) => ({
            requestId: request.requestId,
            revision: channelConsentRevision(request),
            prompt: request.prompt,
            options: request.options,
            allowFreeform: request.allowFreeform,
          })),
        },
      },
    },
  };
}
