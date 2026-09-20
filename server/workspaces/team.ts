import { query, transaction as withDatabaseTransaction } from "@db/queries";
import { sql } from "drizzle-orm";
import { z } from "zod";
import { randomUUID } from "node:crypto";

import { UsernameSchema } from "../accounts/directory";
import {
  requireWorkspaceAccess,
  WorkspaceAccessDenied,
  type WorkspaceActorSchema,
} from "./access";

const teamMemberSchema = z.object({
  userId: z.string(),
  username: z.nullable(z.string()),
  name: z.string(),
  role: z.enum(["owner", "admin", "member"]),
});
const invitationSchema = z.object({
  id: z.uuid(),
  workspaceId: z.string(),
  name: z.string(),
  username: z.nullable(z.string()),
});

export const readWorkspaceTeam = async function (
  actor: z.output<typeof WorkspaceActorSchema>
) {
  const access = await requireWorkspaceAccess(actor);

  if (!access.organizationId)
    return { members: [], invites: [], mayManage: false };
  const members =
    await query(sql`SELECT m.user_id AS "userId", d.username, u.name, m.role FROM workspace_memberships m
    JOIN public.user u ON ('better-auth:' || u.id) = m.user_id LEFT JOIN user_directory d ON d.user_id = u.id
    WHERE m.workspace_id = ${actor.workspaceId} ORDER BY m.role, u.name`);
  const invites =
    access.role === "member"
      ? []
      : await query(sql`SELECT i.id, i.workspace_id AS "workspaceId", COALESCE(w.display_name, 'Zoen') AS name, d.username
    FROM workspace_invites i JOIN workspaces w ON w.id = i.workspace_id LEFT JOIN user_directory d ON d.user_id = i.target_user_id
    WHERE i.workspace_id = ${actor.workspaceId} AND i.status = 'pending' AND i.expires_at > now() ORDER BY i.created_at`);
  return {
    members: await z.array(teamMemberSchema).parseAsync(members),
    invites: await z.array(invitationSchema).parseAsync(invites),
    mayManage: access.role !== "member",
  };
};

export const readWorkspaceInvitations = async function (
  actor: z.output<typeof WorkspaceActorSchema>
) {
  await requireWorkspaceAccess(actor);

  const rows =
    await query(sql`SELECT i.id, i.workspace_id AS "workspaceId", COALESCE(w.display_name, 'Zoen') AS name, d.username
    FROM workspace_invites i JOIN workspaces w ON w.id = i.workspace_id LEFT JOIN user_directory d ON d.user_id = i.invited_by_user_id
    WHERE ('better-auth:' || i.target_user_id) = ${actor.userId} AND i.status = 'pending' AND i.expires_at > now() ORDER BY i.created_at DESC LIMIT 50`);
  return await z.array(invitationSchema).parseAsync(rows);
};

export const inviteWorkspaceMember = async function (
  actor: z.output<typeof WorkspaceActorSchema>,
  username: string
) {
  const handle = await UsernameSchema.parseAsync(username);

  return await withDatabaseTransaction(async () => {
    const access = await requireWorkspaceAccess(actor, true);
    if (!access.organizationId || !actor.authSessionId)
      throw new WorkspaceAccessDenied();
    // Exact handles can receive invites. Directory search is separately opt-in.
    const targets = await query<{
      id: string;
    }>(sql`SELECT user_id AS id FROM user_directory WHERE username = ${handle}
          AND NOT EXISTS (SELECT 1 FROM account_archive WHERE source_user_id = user_directory.user_id)`);
    const target = targets[0];
    if (!target || `better-auth:${target.id}` === actor.userId)
      throw new WorkspaceAccessDenied();
    const existing = await query(
      sql`SELECT 1 FROM workspace_memberships WHERE workspace_id = ${actor.workspaceId} AND user_id = ${`better-auth:${target.id}`}`
    );
    if (existing.length) throw new WorkspaceAccessDenied();
    const id = randomUUID();
    const invited = await query<{
      id: string;
    }>(sql`INSERT INTO workspace_invites(id, workspace_id, target_user_id, invited_by_user_id)
      VALUES (${id}, ${actor.workspaceId}, ${target.id}, ${actor.userId.slice("better-auth:".length)})
      ON CONFLICT (workspace_id, target_user_id) WHERE status = 'pending' DO UPDATE SET expires_at = now() + interval '7 days' RETURNING id`);
    await query(sql`INSERT INTO organization_audit_receipts(id, organization_id, actor_user_id, action, target_user_id, metadata)
      VALUES (${randomUUID()}, ${access.organizationId}, ${actor.userId}, 'invite_created', ${`better-auth:${target.id}`}, ${sql`${JSON.stringify({ inviteId: invited[0]?.id, role: "member" })}::jsonb`})`);
    return { id: invited[0]?.id };
  });
};

