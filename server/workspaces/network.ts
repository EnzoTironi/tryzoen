import { query, transaction as withDatabaseTransaction } from "@db/queries";
import { sql } from "drizzle-orm";
import { z } from "zod";
import { createHash, randomBytes, randomUUID } from "node:crypto";

import { UsernameSchema } from "../accounts/directory";
import {
  A2AError,
  acceptProtocolTask,
  type ProtocolTaskChain,
} from "../a2a/tasks";
import {
  personalNetworkId,
  requireWorkspaceAccess,
  WorkspaceAccessDenied,
  type WorkspaceActorSchema,
} from "./access";
import { BotProfileSchema } from "./bots";

const identifier = z.string().min(1).max(128);
export const PersonalTrustUsernameSchema = z.object({
  username: UsernameSchema,
});
export const AnswerPersonalTrustSchema = z.object({
  id: z.uuid(),
  accept: z.boolean(),
});
export const ContactNetworkBotSchema = z.object({
  destUsername: UsernameSchema,
  message: z.object({
    messageId: identifier,
    role: z.literal("ROLE_USER"),
    parts: z
      .array(z.object({ text: z.string().max(8000) }))
      .min(1)
      .max(4),
    contextId: z.optional(z.uuid()),
  }),
  originTaskId: z.optional(z.uuid()),
});
const inviteSchema = z.object({
  id: z.string(),
  username: z.string(),
  direction: z.enum(["sent", "received"]),
});
const connectionSchema = z.object({
  username: z.string(),
  name: z.string(),
  botUsername: z.nullable(z.string()),
});
const conversationCapabilities = JSON.stringify(["conversation"]);

const requirePersonalActor = async function (
  actor: z.output<typeof WorkspaceActorSchema>
) {
  const access = await requireWorkspaceAccess(actor);
  if (access.organizationId || !actor.authSessionId)
    throw new WorkspaceAccessDenied();
  return access;
};

const lookupDirectoryUser = async function (username: string) {
  const handle = await UsernameSchema.parseAsync(username);

  const rows = await query<{
    id: string;
  }>(sql`SELECT user_id AS id FROM user_directory WHERE username = ${handle}
    AND NOT EXISTS (SELECT 1 FROM account_archive WHERE source_user_id = user_directory.user_id)`);
  const target = rows[0];
  if (!target) throw new WorkspaceAccessDenied();
  return { handle, userId: `better-auth:${target.id}` };
};

const blockedPair = async function (left: string, right: string) {
  const rows = await query(sql`SELECT 1 FROM personal_trust_blocks
    WHERE (user_id = ${left} AND blocked_user_id = ${right})
       OR (user_id = ${right} AND blocked_user_id = ${left})`);
  return rows.length > 0;
};

const revokePersonalNetworkGrants = async function (networkId: string) {
  const revoked =
    await query(sql`UPDATE workspace_agent_grants SET revoked_at = clock_timestamp()
      WHERE network_kind = 'personal' AND network_id = ${networkId} AND revoked_at IS NULL RETURNING id`);
  if (!revoked.length) return;
  await query(sql`UPDATE agent_protocol_tasks SET state = 'TASK_STATE_CANCELED', updated_at = now()
      WHERE grant_id IN (SELECT id FROM workspace_agent_grants WHERE network_kind = 'personal' AND network_id = ${networkId})
        AND state IN ('TASK_STATE_SUBMITTED', 'TASK_STATE_WORKING', 'TASK_STATE_INPUT_REQUIRED')`);
};

const clearPersonalTrust = async function (left: string, right: string) {
  await query(sql`UPDATE personal_trust_invites SET status = 'revoked'
    WHERE status = 'pending' AND (
      (from_user_id = ${left} AND to_user_id = ${right})
      OR (from_user_id = ${right} AND to_user_id = ${left})
    )`);
  await query(sql`DELETE FROM personal_trust_edges
    WHERE (user_id = ${left} AND peer_user_id = ${right})
       OR (user_id = ${right} AND peer_user_id = ${left})`);
  await revokePersonalNetworkGrants(personalNetworkId(left, right));
};

