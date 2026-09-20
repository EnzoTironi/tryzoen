import { query } from "@db/queries";
import { sql } from "drizzle-orm";
import { isValid } from "@shared/validation";
import { z } from "zod";

import type { SessionAuthContext } from "eve/context";
import { accessScopeForUser } from "@shared/identity/access-scope";

const identifier = z
  .string()
  .min(1)
  .refine((value) => value === value.trim(), "Expected trimmed text")
  .max(200);

export const WorkspaceActorSchema = z.object({
  userId: identifier,
  workspaceId: identifier,
  authSessionId: z.optional(identifier),
  channelIdentityId: z.optional(identifier),
  agentGrantId: z.optional(z.uuid()),
  protocolTaskId: z.optional(z.uuid()),
  scheduledRunId: z.optional(z.uuid()),
  scheduledRunLeaseToken: z.optional(z.uuid()),
  groupBindingId: z.optional(z.uuid()),
  groupEpoch: z.optional(z.uuid()),
  matrixIdentityId: z.optional(identifier),
});

export class WorkspaceAccessDenied extends Error {
  readonly _tag = "WorkspaceAccessDenied";

  constructor() {
    super("WorkspaceAccessDenied");
    this.name = "WorkspaceAccessDenied";
  }
}

export function personalNetworkId(left: string, right: string) {
  return left < right ? `${left}:${right}` : `${right}:${left}`;
}

const NetworkKind = z.enum(["company", "personal"]);

const requireConversationNetwork = async function (input: {
  requesterUserId: string;
  sourceWorkspaceId: string | null;
  networkKind: string | null;
  networkId: string | null;
  destWorkspaceId: string;
}) {
  const kind = await Promise.try(async () =>
    NetworkKind.parseAsync(input.networkKind)
  ).catch(() => {
    throw new WorkspaceAccessDenied();
  });
  if (!input.networkId) throw new WorkspaceAccessDenied();

  const source = await query<{
    organization_id: string | null;
    role: string;
  }>(sql`SELECT w.organization_id, m.role FROM workspaces w
      JOIN workspace_memberships m ON m.workspace_id = w.id AND m.user_id = ${input.requesterUserId}
      WHERE w.id = ${input.sourceWorkspaceId} FOR SHARE OF w, m`);
  if (
    !source[0] ||
    (kind === "company"
      ? source[0].organization_id !== input.networkId
      : source[0].organization_id !== null ||
        source[0].role !== "owner" ||
        input.sourceWorkspaceId !==
          accessScopeForUser(input.requesterUserId).workspaceId)
  )
    throw new WorkspaceAccessDenied();
  switch (kind) {
    case "company": {
      const rows = await query(sql`SELECT w.id FROM workspaces w
        JOIN organization_memberships o ON o.organization_id = w.organization_id AND o.user_id = ${input.requesterUserId}
        WHERE w.id = ${input.destWorkspaceId} AND w.organization_id = ${input.networkId} FOR SHARE OF w, o`);
      if (rows.length !== 1) throw new WorkspaceAccessDenied();
      return true;
    }
    case "personal": {
      const rows = await query<{
        owner: string;
      }>(sql`SELECT owner.user_id AS owner FROM workspaces w
        JOIN workspace_memberships owner ON owner.workspace_id = w.id AND owner.role = 'owner'
        JOIN personal_trust_edges e ON e.user_id = ${input.requesterUserId} AND e.peer_user_id = owner.user_id
        WHERE w.id = ${input.destWorkspaceId} AND w.organization_id IS NULL
          AND NOT EXISTS (
            SELECT 1 FROM personal_trust_blocks b
            WHERE (b.user_id = ${input.requesterUserId} AND b.blocked_user_id = owner.user_id)
               OR (b.user_id = owner.user_id AND b.blocked_user_id = ${input.requesterUserId})
          ) FOR SHARE OF w, owner, e`);
      const owner = rows[0]?.owner;
      if (
        !owner ||
        personalNetworkId(input.requesterUserId, owner) !== input.networkId
      )
        throw new WorkspaceAccessDenied();
      return true;
    }
    default: {
      const impossible: never = kind;
      void impossible;
      throw new WorkspaceAccessDenied();
    }
  }
};

