import {
  query as dbQuery,
  transaction as withDatabaseTransaction,
} from "@db/queries";
import { sql } from "drizzle-orm";
import { z } from "zod";
import { createHash, randomBytes, randomUUID } from "node:crypto";

import { UsernameSchema } from "../accounts/directory";
import {
  requireWorkspaceAccess,
  WorkspaceAccessDenied,
  type WorkspaceActorSchema,
} from "./access";

export const BotProfileSchema = z.object({
  username: UsernameSchema,
  name: z.string().trim().min(1).max(60),
  description: z.string().max(240),
  discoverable: z.boolean(),
});
const botSchema = BotProfileSchema.extend({ id: z.uuid() });
export const AgentGrantInputSchema = z.object({
  label: z.string().trim().min(1).max(80),
  capabilities: z
    .array(z.enum(["files", "ontology"]))
    .min(1)
    .max(2),
  days: z.number().int().min(1).max(90),
});
const grantSchema = z.object({
  id: z.string(),
  label: z.string(),
  capabilities: z.array(z.string()),
  expiresAt: z.coerce.date(),
  revokedAt: z.nullable(z.coerce.date()),
});

export const readWorkspaceBot = async function (
  actor: z.output<typeof WorkspaceActorSchema>
) {
  const access = await requireWorkspaceAccess(actor);

  const rows = await dbQuery(
    sql`SELECT id, username, name, description, discoverable FROM workspace_bots WHERE workspace_id = ${actor.workspaceId}`
  );
  const bot = rows[0] ? await botSchema.parseAsync(rows[0]) : null;
  const grants =
    bot && access.role !== "member" && actor.authSessionId
      ? await dbQuery(sql`SELECT id, label, capabilities, expires_at AS "expiresAt", revoked_at AS "revokedAt"
        FROM workspace_agent_grants WHERE bot_id = ${bot.id} ORDER BY created_at DESC LIMIT 50`)
      : [];
  return {
    bot,
    grants: await z.array(grantSchema).parseAsync(grants),
    mayManage: access.role !== "member",
  };
};

export const saveWorkspaceBot = async function (
  actor: z.output<typeof WorkspaceActorSchema>,
  raw: z.output<typeof BotProfileSchema>
) {
  const input = await BotProfileSchema.parseAsync(raw);
  if (
    ["admin", "support", "security", "zoen", "system", "api", "root"].includes(
      input.username
    )
  )
    throw new WorkspaceAccessDenied();

  return await withDatabaseTransaction(async () => {
    await requireWorkspaceAccess(actor, true);
    if (!actor.authSessionId) throw new WorkspaceAccessDenied();
    const rows =
      await dbQuery(sql`INSERT INTO workspace_bots (workspace_id, username, name, description, discoverable)
      VALUES (${actor.workspaceId}, ${input.username}, ${input.name}, ${input.description}, ${input.discoverable})
      ON CONFLICT (workspace_id) DO UPDATE SET username = EXCLUDED.username, name = EXCLUDED.name,
        description = EXCLUDED.description, discoverable = EXCLUDED.discoverable, updated_at = now()
      RETURNING id, username, name, description, discoverable`);
    return await botSchema.parseAsync(rows[0]);
  });
};

export const delegatedBotProfile = async function (
  actor: z.output<typeof WorkspaceActorSchema>
) {
  if (!actor.agentGrantId) return null;

  return await withDatabaseTransaction(async () => {
    await requireWorkspaceAccess(actor);
    const rows =
      await dbQuery(sql`SELECT b.username, b.name, b.description, b.discoverable
      FROM workspace_bots b JOIN workspace_agent_grants g ON g.bot_id = b.id
      WHERE g.id = ${actor.agentGrantId}`);
    if (!rows[0]) throw new WorkspaceAccessDenied();
    return await BotProfileSchema.parseAsync(rows[0]);
  });
};

export const searchWorkspaceBots = async function (
  actor: z.output<typeof WorkspaceActorSchema>,
  query: string
) {
  const access = await requireWorkspaceAccess(actor);
  const prefix = await z
    .string()
    .regex(/^(?:[a-z][a-z0-9_]{1,29})?$/)
    .parseAsync(query.toLowerCase());

  const rows = access.organizationId
    ? await dbQuery(sql`SELECT b.username, b.name, b.description, b.discoverable FROM workspace_bots b
      JOIN workspaces w ON w.id = b.workspace_id
      JOIN organization_memberships org ON org.organization_id = w.organization_id AND org.user_id = ${actor.userId}
      WHERE w.organization_id = ${access.organizationId} AND b.discoverable
        AND starts_with(b.username, ${prefix}) ORDER BY b.username LIMIT 20`)
    : await dbQuery(sql`SELECT b.username, b.name, b.description, b.discoverable FROM workspace_bots b
      JOIN workspaces w ON w.id = b.workspace_id AND w.organization_id IS NULL
      JOIN workspace_memberships owner ON owner.workspace_id = b.workspace_id AND owner.role = 'owner'
      JOIN personal_trust_edges e ON e.user_id = ${actor.userId} AND e.peer_user_id = owner.user_id
      WHERE b.discoverable AND starts_with(b.username, ${prefix})
        AND NOT EXISTS (
          SELECT 1 FROM personal_trust_blocks blk
          WHERE (blk.user_id = ${actor.userId} AND blk.blocked_user_id = owner.user_id)
             OR (blk.user_id = owner.user_id AND blk.blocked_user_id = ${actor.userId})
        )
      ORDER BY b.username LIMIT 20`);
  return await z.array(BotProfileSchema).parseAsync(rows);
};