export const invitePersonalTrust = async function (
  actor: z.output<typeof WorkspaceActorSchema>,
  raw: z.output<typeof PersonalTrustUsernameSchema>
) {
  const input = await PersonalTrustUsernameSchema.parseAsync(raw);

  return await withDatabaseTransaction(async () => {
    await requirePersonalActor(actor);
    const peer = await lookupDirectoryUser(input.username);
    if (peer.userId === actor.userId) throw new WorkspaceAccessDenied();
    if (await blockedPair(actor.userId, peer.userId))
      throw new WorkspaceAccessDenied();
    const connected = await query(sql`SELECT 1 FROM personal_trust_edges
        WHERE user_id = ${actor.userId} AND peer_user_id = ${peer.userId}`);
    if (connected.length) throw new WorkspaceAccessDenied();
    const id = randomUUID();
    const invited = await query<{
      id: string;
    }>(sql`INSERT INTO personal_trust_invites(id, from_user_id, to_user_id)
      VALUES (${id}, ${actor.userId}, ${peer.userId})
      ON CONFLICT (from_user_id, to_user_id) WHERE status = 'pending'
      DO UPDATE SET expires_at = now() + interval '7 days' RETURNING id`);
    const inviteId = invited[0]?.id;
    if (!inviteId) throw new WorkspaceAccessDenied();
    return { id: inviteId };
  });
};

export const answerPersonalTrust = async function (
  actor: z.output<typeof WorkspaceActorSchema>,
  raw: z.output<typeof AnswerPersonalTrustSchema>
) {
  const input = await AnswerPersonalTrustSchema.parseAsync(raw);

  return await withDatabaseTransaction(async () => {
    await requirePersonalActor(actor);
    const rows = await query<{
      from_user_id: string;
    }>(sql`SELECT from_user_id FROM personal_trust_invites
      WHERE id = ${input.id} AND to_user_id = ${actor.userId} AND status = 'pending'
        AND expires_at > now() FOR UPDATE`);
    const invite = rows[0];
    if (!invite) throw new WorkspaceAccessDenied();
    if (await blockedPair(actor.userId, invite.from_user_id))
      throw new WorkspaceAccessDenied();
    if (input.accept) {
      await query(sql`INSERT INTO personal_trust_edges(user_id, peer_user_id) VALUES
          (${actor.userId}, ${invite.from_user_id}), (${invite.from_user_id}, ${actor.userId})
          ON CONFLICT DO NOTHING`);
    }
    await query(sql`UPDATE personal_trust_invites SET status = ${input.accept ? "accepted" : "declined"}
        WHERE id = ${input.id}`);
    return { accepted: input.accept };
  });
};

export const endPersonalTrust = async function (
  actor: z.output<typeof WorkspaceActorSchema>,
  raw: z.output<typeof PersonalTrustUsernameSchema>
) {
  const input = await PersonalTrustUsernameSchema.parseAsync(raw);

  return await withDatabaseTransaction(async () => {
    await requirePersonalActor(actor);
    const peer = await lookupDirectoryUser(input.username);
    await clearPersonalTrust(actor.userId, peer.userId);
    return { ended: true };
  });
};

export const blockPersonalTrust = async function (
  actor: z.output<typeof WorkspaceActorSchema>,
  raw: z.output<typeof PersonalTrustUsernameSchema>
) {
  const input = await PersonalTrustUsernameSchema.parseAsync(raw);

  return await withDatabaseTransaction(async () => {
    await requirePersonalActor(actor);
    const peer = await lookupDirectoryUser(input.username);
    if (peer.userId === actor.userId) throw new WorkspaceAccessDenied();
    await clearPersonalTrust(actor.userId, peer.userId);
    await query(sql`INSERT INTO personal_trust_blocks(user_id, blocked_user_id)
        VALUES (${actor.userId}, ${peer.userId}) ON CONFLICT DO NOTHING`);
    return { blocked: true };
  });
};

export const listPersonalNetwork = async function (
  actor: z.output<typeof WorkspaceActorSchema>
) {
  await requirePersonalActor(actor);

  const invites = await query(sql`SELECT i.id, d.username,
      CASE WHEN i.from_user_id = ${actor.userId} THEN 'sent' ELSE 'received' END AS direction
    FROM personal_trust_invites i
    JOIN user_directory d ON ('better-auth:' || d.user_id) = CASE
      WHEN i.from_user_id = ${actor.userId} THEN i.to_user_id ELSE i.from_user_id END
    WHERE i.status = 'pending' AND i.expires_at > now()
      AND (i.from_user_id = ${actor.userId} OR i.to_user_id = ${actor.userId})
    ORDER BY i.created_at`);
  const connections =
    await query(sql`SELECT d.username, u.name, bot.username AS "botUsername" FROM personal_trust_edges e
    JOIN public.user u ON ('better-auth:' || u.id) = e.peer_user_id
    JOIN user_directory d ON d.user_id = u.id
    LEFT JOIN LATERAL (SELECT b.username FROM workspace_bots b JOIN workspaces w ON w.id = b.workspace_id
      JOIN workspace_memberships m ON m.workspace_id = w.id AND m.user_id = e.peer_user_id AND m.role = 'owner'
      WHERE w.organization_id IS NULL AND b.discoverable LIMIT 1) bot ON true
    WHERE e.user_id = ${actor.userId} ORDER BY d.username`);
  return {
    invites: await z.array(inviteSchema).parseAsync(invites),
    connections: await z.array(connectionSchema).parseAsync(connections),
  };
};