/** Call inside the transaction that reads or publishes protected data. */
export const requireWorkspaceAccess = async function (
  input: z.output<typeof WorkspaceActorSchema>,
  manage = false
) {
  const actor = await Promise.try(async () =>
    WorkspaceActorSchema.parseAsync(input)
  ).catch(() => {
    throw new WorkspaceAccessDenied();
  });
  if (
    [
      actor.authSessionId,
      actor.channelIdentityId,
      actor.agentGrantId,
      actor.scheduledRunId,
      actor.matrixIdentityId,
    ].filter(Boolean).length !== 1 ||
    (actor.protocolTaskId && !actor.agentGrantId) ||
    (manage &&
      (actor.agentGrantId || actor.scheduledRunId || actor.groupBindingId))
  )
    throw new WorkspaceAccessDenied();

  const memberships = await query<{
    role: string;
    organization_id: string | null;
  }>(sql`
    SELECT m.role, w.organization_id FROM workspace_memberships m
    JOIN workspaces w ON w.id = m.workspace_id
    WHERE m.user_id = ${actor.userId} AND m.workspace_id = ${actor.workspaceId}
    FOR SHARE OF m, w`);
  const membership = memberships[0];
  if (!membership || (manage && membership.role === "member"))
    throw new WorkspaceAccessDenied();
  if (membership.organization_id === null) {
    if (
      actor.workspaceId !== accessScopeForUser(actor.userId).workspaceId ||
      membership.role !== "owner"
    )
      throw new WorkspaceAccessDenied();
  } else {
    const org = await query(sql`SELECT user_id FROM organization_memberships
      WHERE organization_id = ${membership.organization_id} AND user_id = ${actor.userId} FOR SHARE`);
    if (org.length !== 1) throw new WorkspaceAccessDenied();
  }
  if (actor.agentGrantId) {
    const grants = await query<{
      id: string;
      requester_user_id: string | null;
      source_workspace_id: string | null;
      network_kind: string | null;
      network_id: string | null;
    }>(sql`SELECT g.id, g.requester_user_id, g.source_workspace_id, g.network_kind, g.network_id FROM workspace_agent_grants g
      JOIN workspace_bots b ON b.id = g.bot_id
      WHERE g.id = ${actor.agentGrantId} AND g.issued_by = ${actor.userId}
        AND b.workspace_id = ${actor.workspaceId} AND g.revoked_at IS NULL
        AND (g.requester_user_id IS NULL OR b.discoverable)
        AND g.expires_at > clock_timestamp() FOR SHARE OF g, b`);
    const grant = grants[0];
    if (!grant || membership.role === "member")
      throw new WorkspaceAccessDenied();
    if (grant.requester_user_id)
      await requireConversationNetwork({
        requesterUserId: grant.requester_user_id,
        sourceWorkspaceId: grant.source_workspace_id,
        networkKind: grant.network_kind,
        networkId: grant.network_id,
        destWorkspaceId: actor.workspaceId,
      });
    if (actor.protocolTaskId) {
      const tasks =
        await query(sql`SELECT id FROM agent_protocol_tasks WHERE id = ${actor.protocolTaskId}
          AND grant_id = ${actor.agentGrantId} AND state IN ('TASK_STATE_SUBMITTED', 'TASK_STATE_WORKING') FOR SHARE`);
      if (tasks.length !== 1) throw new WorkspaceAccessDenied();
    }
  } else if (actor.scheduledRunId) {
    if (!actor.scheduledRunLeaseToken) throw new WorkspaceAccessDenied();
    const runs = await query(sql`SELECT r.id FROM scheduled_agent_runs r
      JOIN scheduled_agent_jobs j ON j.id = r.job_id
      WHERE r.id = ${actor.scheduledRunId} AND r.lease_token = ${actor.scheduledRunLeaseToken}
        AND r.status = 'running' AND r.lease_expires_at > clock_timestamp()
        AND j.status IN ('active', 'completed') AND j.workspace_id = ${actor.workspaceId}
        AND j.created_by_user_id = ${actor.userId} FOR SHARE OF r, j`);
    if (runs.length !== 1) throw new WorkspaceAccessDenied();
  } else if (actor.matrixIdentityId) {
    if (
      !actor.groupBindingId ||
      !actor.groupEpoch ||
      !membership.organization_id
    )
      throw new WorkspaceAccessDenied();
    const rooms = await query(sql`SELECT b.id FROM workspace_group_bindings b
        JOIN matrix_room_members m ON m.binding_id = b.id AND m.user_id = ${actor.userId}
        JOIN matrix_identities i ON i.user_id = m.user_id AND i.matrix_id = ${actor.matrixIdentityId}
        WHERE b.id = ${actor.groupBindingId} AND b.epoch = ${actor.groupEpoch}
          AND b.workspace_id = ${actor.workspaceId} AND b.channel = 'matrix' AND b.revoked_at IS NULL FOR SHARE OF b, m, i`);
    if (rooms.length !== 1) throw new WorkspaceAccessDenied();
  } else if (actor.authSessionId) {
    const sessions = await query(sql`SELECT id FROM public.session
      WHERE id = ${actor.authSessionId} AND ('better-auth:' || "userId") = ${actor.userId}
      AND "expiresAt" > clock_timestamp() FOR SHARE`);
    if (sessions.length !== 1) throw new WorkspaceAccessDenied();
  } else if (actor.channelIdentityId) {
    if (
      actor.workspaceId !== accessScopeForUser(actor.userId).workspaceId &&
      !actor.groupBindingId
    )
      throw new WorkspaceAccessDenied();
    const identities = await query(sql`SELECT id FROM channel_identity
      WHERE id = ${actor.channelIdentityId} AND ('better-auth:' || user_id) = ${actor.userId}
      AND revoked_at IS NULL FOR SHARE`);
    if (identities.length !== 1) throw new WorkspaceAccessDenied();
    if (actor.groupBindingId) {
      const bindings =
        await query(sql`SELECT b.id FROM workspace_group_bindings b
        JOIN channel_identity i ON i.id = ${actor.channelIdentityId}
        WHERE b.id = ${actor.groupBindingId} AND b.workspace_id = ${actor.workspaceId}
          AND b.channel = i.channel AND b.installation_id = i.installation_id
          AND b.revoked_at IS NULL FOR SHARE OF b`);
      if (bindings.length !== 1) throw new WorkspaceAccessDenied();
    }
  } else throw new WorkspaceAccessDenied();
  return {
    ...actor,
    role: membership.role,
    organizationId: membership.organization_id,
  };
};

