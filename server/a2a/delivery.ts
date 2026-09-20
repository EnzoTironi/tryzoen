import {
  sendDurableMessage,
  type DeliveryState,
} from "../../agent/lib/durable-delivery";
import type { z } from "zod";
import { query } from "@db/queries";
import { sql } from "drizzle-orm";
import type { ChannelReceiveContext } from "eve/channels";
import {
  requireWorkspaceAccess,
  WorkspaceAccessDenied,
  type WorkspaceActorSchema,
} from "../workspaces/access";
import { A2AError, bindProtocolSession, readProtocolTask } from "./tasks";

export const deliverProtocolTask = async function (
  actor: z.output<typeof WorkspaceActorSchema>,
  taskId: string,
  channel: ChannelReceiveContext<DeliveryState>
) {
  if (!actor.agentGrantId) throw new WorkspaceAccessDenied();
  const access = await requireWorkspaceAccess({
    ...actor,
    protocolTaskId: taskId,
  });
  const task = await readProtocolTask(actor, taskId);
  const auth = {
    principalType: "user" as const,
    principalId: actor.userId,
    authenticator: "a2a",
    attributes: {
      workspaceId: actor.workspaceId,
      workspaceKind: access.organizationId === null ? "personal" : "company",
      agentGrantId: actor.agentGrantId ?? "",
      protocolTaskId: task.id,
      conversationChannel: "a2a",
    },
  };
  // Each task has a fixed session; contextId only groups tasks and grants no access.
  let session;
  try {
    session = await sendDurableMessage(
      channel,
      `a2a:${actor.agentGrantId}:${task.id}`,
      task.id,
      task.prompt,
      { auth, title: "Agent collaboration" }
    );
  } catch {
    throw new A2AError({
      code: -32603,
      message: "Task was accepted; retry with the same message ID",
    });
  }
  const current = await Promise.try(async () => {
    await bindProtocolSession(actor, task.id, session.id);
    return await readProtocolTask(actor, task.id);
  }).catch(async (error: unknown) => {
    await (async function () {
      // The source may disappear after native acceptance but before binding. Keep
      // cancellation durable even though no protocol task survives to hold it.
      await query(
        sql`INSERT INTO agent_protocol_cancellations(session_id) VALUES (${session.id}) ON CONFLICT DO NOTHING`
      );
    })();
    throw error;
  });
  if (current.state === "TASK_STATE_CANCELED") await session.cancel();
  return session;
};

/** Only native scheduled dispatch uses this lookup; HTTP always verifies a bearer. */
export const recoverableProtocolActor = async function (taskId: string) {
  const rows = await query<{
    userId: string;
    workspaceId: string;
    agentGrantId: string;
  }>(sql`
    SELECT g.issued_by AS "userId", b.workspace_id AS "workspaceId", g.id AS "agentGrantId"
    FROM agent_protocol_tasks t JOIN workspace_agent_grants g ON g.id = t.grant_id
    JOIN workspace_bots b ON b.id = g.bot_id WHERE t.id = ${taskId} AND t.state = 'TASK_STATE_SUBMITTED'`);
  if (!rows[0]) throw new WorkspaceAccessDenied();
  return await requireWorkspaceAccess(rows[0]);
};

export const listPendingProtocolTasks = async function () {
  return await query<{ id: string }>(sql`SELECT t.id FROM agent_protocol_tasks t
    JOIN workspace_agent_grants g ON g.id = t.grant_id
    WHERE t.state = 'TASK_STATE_SUBMITTED' AND t.created_at < now() - interval '10 seconds'
    AND g.revoked_at IS NULL AND g.expires_at > now() ORDER BY t.created_at LIMIT 25`);
};