const resolvePublishedBot = async function (
  actor: z.output<typeof WorkspaceActorSchema>,
  username: string
) {
  const access = await requireWorkspaceAccess(actor);
  const handle = await UsernameSchema.parseAsync(username);

  const rows = await query<{
    id: string;
    username: string;
    name: string;
    description: string;
    workspace_id: string;
    organization_id: string | null;
    issued_by: string;
    owner_id: string | null;
  }>(sql`SELECT DISTINCT ON (b.id) b.id, b.username, b.name, b.description, b.workspace_id,
        w.organization_id, issuer.user_id AS issued_by, owner.user_id AS owner_id
      FROM workspace_bots b
      JOIN workspaces w ON w.id = b.workspace_id
      JOIN workspace_memberships issuer ON issuer.workspace_id = b.workspace_id AND issuer.role IN ('owner', 'admin')
      LEFT JOIN workspace_memberships owner ON owner.workspace_id = b.workspace_id AND owner.role = 'owner'
      WHERE b.username = ${handle} AND b.discoverable
      ORDER BY b.id, CASE issuer.role WHEN 'owner' THEN 0 ELSE 1 END`);
  const bot = rows[0];
  if (!bot) throw new WorkspaceAccessDenied();
  if (access.organizationId) {
    if (bot.organization_id !== access.organizationId)
      throw new WorkspaceAccessDenied();
    const member = await query(sql`SELECT 1 FROM organization_memberships
        WHERE organization_id = ${access.organizationId} AND user_id = ${actor.userId}`);
    if (!member.length) throw new WorkspaceAccessDenied();
    return {
      ...bot,
      networkKind: "company" as const,
      networkId: access.organizationId,
    };
  }
  if (bot.organization_id !== null || !bot.owner_id)
    throw new WorkspaceAccessDenied();
  if (await blockedPair(actor.userId, bot.owner_id))
    throw new WorkspaceAccessDenied();
  const edge = await query(sql`SELECT 1 FROM personal_trust_edges
      WHERE user_id = ${actor.userId} AND peer_user_id = ${bot.owner_id}`);
  if (!edge.length) throw new WorkspaceAccessDenied();
  return {
    ...bot,
    networkKind: "personal" as const,
    networkId: personalNetworkId(actor.userId, bot.owner_id),
  };
};

const conversationGrant = async function (
  actor: z.output<typeof WorkspaceActorSchema>,
  bot: {
    id: string;
    issued_by: string;
    workspace_id: string;
    networkKind: "company" | "personal";
    networkId: string;
  },
  originBotId: string | null
) {
  await query(
    sql`SELECT id FROM workspace_bots WHERE id = ${bot.id} FOR UPDATE`
  );
  const existing = await query<{
    id: string;
  }>(sql`SELECT id FROM workspace_agent_grants
    WHERE bot_id = ${bot.id} AND requester_user_id = ${actor.userId} AND source_workspace_id = ${actor.workspaceId}
      AND network_kind = ${bot.networkKind} AND network_id = ${bot.networkId}
      AND origin_bot_id IS NOT DISTINCT FROM ${originBotId}
      AND revoked_at IS NULL AND expires_at > now()
      AND capabilities = ${conversationCapabilities}::jsonb
    FOR UPDATE`);
  if (existing[0])
    return {
      id: existing[0].id,
      issuedBy: bot.issued_by,
      workspaceId: bot.workspace_id,
    };
  const active = await query(
    sql`SELECT id FROM workspace_agent_grants WHERE bot_id = ${bot.id} AND revoked_at IS NULL AND expires_at > now()`
  );
  if (active.length >= 20) throw new WorkspaceAccessDenied();
  const token = `zoen_a2a_${randomBytes(32).toString("base64url")}`;
  const id = randomUUID();
  const expiresAt = new Date(new Date().getTime() + 7 * 86400000);
  await query(sql`INSERT INTO workspace_agent_grants(id, bot_id, issued_by, label, token_hash, capabilities, expires_at, requester_user_id, source_workspace_id, network_kind, network_id, origin_bot_id)
    VALUES (${id}, ${bot.id}, ${bot.issued_by}, 'Network conversation', ${createHash("sha256").update(token).digest("hex")}, ${conversationCapabilities}::jsonb, ${expiresAt}, ${actor.userId}, ${actor.workspaceId}, ${bot.networkKind}, ${bot.networkId}, ${originBotId})`);
  return { id, issuedBy: bot.issued_by, workspaceId: bot.workspace_id };
};