export const answerWorkspaceInvitation = async function (
  actor: z.output<typeof WorkspaceActorSchema>,
  id: string,
  accept: boolean
) {
  await z.uuid().parseAsync(id);

  return await withDatabaseTransaction(async () => {
    await requireWorkspaceAccess(actor);
    if (!actor.authSessionId) throw new WorkspaceAccessDenied();
    const rows = await query<{
      workspace_id: string;
      organization_id: string | null;
    }>(sql`SELECT i.workspace_id, w.organization_id FROM workspace_invites i JOIN workspaces w ON w.id = i.workspace_id
      WHERE i.id = ${id} AND ('better-auth:' || i.target_user_id) = ${actor.userId} AND i.status = 'pending' AND i.expires_at > now() FOR UPDATE OF i`);
    const invite = rows[0];
    if (!invite?.organization_id) throw new WorkspaceAccessDenied();
    if (accept) {
      await query(
        sql`INSERT INTO organization_memberships(organization_id, user_id, role) VALUES (${invite.organization_id}, ${actor.userId}, 'member') ON CONFLICT DO NOTHING`
      );
      await query(
        sql`INSERT INTO workspace_memberships(workspace_id, user_id, role) VALUES (${invite.workspace_id}, ${actor.userId}, 'member') ON CONFLICT DO NOTHING`
      );
    }
    await query(
      sql`UPDATE workspace_invites SET status = ${accept ? "accepted" : "revoked"} WHERE id = ${id}`
    );
    await query(sql`INSERT INTO organization_audit_receipts(id, organization_id, actor_user_id, action, target_user_id, metadata)
      VALUES (${randomUUID()}, ${invite.organization_id}, ${actor.userId}, ${accept ? "invite_accepted" : "invite_revoked"}, ${actor.userId}, ${sql`${JSON.stringify({ inviteId: id, role: "member" })}::jsonb`})`);
    return { workspaceId: invite.workspace_id };
  });
};

export const revokeWorkspaceInvitation = async function (
  actor: z.output<typeof WorkspaceActorSchema>,
  id: string
) {
  return await withDatabaseTransaction(async () => {
    const access = await requireWorkspaceAccess(actor, true);
    if (!access.organizationId) throw new WorkspaceAccessDenied();
    const rows = await query(
      sql`UPDATE workspace_invites SET status = 'revoked' WHERE id = ${id} AND workspace_id = ${actor.workspaceId} AND status = 'pending' RETURNING id`
    );
    if (!rows.length) throw new WorkspaceAccessDenied();
    await query(sql`INSERT INTO organization_audit_receipts(id, organization_id, actor_user_id, action, metadata)
      VALUES (${randomUUID()}, ${access.organizationId}, ${actor.userId}, 'invite_revoked', ${sql`${JSON.stringify({ inviteId: id })}::jsonb`})`);
    return { revoked: true };
  });
};

