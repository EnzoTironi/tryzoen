import { query, transaction as withDatabaseTransaction } from "@db/queries";
import { sql } from "drizzle-orm";
import { MatrixError } from "../matrix/client";
import { WhatsAppBridgeUnavailable } from "../whatsapp/client";
import { VaultwardenUnavailable } from "../workspaces/vault";
import { AuthUnavailable } from "../../db/services/auth/index";
import { SqlError } from "../../db/queries";
import { z } from "zod";
import { randomUUID } from "node:crypto";
import { readAuthSession } from "@db/services/auth/session";
import { accessScopeForUser } from "@shared/identity/access-scope";
import { deactivateMatrixUser } from "../matrix/client";
import { logoutWhatsApp } from "../whatsapp/client";
import {
  requireWorkspaceAccess,
  type WorkspaceActorSchema,
} from "../workspaces/access";
import { eraseVaultwardenUser } from "../workspaces/vault";
import { ErasureJournal } from "./erasure-journal";
export class AccountDeletionError extends Error {
  readonly _tag = "AccountDeletionError";
  declare readonly reason:
    | "unauthenticated"
    | "blocked_sole_owner"
    | "unavailable";
  constructor(input: {
    readonly reason: "unauthenticated" | "blocked_sole_owner" | "unavailable";
  }) {
    super("AccountDeletionError");
    this.name = "AccountDeletionError";
    Object.assign(this, input);
  }
}
const identifier = z.string().min(1).max(200);
const OrganizationActionSchema = z.object({
  organizationId: identifier,
});
const TransferAdminSchema = z.object({
  organizationId: identifier,
  targetUserId: identifier,
});
const decode =
  <S extends z.ZodType>(schema: S) =>
  (input: unknown) =>
    schema.parseAsync(input);
const externalPending = [
  "vaultwarden",
  "whatsapp",
  "matrix",
  "mem0",
  "backups",
] as const;
const resultSchema = z.object({
  backupExpiresAt: z.string(),
  pending: z.array(z.string()),
  retainedCompany: z.array(z.string()),
  status: z.enum(["pending_external", "completed"]),
});

/**
 * Durable personal-account deletion. Zoen-controlled rows are erased or kept
 * as company property. Live Mem0 and backups stay pending. Vaultwarden,
 * mautrix and Synapse are attempted after commit and stay pending_external
 * when the provider is down. The erasure journal survives restoration.
 */