export const issueAgentGrant = async function (
  actor: z.output<typeof WorkspaceActorSchema>,
  raw: z.output<typeof AgentGrantInputSchema>
) {
  const input = await AgentGrantInputSchema.parseAsync(raw);

  return await withDatabaseTransaction(async () => {
    await requireWorkspaceAccess(actor, true);
    if (!actor.authSessionId) throw new WorkspaceAccessDenied();
    const { bot } = await readWorkspaceBot(actor);
    if (!bot) throw new WorkspaceAccessDenied();
    await dbQuery(
      sql`SELECT id FROM workspace_bots WHERE id = ${bot.id} FOR UPDATE`
    );
    const active = await dbQuery(
      sql`SELECT id FROM workspace_agent_grants WHERE bot_id = ${bot.id} AND revoked_at IS NULL AND expires_at > now()`
    );
    if (active.length >= 20) throw new WorkspaceAccessDenied();
    const token = `zoen_a2a_${randomBytes(32).toString("base64url")}`;
    const id = randomUUID();
    const expiresAt = new Date(new Date().getTime() + input.days * 86400000);
    await dbQuery(sql`INSERT INTO workspace_agent_grants(id, bot_id, issued_by, label, token_hash, capabilities, expires_at)
      VALUES (${id}, ${bot.id}, ${actor.userId}, ${input.label}, ${createHash("sha256").update(token).digest("hex")}, ${JSON.stringify(input.capabilities)}::jsonb, ${expiresAt})`);
    return { id, token, expiresAt };
  });
};

export const revokeAgentGrant = async function (
  actor: z.output<typeof WorkspaceActorSchema>,
  id: string
) {
  return await withDatabaseTransaction(async () => {
    await requireWorkspaceAccess(actor, true);
    const rows =
      await dbQuery(sql`UPDATE workspace_agent_grants g SET revoked_at = COALESCE(revoked_at, now())
      FROM workspace_bots b WHERE g.id = ${id} AND b.id = g.bot_id AND b.workspace_id = ${actor.workspaceId} RETURNING g.id`);
    if (!rows.length) throw new WorkspaceAccessDenied();
    return { revoked: true };
  });
};

export const authenticateAgentGrant = async function (
  authorization: string | null,
  username: string
) {
  const token = await Promise.try(async () =>
    z
      .string()
      .regex(/^Bearer zoen_a2a_[A-Za-z0-9_-]{43}$/)
      .parseAsync(authorization)
  ).catch(() => {
    throw new WorkspaceAccessDenied();
  });

  const rows = await dbQuery<{
    id: string;
    user_id: string;
    workspace_id: string;
    organization_id: string | null;
  }>(sql`SELECT g.id, g.issued_by AS user_id, b.workspace_id, w.organization_id
    FROM workspace_agent_grants g JOIN workspace_bots b ON b.id = g.bot_id JOIN workspaces w ON w.id = b.workspace_id
    WHERE g.token_hash = ${createHash("sha256").update(token.slice(7)).digest("hex")} AND b.username = ${username}
      AND g.revoked_at IS NULL AND g.expires_at > clock_timestamp()`);
  const grant = rows[0];
  if (!grant) throw new WorkspaceAccessDenied();
  const actor = await requireWorkspaceAccess({
    userId: grant.user_id,
    workspaceId: grant.workspace_id,
    agentGrantId: grant.id,
  });
  return {
    actor,
    workspaceKind:
      grant.organization_id === null
        ? ("personal" as const)
        : ("company" as const),
  };
};

export const readAgentGrantCapabilities = async function (
  actor: z.output<typeof WorkspaceActorSchema>
) {
  await requireWorkspaceAccess(actor);

  const rows = await dbQuery(
    sql`SELECT capabilities FROM workspace_agent_grants WHERE id = ${actor.agentGrantId ?? "00000000-0000-0000-0000-000000000000"}`
  );
  return rows[0]
    ? (
        await z
          .object({ capabilities: z.array(z.string()) })
          .parseAsync(rows[0])
      ).capabilities
    : [];
};
