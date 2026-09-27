import { query } from "@db/queries";
import { sql } from "drizzle-orm";
import { ZodError as SchemaError } from "zod";
import { SqlError } from "../../db/queries";
import { z } from "zod";
import type { AccessScope } from "../../shared/identity/access-scope";
import { reminderSchema } from "../../shared/schedules/reminders";
const decodeReminders = z.array(reminderSchema);
class RemindersUnavailable extends Error {
  readonly _tag = "RemindersUnavailable";
  constructor() {
    super("RemindersUnavailable");
    this.name = "RemindersUnavailable";
  }
}
export const listReminders = async function (scope: AccessScope) {
  try {
    const rows = await query(sql`
      SELECT j.id, j.revision, (viewer.role IN ('owner', 'admin') OR j.created_by_user_id = ${scope.userId}) AS "mayManage",
        j.prompt, j.status, j.next_run_at AS "nextRunAt",
        j.conversation_channel AS "conversationChannel",
        CASE WHEN j.conversation_channel = 'eve' AND EXISTS (
          SELECT 1 FROM agent_sessions s
          WHERE s.session_id = j.conversation_id
            AND s.workspace_id = ${scope.workspaceId}
            AND s.created_by_user_id = ${scope.userId}
        ) THEN j.conversation_id ELSE NULL END AS "originalSessionId",
        r.status AS "latestRunStatus", r.report_status AS "latestReportStatus",
        r.scheduled_for AS "latestScheduledFor"
      FROM scheduled_agent_jobs j
      INNER JOIN workspace_memberships m
        ON m.workspace_id = j.workspace_id AND m.user_id = j.created_by_user_id
      INNER JOIN workspace_memberships viewer ON viewer.workspace_id = j.workspace_id AND viewer.user_id = ${scope.userId}
      INNER JOIN workspaces w ON w.id = j.workspace_id
      LEFT JOIN LATERAL (
        SELECT status, report_status, scheduled_for
        FROM scheduled_agent_runs WHERE job_id = j.id
        ORDER BY scheduled_for DESC, id DESC LIMIT 1
      ) r ON TRUE
      WHERE j.workspace_id = ${scope.workspaceId}
        AND (j.created_by_user_id = ${scope.userId} OR w.organization_id IS NOT NULL)
        AND (w.organization_id IS NULL OR (
          EXISTS (SELECT 1 FROM organization_memberships o WHERE o.organization_id = w.organization_id AND o.user_id = ${scope.userId})
          AND EXISTS (SELECT 1 FROM organization_memberships o WHERE o.organization_id = w.organization_id AND o.user_id = j.created_by_user_id)
        ))
        AND j.status IN ('active', 'paused', 'completed')
      ORDER BY CASE j.status WHEN 'active' THEN 0 WHEN 'paused' THEN 1 ELSE 2 END,
        j.next_run_at ASC NULLS LAST, j.updated_at DESC, j.id ASC
      LIMIT 51`);
    const reminders = await decodeReminders.parseAsync(rows);
    return {
      reminders: reminders.slice(0, 50),
      hasMore: reminders.length > 50,
    };
  } catch (error) {
    if (error instanceof SqlError || error instanceof SchemaError) {
      throw new RemindersUnavailable();
    }
    throw error;
  }
};