export const requestAccountDeletion = async function (
  actor: z.output<typeof WorkspaceActorSchema>
) {
  try {
    const personal = accessScopeForUser(actor.userId);
    const prepared = await withDatabaseTransaction(async () => {
      await lockAccountOrganizations(actor.userId);
      await requireLiveSession(actor);
      if (await isSoleOrganizationOwner(actor.userId)) return null;
      await Promise.try(async () => ErasureJournal.append(actor.userId)).catch(
        () => {
          throw new AccountDeletionError({
            reason: "unavailable",
          });
        }
      );
      const handles = await collectExternalWipeHandles(
        actor.userId,
        personal.workspaceId
      );
      await eraseZoenControlledData(actor.userId, personal.workspaceId);
      return {
        handles,
        result: await persistCompletedRequest(actor.userId, [
          ...externalPending,
        ]),
      };
    });
    if (!prepared) {
      await persistBlockedRequest(actor.userId);
      throw new AccountDeletionError({
        reason: "blocked_sole_owner",
      });
    }
    return await finishExternalWipes(
      actor.userId,
      prepared.handles,
      prepared.result
    );
  } catch (error) {
    if (error instanceof SqlError) {
      throw new AccountDeletionError({
        reason: "unavailable",
      });
    }
    throw error;
  }
};
export const requestAccountDeletionFromHeaders = async function (
  headers: Headers
) {
  const session = await Promise.try(async () => readAuthSession(headers)).catch(
    (error: unknown) => {
      if (error instanceof AuthUnavailable)
        throw new AccountDeletionError({
          reason: "unavailable",
        });
      throw error;
    }
  );
  if (!session)
    throw new AccountDeletionError({
      reason: "unauthenticated",
    });
  const userId = `better-auth:${session.user.id}`;
  return await requestAccountDeletion({
    authSessionId: session.session.id,
    userId,
    workspaceId: accessScopeForUser(userId).workspaceId,
  });
};
export const transferOrganizationAdmin = async function (
  actor: z.output<typeof WorkspaceActorSchema>,
  raw: z.output<typeof TransferAdminSchema>
) {
  try {
    const input = await decode(TransferAdminSchema)(raw);
    await requireLiveSession(actor);
    return await withDatabaseTransaction(async () => {
      await lockAccountOrganizations(actor.userId);
      const access = await requireWorkspaceAccess(actor, true);
      if (access.organizationId !== input.organizationId)
        throw new AccountDeletionError({
          reason: "unavailable",
        });
      await requireOrganizationAdmin(actor.userId, input.organizationId);
      const target =
        await query(sql`UPDATE organization_memberships SET role = 'admin'
          WHERE organization_id = ${input.organizationId} AND user_id = ${input.targetUserId}
            AND role = 'member' RETURNING user_id`);
      if (!target.length)
        throw new AccountDeletionError({
          reason: "unavailable",
        });
      await query(sql`UPDATE organization_memberships SET role = 'member'
          WHERE organization_id = ${input.organizationId} AND user_id = ${actor.userId} AND role = 'admin'`);
      await query(sql`UPDATE workspace_memberships SET role = 'admin'
          WHERE user_id = ${input.targetUserId} AND role = 'member'
            AND workspace_id IN (SELECT id FROM workspaces WHERE organization_id = ${input.organizationId})`);
      await query(sql`UPDATE workspace_memberships SET role = 'member'
          WHERE user_id = ${actor.userId} AND role = 'admin'
            AND workspace_id IN (SELECT id FROM workspaces WHERE organization_id = ${input.organizationId})`);
      return {
        transferred: true as const,
      };
    });
  } catch (error) {
    if (error instanceof SqlError) {
      throw new AccountDeletionError({
        reason: "unavailable",
      });
    }
    throw error;
  }
};
export const closeOrganizationForDeletion = async function (
  actor: z.output<typeof WorkspaceActorSchema>,
  raw: z.output<typeof OrganizationActionSchema>
) {
  try {
    const input = await decode(OrganizationActionSchema)(raw);
    await requireLiveSession(actor);
    return await withDatabaseTransaction(async () => {
      await lockAccountOrganizations(actor.userId);
      const access = await requireWorkspaceAccess(actor, true);
      if (access.organizationId !== input.organizationId)
        throw new AccountDeletionError({
          reason: "unavailable",
        });
      await requireOrganizationAdmin(actor.userId, input.organizationId);
      const others =
        await query(sql`SELECT user_id FROM organization_memberships
          WHERE organization_id = ${input.organizationId} AND user_id <> ${actor.userId}`);
      if (others.length)
        throw new AccountDeletionError({
          reason: "unavailable",
        });
      await query(
        sql`DELETE FROM workspaces WHERE organization_id = ${input.organizationId}`
      );
      return {
        closed: true as const,
      };
    });
  } catch (error) {
    if (error instanceof SqlError) {
      throw new AccountDeletionError({
        reason: "unavailable",
      });
    }
    throw error;
  }
};
export const applyAccountDeletionTombstones = async function () {
  try {
    const tombs = await Promise.try(async () => ErasureJournal.read()).catch(
      () => {
        throw new AccountDeletionError({
          reason: "unavailable",
        });
      }
    );
    for (const tomb of tombs) {
      const personal = accessScopeForUser(tomb.userId);
      const raw = rawUserId(tomb.userId);
      const present =
        await query(sql`SELECT 1 FROM public."user" WHERE id = ${raw}
        UNION ALL SELECT 1 FROM workspaces WHERE id = ${personal.workspaceId}`);
      const handles = await collectExternalWipeHandles(
        tomb.userId,
        personal.workspaceId
      );
      if (present.length)
        await withDatabaseTransaction(async () => {
          await eraseZoenControlledData(tomb.userId, personal.workspaceId);
          await persistCompletedRequest(tomb.userId, [...externalPending]);
        });
      await attemptExternalWipes(tomb.userId, handles);
    }
    return {
      applied: tombs.length,
    };
  } catch (error) {
    if (error instanceof SqlError) {
      throw new AccountDeletionError({
        reason: "unavailable",
      });
    }
    throw error;
  }
};
const requireLiveSession = async function (
  actor: z.output<typeof WorkspaceActorSchema>
) {
  if (!actor.authSessionId)
    throw new AccountDeletionError({
      reason: "unauthenticated",
    });
  const rows = await query(sql`SELECT 1 FROM public.session
      WHERE id = ${actor.authSessionId} AND "userId" = ${rawUserId(actor.userId)}
        AND "expiresAt" > now()`);
  if (!rows.length)
    throw new AccountDeletionError({
      reason: "unauthenticated",
    });
  return undefined;
};
const isSoleOrganizationOwner = async function (userId: string) {
  const orgs = await query<{
    organization_id: string;
  }>(sql`SELECT organization_id FROM organization_memberships
      WHERE user_id = ${userId} AND role = 'admin'`);
  for (const org of orgs) {
    const otherAdmins = await query(sql`SELECT 1 FROM organization_memberships
        WHERE organization_id = ${org.organization_id} AND role = 'admin'
          AND user_id <> ${userId}`);
    if (otherAdmins.length) continue;
    const remainder = await query(sql`SELECT 1 FROM organization_memberships
          WHERE organization_id = ${org.organization_id} AND user_id <> ${userId}
        UNION ALL SELECT 1 FROM workspaces
          WHERE organization_id = ${org.organization_id}`);
    if (remainder.length) return true;
  }
  return false;
};
const lockAccountOrganizations = async function (userId: string) {
  await query(sql`SELECT id FROM organizations
      WHERE id IN (SELECT organization_id FROM organization_memberships WHERE user_id = ${userId})
      ORDER BY id FOR UPDATE`);
};
const requireOrganizationAdmin = async function (
  userId: string,
  organizationId: string
) {
  const rows = await query(sql`SELECT 1 FROM organization_memberships
      WHERE organization_id = ${organizationId} AND user_id = ${userId} AND role = 'admin'`);
  if (!rows.length)
    throw new AccountDeletionError({
      reason: "unavailable",
    });
  return undefined;
};
const eraseZoenControlledData = async function (
  userId: string,
  personalWorkspaceId: string
) {
  const raw = rawUserId(userId);
  await query(sql`UPDATE whatsapp_bridge_drafts SET status = 'cancelled'
      WHERE status IN ('draft', 'authorized', 'queued') AND account_id IN (
        SELECT id FROM whatsapp_bridge_accounts WHERE workspace_id = ${personalWorkspaceId}
      )`);
  await query(sql`UPDATE whatsapp_bridge_shares SET revoked_at = clock_timestamp()
      WHERE revoked_at IS NULL AND chat_id IN (
        SELECT c.id FROM whatsapp_bridge_chats c
        JOIN whatsapp_bridge_accounts a ON a.id = c.account_id
        WHERE a.workspace_id = ${personalWorkspaceId}
      )`);
  await query(sql`UPDATE whatsapp_bridge_chats SET revoked_at = clock_timestamp()
      WHERE revoked_at IS NULL AND account_id IN (
        SELECT id FROM whatsapp_bridge_accounts WHERE workspace_id = ${personalWorkspaceId}
      )`);
  await query(sql`UPDATE whatsapp_bridge_accounts
      SET status = 'revoked', revoked_at = clock_timestamp(), pairing_nonce_hash = 'revoked'
      WHERE workspace_id = ${personalWorkspaceId} AND revoked_at IS NULL`);
  await query(sql`DELETE FROM public.session WHERE "userId" = ${raw}`);
  await query(sql`UPDATE channel_identity SET revoked_at = clock_timestamp(), updated_at = clock_timestamp()
      WHERE user_id = ${raw} AND revoked_at IS NULL`);
  await query(sql`UPDATE scheduled_agent_jobs SET status = 'deleted', updated_at = clock_timestamp()
      WHERE created_by_user_id = ${userId} AND status <> 'deleted'`);
  await query(sql`UPDATE channel_outbox q SET status = 'cancelled', lease_token = NULL, lease_expires_at = NULL, last_error = 'account_deleted'
      FROM scheduled_agent_report_outputs o JOIN scheduled_agent_runs r ON r.id = o.run_id JOIN scheduled_agent_jobs j ON j.id = r.job_id
      WHERE q.id = o.outbox_id AND j.created_by_user_id = ${userId}
        AND q.status IN ('queued', 'dispatching')`);
  await query(sql`UPDATE workspace_agent_grants SET revoked_at = clock_timestamp()
      WHERE revoked_at IS NULL AND (issued_by = ${userId} OR requester_user_id = ${userId})`);
  await query(sql`UPDATE agent_protocol_tasks t SET state = 'TASK_STATE_CANCELED', updated_at = now()
      FROM workspace_agent_grants g
      WHERE t.grant_id = g.id AND (g.issued_by = ${userId} OR g.requester_user_id = ${userId})
        AND t.state IN ('TASK_STATE_SUBMITTED', 'TASK_STATE_WORKING', 'TASK_STATE_INPUT_REQUIRED')`);
  await query(sql`UPDATE vault_item_delegations SET revoked_at = clock_timestamp(), wrapped_secret = 'revoked'
      WHERE issued_by = ${userId} AND revoked_at IS NULL`);
  await query(sql`UPDATE whatsapp_bridge_shares SET revoked_at = clock_timestamp()
      WHERE issued_by = ${userId} AND revoked_at IS NULL`);
  await query(
    sql`DELETE FROM workspace_connections WHERE connected_by = ${userId}`
  );
  await query(
    sql`DELETE FROM personal_trust_edges WHERE user_id = ${userId} OR peer_user_id = ${userId}`
  );
  await query(
    sql`DELETE FROM personal_trust_invites WHERE from_user_id = ${userId} OR to_user_id = ${userId}`
  );
  await query(
    sql`DELETE FROM personal_trust_blocks WHERE user_id = ${userId} OR blocked_user_id = ${userId}`
  );
  await query(sql`DELETE FROM matrix_identities WHERE user_id = ${userId}`);
  await query(sql`DELETE FROM telemetry_events WHERE user_id = ${userId}`);
  await query(
    sql`DELETE FROM account_archive WHERE source_user_id = ${raw} OR target_user_id = ${raw}`
  );
  const company = await query<{
    id: string;
  }>(sql`SELECT w.id FROM workspaces w JOIN workspace_memberships m ON m.workspace_id = w.id
      WHERE m.user_id = ${userId} AND w.organization_id IS NOT NULL`);
  for (const workspace of company) {
    await query(
      sql`DELETE FROM workspace_memory_namespace WHERE workspace_id = ${workspace.id} AND user_id = ${userId}`
    );
    await query(sql`UPDATE workspace_invites SET status = 'revoked'
        WHERE workspace_id = ${workspace.id} AND ('better-auth:' || target_user_id) = ${userId} AND status = 'pending'`);
    await query(
      sql`DELETE FROM workspace_memberships WHERE workspace_id = ${workspace.id} AND user_id = ${userId}`
    );
  }
  await query(
    sql`DELETE FROM organization_memberships WHERE user_id = ${userId}`
  );
  await query(
    sql`DELETE FROM workspaces WHERE id = ${personalWorkspaceId} AND organization_id IS NULL`
  );
  await query(sql`DELETE FROM public."user" WHERE id = ${raw}`);
};
const persistBlockedRequest = async function (userId: string) {
  await query(sql`INSERT INTO account_deletion_requests(
        id, user_id, status, blocked_reason, backup_expires_at, completed_at
      ) VALUES (${randomUUID()}, ${userId}, 'blocked', 'sole_owner', NULL, NULL)
      ON CONFLICT (user_id) DO UPDATE SET
        status = 'blocked', blocked_reason = 'sole_owner',
        backup_expires_at = NULL, completed_at = NULL`);
};
const persistCompletedRequest = async function (
  userId: string,
  pending: readonly string[]
) {
  const backupExpiresAt = new Date(new Date().getTime() + 30 * 86400000);
  const rows = await query<{
    id: string;
  }>(sql`INSERT INTO account_deletion_requests(
        id, user_id, status, blocked_reason, backup_expires_at, completed_at
      ) VALUES (
        ${randomUUID()}, ${userId}, 'pending_external', NULL, ${backupExpiresAt}, clock_timestamp()
      )
      ON CONFLICT (user_id) DO UPDATE SET
        status = 'pending_external', blocked_reason = NULL,
        backup_expires_at = EXCLUDED.backup_expires_at, completed_at = clock_timestamp()
      RETURNING id`);
  const requestId = rows[0]?.id;
  if (!requestId)
    throw new AccountDeletionError({
      reason: "unavailable",
    });
  await query(
    sql`DELETE FROM account_deletion_ledger WHERE request_id = ${requestId}`
  );
  await query(sql`INSERT INTO account_deletion_tombstones(user_id, request_id)
      VALUES (${userId}, ${requestId})
      ON CONFLICT (user_id) DO UPDATE SET request_id = EXCLUDED.request_id, deleted_at = clock_timestamp()`);
  const ledger: readonly (readonly [string, string])[] = [
    ["sessions", "erased"],
    ["jobs", "erased"],
    ["grants", "erased"],
    ["connections", "erased"],
    ["personal_workspace", "erased"],
    ["conversations", "erased"],
    ["git", "erased"],
    ["company_workspace", "retained_company"],
    ["company_git", "retained_company"],
    ["backups", "backup_held"],
    ...pending
      .filter((surface) => surface !== "backups")
      .map((surface) => [surface, "pending_external"] as const),
  ];
  for (const [surface, status] of ledger) {
    await query(sql`INSERT INTO account_deletion_ledger(id, request_id, surface, status)
        VALUES (${randomUUID()}, ${requestId}, ${surface}, ${status})`);
  }
  return await resultSchema.parseAsync({
    backupExpiresAt: backupExpiresAt.toISOString(),
    pending,
    retainedCompany: ["company_workspace", "company_git", "audit_receipts"],
    status: "pending_external",
  });
};
interface ExternalWipeHandles {
  readonly matrixIds: readonly string[];
  readonly rawUserId: string;
  readonly whatsapp: readonly {
    readonly loginId: string | null;
    readonly matrixUserId: string;
  }[];
}
const collectExternalWipeHandles = async function (
  userId: string,
  personalWorkspaceId: string
) {
  const accounts = await query<{
    login_id: string | null;
    matrix_user_id: string | null;
  }>(sql`SELECT matrix_user_id, login_id FROM whatsapp_bridge_accounts
      WHERE matrix_user_id IS NOT NULL
        AND (user_id = ${userId} OR workspace_id = ${personalWorkspaceId})`);
  const identities = await query<{
    matrix_id: string;
  }>(sql`SELECT matrix_id FROM matrix_identities WHERE user_id = ${userId}`);
  return {
    matrixIds: identities.map((row) => row.matrix_id),
    rawUserId: rawUserId(userId),
    whatsapp: accounts.flatMap((row) =>
      row.matrix_user_id
        ? [
            {
              loginId: row.login_id,
              matrixUserId: row.matrix_user_id,
            },
          ]
        : []
    ),
  };
};
const markLedgerErased = async function (
  userId: string,
  surfaces: readonly string[]
) {
  if (!surfaces.length) return;
  for (const surface of surfaces) {
    await query(sql`UPDATE account_deletion_ledger l SET status = 'erased'
      FROM account_deletion_requests r
      WHERE l.request_id = r.id AND r.user_id = ${userId}
        AND l.surface = ${surface} AND l.status = 'pending_external'`);
  }
};
const attemptExternalWipes = async function (
  userId: string,
  handles: ExternalWipeHandles
) {
  const erased: string[] = [];
  const vaultOk = await Promise.try(async () => {
    await eraseVaultwardenUser(handles.rawUserId);
    return true;
  }).catch((error: unknown) => {
    if (error instanceof VaultwardenUnavailable) return Promise.resolve(false);
    throw error;
  });
  if (vaultOk) erased.push("vaultwarden");
  const whatsappOk = await Promise.all(
    handles.whatsapp.map(async (row) => {
      try {
        await logoutWhatsApp(row.matrixUserId, row.loginId);
        return true;
      } catch (error) {
        if (error instanceof WhatsAppBridgeUnavailable) return false;
        throw error;
      }
    })
  );
  if (handles.whatsapp.length > 0 && whatsappOk.every((ok) => ok))
    erased.push("whatsapp");
  const matrixOk = await Promise.all(
    handles.matrixIds.map(async (matrixId) => {
      try {
        await deactivateMatrixUser(matrixId);
        return true;
      } catch (error) {
        if (error instanceof MatrixError) return false;
        throw error;
      }
    })
  );
  if (handles.matrixIds.length > 0 && matrixOk.every((ok) => ok))
    erased.push("matrix");
  await markLedgerErased(userId, erased);
  return erased;
};
const finishExternalWipes = async function (
  userId: string,
  handles: ExternalWipeHandles,
  result: z.output<typeof resultSchema>
) {
  const erased = await attemptExternalWipes(userId, handles);
  return await resultSchema.parseAsync({
    ...result,
    pending: result.pending.filter((surface) => !erased.includes(surface)),
  });
};
function rawUserId(userId: string) {
  return userId.startsWith("better-auth:")
    ? userId.slice("better-auth:".length)
    : userId;
}