/** Called by authenticated UI or Executor code; agent identity is never supplied by the model. */
export const openNetworkBot = async function (
  actor: z.output<typeof WorkspaceActorSchema>,
  username: string,
  asAgent = false
) {
  return await withDatabaseTransaction(async () => {
    if (!actor.authSessionId) throw new WorkspaceAccessDenied();
    await requireWorkspaceAccess(actor);
    const dest = await resolvePublishedBot(actor, username);
    const source = asAgent
      ? (
          await query<{
            id: string;
            name: string;
          }>(
            sql`SELECT id, name FROM workspace_bots WHERE workspace_id = ${actor.workspaceId}`
          )
        )[0]
      : undefined;
    if (asAgent && (!source || source.id === dest.id))
      throw new WorkspaceAccessDenied();
    const grant = await conversationGrant(actor, dest, source?.id ?? null);
    return {
      dest: {
        id: dest.id,
        username: dest.username,
        name: dest.name,
        description: dest.description,
      },
      source,
      network: { kind: dest.networkKind, id: dest.networkId },
      destActor: {
        userId: grant.issuedBy,
        workspaceId: grant.workspaceId,
        agentGrantId: grant.id,
      },
    };
  });
};

export const contactNetworkBot = async function (
  actor: z.output<typeof WorkspaceActorSchema>,
  raw: z.output<typeof ContactNetworkBotSchema>
) {
  const input = await ContactNetworkBotSchema.strict().parseAsync(raw);

  return await withDatabaseTransaction(async () => {
    if (!actor.authSessionId) throw new WorkspaceAccessDenied();
    await requireWorkspaceAccess(actor);
    const dest = await resolvePublishedBot(actor, input.destUsername);
    let chain: ProtocolTaskChain | undefined;
    let originBotId: string | null = null;
    if (input.originTaskId) {
      const origin = await query<{
        id: string;
        correlation_id: string;
        round: number;
        bot_id: string;
        workspace_id: string;
      }>(sql`SELECT t.id, t.correlation_id, t.round, g.bot_id, b.workspace_id
          FROM agent_protocol_tasks t
          JOIN workspace_agent_grants g ON g.id = t.grant_id
          JOIN workspace_bots b ON b.id = g.bot_id
          WHERE t.id = ${input.originTaskId}`);
      const source = origin[0];
      if (!source || source.workspace_id !== actor.workspaceId)
        throw new WorkspaceAccessDenied();
      if (source.bot_id === dest.id) throw new WorkspaceAccessDenied();
      const started = await query<{
        started: string;
      }>(
        sql`SELECT min(created_at)::text AS started FROM agent_protocol_tasks WHERE correlation_id = ${source.correlation_id}`
      );
      if (
        started[0] &&
        Date.now() - Date.parse(started[0].started) > 10 * 60 * 1000
      )
        throw new A2AError({
          code: -32000,
          message: "Task chain expired",
        });
      const round = source.round + 1;
      if (round > 8)
        throw new A2AError({
          code: -32000,
          message: "Task chain limit reached",
        });
      originBotId = source.bot_id;
      chain = {
        correlationId: source.correlation_id,
        round,
        originTaskId: source.id,
      };
    }
    const grant = await conversationGrant(actor, dest, originBotId);
    const destActor = {
      userId: grant.issuedBy,
      workspaceId: grant.workspaceId,
      agentGrantId: grant.id,
    };
    const task = await acceptProtocolTask(
      destActor,
      { message: input.message },
      chain
    );
    return {
      task,
      dest: await BotProfileSchema.parseAsync({
        username: dest.username,
        name: dest.name,
        description: dest.description,
        discoverable: true,
      }),
      network: { kind: dest.networkKind, id: dest.networkId },
      destActor,
    };
  });
};
