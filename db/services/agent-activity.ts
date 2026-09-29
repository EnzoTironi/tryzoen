import { sql } from "drizzle-orm";
import { z } from "zod";
import { query, transaction } from "@db/queries";
import {
  activityItemSchema,
  activityQuerySchema,
} from "@zoen/companion-ui/activity";
import {
  requireWorkspaceAccess,
  type WorkspaceActorSchema,
} from "../../server/workspaces/access";

/** Read existing lifecycle metadata only; Eve remains the execution/history authority. */
export async function listAgentActivity(
  actor: z.infer<typeof WorkspaceActorSchema>,
  raw: z.input<typeof activityQuerySchema>
) {
  const input = activityQuerySchema.parse(raw);
  return transaction(async () => {
    await requireWorkspaceAccess(actor);
    const kinds = input.approvals
      ? sql`e.kind IN ('approval.candidate', 'approval.settled')`
      : sql`e.kind IN ('turn.completed', 'turn.failed', 'turn.cancelled', 'session.failed')`;
    const cursor = input.cursor
      ? sql`AND (e.created_at, e.id) < (${input.cursor.at}::timestamptz, ${input.cursor.id})`
      : sql``;
    const rows = z
      .array(activityItemSchema)
      .max(31)
      .parse(
        await query(sql`SELECT e.id, e.session_id AS "sessionId", c.title, e.kind,
        to_char(e.created_at AT TIME ZONE 'UTC', 'YYYY-MM-DD"T"HH24:MI:SS.US"Z"') AS at
        FROM telemetry_events e
        JOIN agent_sessions s ON s.session_id = e.session_id AND s.workspace_id = e.workspace_id
        JOIN chats c ON c.session_id = s.session_id AND c.workspace_id = s.workspace_id
        WHERE e.workspace_id = ${actor.workspaceId} AND e.user_id = ${actor.userId}
          AND s.created_by_user_id = ${actor.userId}
          AND e.kind IN ('turn.completed', 'turn.failed', 'turn.cancelled', 'session.failed', 'approval.candidate', 'approval.settled')
          AND ${kinds} ${cursor}
        ORDER BY e.created_at DESC, e.id DESC LIMIT 31`)
      );
    await requireWorkspaceAccess(actor);
    const items = rows.slice(0, 30);
    const last = items.at(-1);
    return {
      items,
      nextCursor:
        rows.length > 30 && last ? { at: last.at, id: last.id } : null,
    };
  });
}