export const removeWorkspaceMember = async function (
  actor: z.output<typeof WorkspaceActorSchema>,
  targetUserId: string
) {
  return await withDatabaseTransaction(async () => {
    const access = await requireWorkspaceAccess(actor, true);
    if (!access.organizationId || targetUserId === actor.userId)
      throw new WorkspaceAccessDenied();
    const memberships = await query(
      sql`SELECT user_id FROM workspace_memberships WHERE workspace_id = ${actor.workspaceId} AND user_id = ${targetUserId} AND role = 'member' FOR UPDATE`
    );
    if (!memberships.length) throw new WorkspaceAccessDenied();
    // Sessions, jobs, runs and report outputs cascade from the membership row, so
    // everything that must be counted or cancelled through them happens first.
    const sessions = await query(
      sql`SELECT session_id FROM agent_sessions WHERE workspace_id = ${actor.workspaceId} AND created_by_user_id = ${targetUserId}`
    );
    const jobs = await query(
      sql`SELECT id FROM scheduled_agent_jobs WHERE workspace_id = ${actor.workspaceId} AND created_by_user_id = ${targetUserId} AND status <> 'deleted'`
    );
    const cancelledOutbox =
      await query(sql`UPDATE channel_outbox q SET status = 'cancelled', lease_token = NULL, lease_expires_at = NULL, last_error = 'member_removed'
      FROM scheduled_agent_report_outputs o JOIN scheduled_agent_runs r ON r.id = o.run_id JOIN scheduled_agent_jobs j ON j.id = r.job_id
      WHERE q.id = o.outbox_id AND j.workspace_id = ${actor.workspaceId} AND j.created_by_user_id = ${targetUserId}
        AND q.status IN ('queued', 'dispatching') RETURNING q.id`);
    const affectedGrant = sql`(b.workspace_id = ${actor.workspaceId} AND g.issued_by = ${targetUserId})
          OR (g.source_workspace_id = ${actor.workspaceId} AND g.requester_user_id = ${targetUserId})`;
    // Lock grants before tasks, matching execution's authority lock order.
    // Count and cancel before the revocation trigger retires Matrix rooms.
    await query(sql`SELECT g.id FROM workspace_agent_grants g JOIN workspace_bots b ON b.id = g.bot_id
          WHERE (${affectedGrant}) FOR UPDATE OF g`);
    const canceledTasks =
      await query(sql`UPDATE agent_protocol_tasks t SET state = 'TASK_STATE_CANCELED', updated_at = now()
      FROM workspace_agent_grants g JOIN workspace_bots b ON b.id = g.bot_id
      WHERE t.grant_id = g.id AND (${affectedGrant})
        AND t.state IN ('TASK_STATE_SUBMITTED', 'TASK_STATE_WORKING', 'TASK_STATE_INPUT_REQUIRED') RETURNING t.id`);
    const revokedGrants =
      await query(sql`UPDATE workspace_agent_grants g SET revoked_at = clock_timestamp() FROM workspace_bots b
            WHERE b.id = g.bot_id AND (${affectedGrant}) AND g.revoked_at IS NULL RETURNING g.id`);
    await query(sql`UPDATE vault_item_delegations SET revoked_at = clock_timestamp(), wrapped_secret = 'revoked'
      WHERE workspace_id = ${actor.workspaceId} AND issued_by = ${targetUserId} AND revoked_at IS NULL`);
    await query(sql`UPDATE whatsapp_bridge_shares SET revoked_at = clock_timestamp()
      WHERE workspace_id = ${actor.workspaceId} AND issued_by = ${targetUserId} AND revoked_at IS NULL`);
    await query(
      sql`DELETE FROM workspace_memberships WHERE workspace_id = ${actor.workspaceId} AND user_id = ${targetUserId} AND role = 'member'`
    );
    await query(
      sql`DELETE FROM workspace_memory_namespace WHERE workspace_id = ${actor.workspaceId} AND user_id = ${targetUserId}`
    );
    await query(
      sql`UPDATE workspace_invites SET status = 'revoked' WHERE workspace_id = ${actor.workspaceId} AND ('better-auth:' || target_user_id) = ${targetUserId} AND status = 'pending'`
    );
    await query(sql`INSERT INTO organization_audit_receipts(id, organization_id, actor_user_id, action, target_user_id, metadata)
      VALUES (${randomUUID()}, ${access.organizationId}, ${actor.userId}, 'member_removed', ${targetUserId}, ${sql`${JSON.stringify(
        {
          removedSessions: sessions.length,
          removedJobs: jobs.length,
          cancelledOutbox: cancelledOutbox.length,
          revokedGrants: revokedGrants.length,
          canceledTasks: canceledTasks.length,
        }
      )}::jsonb`})`);
    return { removed: true };
  });
};