export const workspaceActorFromPrincipal = async function (
  principal: SessionAuthContext | undefined
) {
  if (principal?.principalType !== "user") throw new WorkspaceAccessDenied();
  if (
    (principal.attributes.chatKind === "group" ||
      (isValid(z.string(), principal.attributes.conversationScope) &&
        principal.attributes.conversationScope.startsWith("group:"))) &&
    !principal.attributes.groupBindingId
  )
    throw new WorkspaceAccessDenied();
  const actor = await Promise.try(async () =>
    WorkspaceActorSchema.parseAsync({
      userId: principal.principalId,
      workspaceId: principal.attributes.workspaceId,
      authSessionId:
        principal.authenticator === "authjs"
          ? principal.attributes.authSessionId
          : undefined,
      channelIdentityId:
        principal.authenticator === "verified-channel"
          ? principal.attributes.channelIdentityId
          : undefined,
      groupBindingId:
        principal.authenticator === "verified-channel" ||
        principal.authenticator === "matrix"
          ? principal.attributes.groupBindingId
          : undefined,
      groupEpoch:
        principal.authenticator === "matrix"
          ? principal.attributes.groupEpoch
          : undefined,
      matrixIdentityId:
        principal.authenticator === "matrix"
          ? principal.attributes.matrixIdentityId
          : undefined,
      agentGrantId:
        principal.authenticator === "a2a"
          ? principal.attributes.agentGrantId
          : undefined,
      protocolTaskId:
        principal.authenticator === "a2a"
          ? principal.attributes.protocolTaskId
          : undefined,
      scheduledRunId:
        principal.authenticator === "scheduled-worker"
          ? principal.attributes.scheduledRunId
          : undefined,
      scheduledRunLeaseToken:
        principal.authenticator === "scheduled-worker"
          ? principal.attributes.scheduledRunLeaseToken
          : undefined,
    })
  ).catch(() => {
    throw new WorkspaceAccessDenied();
  });
  return await requireWorkspaceAccess(actor);
};
