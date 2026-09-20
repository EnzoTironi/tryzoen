import type { z } from "zod";
import { query, transaction as withDatabaseTransaction } from "@db/queries";
import { sql } from "drizzle-orm";
import { sleep } from "../operations/async";
import { readProtocolTask } from "../a2a/tasks";
import {
  requireWorkspaceAccess,
  WorkspaceAccessDenied,
  type WorkspaceActorSchema,
} from "../workspaces/access";
import { matrixConversationAuthority } from "./conversations";

/** Receipt lookup is scoped to the current human and source workspace, never just an event ID. */
export const readMatrixResult = async function (
  actor: z.output<typeof WorkspaceActorSchema>,
  conversationId: string,
  eventId: string
) {
  return await withDatabaseTransaction(async () => {
    if (!actor.authSessionId) throw new WorkspaceAccessDenied();
    await requireWorkspaceAccess(actor);
    const c = await matrixConversationAuthority(conversationId);
    if (c.requesterId !== actor.userId || c.workspaceId !== actor.workspaceId)
      throw new WorkspaceAccessDenied();
    const sent = await query(sql`SELECT 1 FROM matrix_agent_sends
      WHERE conversation_id = ${conversationId} AND event_id = ${eventId}`);
    if (!sent.length) throw new WorkspaceAccessDenied();
    const rows = await query<{
      task_id: string;
    }>(sql`SELECT task_id FROM matrix_agent_messages
      WHERE conversation_id = ${conversationId} AND event_id = ${eventId}`);
    const task = rows[0]
      ? await readProtocolTask(c.destActor, rows[0].task_id)
      : null;
    return {
      conversationId,
      eventId,
      bot: c.username,
      state: task?.state ?? "TASK_STATE_SUBMITTED",
      taskId: task?.id ?? null,
      // A terminal cancelled task must not leak an earlier partial output.
      text: task?.state === "TASK_STATE_COMPLETED" ? task.output : null,
    };
  });
};

export const awaitMatrixResult = async function (
  actor: z.output<typeof WorkspaceActorSchema>,
  conversationId: string,
  eventId: string
) {
  for (let attempt = 0; attempt < 90; attempt++) {
    const result = await readMatrixResult(actor, conversationId, eventId);
    if (!["TASK_STATE_SUBMITTED", "TASK_STATE_WORKING"].includes(result.state))
      return result;
    await sleep(500);
  }
  return await readMatrixResult(actor, conversationId, eventId);
};
