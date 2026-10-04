import { query, transaction as withDatabaseTransaction } from "@db/queries";
import { sql } from "drizzle-orm";
import { WhatsAppBridgeUnavailable } from "../whatsapp/client";
import { VaultwardenUnavailable } from "../workspaces/vault";
import { AuthUnavailable } from "../../db/services/auth/index";
import { SqlError } from "../../db/queries";
import { z } from "zod";
import { randomUUID } from "node:crypto";
import { readAuthSession } from "@db/services/auth/session";
import { accessScopeForUser } from "@shared/identity/access-scope";
import { logoutWhatsApp } from "../whatsapp/client";
import {
  requireWorkspaceAccess,
  type WorkspaceActorSchema,
} from "../workspaces/access";
import { eraseVaultwardenUser } from "../workspaces/vault";
import { ErasureJournal } from "./erasure-journal";
import { queuePayloadErasure } from "../payloads/erasure";
import { recordMemoryErasureIntents } from "../memory/erasure-intents";
import { captureMatrixErasureDepartures } from "../matrix/erasure";
import { MatrixErasureDepartureSchema } from "../matrix/erasure-contract";
import { lockMatrixOrganizations } from "../matrix/authority";
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
  "file_memory",
  "private_files",
  "backups",
] as const;
const resultSchema = z.object({
  backupExpiresAt: z.iso.datetime(),
  pending: z.array(z.string()),
  retainedCompany: z.array(z.string()),
  status: z.enum(["pending_external", "completed"]),
});

/**
 * Durable personal-account deletion. Zoen-controlled rows are erased or kept
 * as company property. File erasure and backups stay pending. Vaultwarden and
 * mautrix keep their existing provider paths; Matrix handles and departures
 * remain durable for the top-level reconciler. The journal survives restoration.
 */
export const requestAccountDeletion = async function (
  actor: z.output<typeof WorkspaceActorSchema>
) {
  try {
    const personal = accessScopeForUser(actor.userId);
    // Authenticate before reading private, non-restored deletion history.
    await requireLiveSession(actor);
    const inherited = await readJournalIntent(actor.userId);
    const prepared = await withDatabaseTransaction(
      async () => {
        const departures = await captureMatrixErasureDepartures(
          actor.userId,
          inherited.departures
        );
        await requireLiveSession(actor);
        if (await isSoleOrganizationOwner(actor.userId))
          throw new AccountDeletionError({ reason: "blocked_sole_owner" });
        const handles = await collectExternalWipeHandles(
          actor.userId,
          personal.workspaceId
        );
        const matrixIds = mergeMatrixIds(
          handles.matrixIds,
          inherited.matrixIds,
          departures.map((item) => item.matrixId),
          await pendingMatrixIds(actor.userId)
        );
        // Publication is immutable intent. A SQL rollback leaves replayable handles,
        // never evidence that provider erasure or an outer commit succeeded.
        await ErasureJournal.append({
          userId: actor.userId,
          matrixIds,
          departures,
        });
        await eraseZoenControlledData(actor.userId, personal.workspaceId);
        return {
          handles,
          result: await persistCompletedRequest(
            actor.userId,
            [...externalPending],
            matrixIds
          ),
        };
      },
      { outermost: true }
    );
    return await finishExternalWipes(
      actor.userId,
      prepared.handles,
      prepared.result
    );
  } catch (error) {
    if (error instanceof AccountDeletionError) {
      if (error.reason === "blocked_sole_owner")
        await persistBlockedRequest(actor.userId);
      throw error;
    }
    throw new AccountDeletionError({ reason: "unavailable" });
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
      // Organization locks fence new workspaces; existing workspace locks fence
      // namespace and creator-corpus admission throughout journal pagination.
      await query(sql`SELECT id FROM workspaces
        WHERE organization_id=${input.organizationId} ORDER BY id FOR UPDATE`);
      await recordMemoryErasureIntents({
        kind: "organization",
        organizationId: input.organizationId,
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
    let applied = 0;
    for await (const tomb of ErasureJournal.read()) {
      const personal = accessScopeForUser(tomb.userId);
      const handles = await withDatabaseTransaction(
        async () => {
          // Restore exact receipts even if the user and identity rows no longer
          // exist. Content-addressed record order is never treated as chronology.
          const departures = await captureMatrixErasureDepartures(
            tomb.userId,
            tomb.departures
          );
          const current = await collectExternalWipeHandles(
            tomb.userId,
            personal.workspaceId
          );
          const novelIds = current.matrixIds.filter(
            (id) => !tomb.matrixIds.includes(id)
          );
          const knownDepartures = new Set(
            tomb.departures.map((item) => JSON.stringify(item))
          );
          const novelDepartures = departures.filter(
            (item) => !knownDepartures.has(JSON.stringify(item))
          );
          if (novelIds.length || novelDepartures.length)
            await ErasureJournal.append({
              userId: tomb.userId,
              matrixIds: novelIds,
              departures: novelDepartures,
            });
          const matrixIds = mergeMatrixIds(
            tomb.matrixIds,
            current.matrixIds,
            departures.map((item) => item.matrixId),
            await pendingMatrixIds(tomb.userId)
          );
          await eraseZoenControlledData(tomb.userId, personal.workspaceId);
          await persistCompletedRequest(
            tomb.userId,
            [...externalPending],
            matrixIds
          );
          return current;
        },
        { outermost: true }
      );
      // Matrix provider I/O is exclusively owned by the top-level reconciler.
      await attemptExternalWipes(tomb.userId, handles);
      applied += 1;
    }
    return { applied };
  } catch (error) {
    if (error instanceof AccountDeletionError) throw error;
    throw new AccountDeletionError({ reason: "unavailable" });
  }
};

function mergeMatrixIds(...groups: readonly (readonly string[])[]) {
  return z
    .array(MatrixErasureDepartureSchema.shape.matrixId)
    .max(1024)
    .parse([...new Set(groups.flat())].toSorted());
}

async function readJournalIntent(userId: string) {
  let matrixIds: string[] = [];
  const departures = new Map<
    string,
    z.infer<typeof MatrixErasureDepartureSchema>
  >();
  for await (const record of ErasureJournal.read(userId)) {
    matrixIds = mergeMatrixIds(matrixIds, record.matrixIds);
    for (const item of record.departures) {
      const key = JSON.stringify([item.bindingId, item.matrixId]);
      const previous = departures.get(key);
      if (previous && JSON.stringify(previous) !== JSON.stringify(item))
        throw new AccountDeletionError({ reason: "unavailable" });
      departures.set(key, item);
    }
    if (departures.size > 1024)
      throw new AccountDeletionError({ reason: "unavailable" });
  }
  return { matrixIds, departures: [...departures.values()] };
}

async function pendingMatrixIds(userId: string) {
  const rows =
    await query(sql`SELECT l.matrix_ids FROM account_deletion_ledger l
    JOIN account_deletion_requests r ON r.id=l.request_id
    WHERE r.user_id=${userId} AND l.surface='matrix' FOR UPDATE OF l`);
  return rows.flatMap((row) =>
    mergeMatrixIds(z.array(z.string()).parse(row.matrix_ids))
  );
}

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
  const rows = await query<{
    organizationId: string;
  }>(sql`SELECT organization_id AS "organizationId"
    FROM organization_memberships WHERE user_id=${userId} LIMIT 1025`);
  if (rows.length > 1024)
    throw new AccountDeletionError({ reason: "unavailable" });
  await lockMatrixOrganizations(
    rows.map((row) => row.organizationId),
    "update"
  );
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
  pending: readonly string[],
  matrixIds: string[]
) {
  const queuedMemory = await query(
    sql`SELECT 1 FROM workspace_memory_erasure WHERE owner_user_id = ${userId} LIMIT 1`
  );
  // A historical provider obligation is never declared erased by replacing its
  // runtime. Retain existing receipts until the operator verifies that cleanup.
  const historicalMemory =
    await query(sql`SELECT 1 FROM account_deletion_ledger l
    JOIN account_deletion_requests r ON r.id = l.request_id
    WHERE r.user_id = ${userId} AND l.surface = 'mem0' AND l.status = 'pending_external' LIMIT 1`);
  const matrixDepartures = await query(
    sql`SELECT 1 FROM matrix_erasure_departures WHERE owner_user_id=${userId} LIMIT 1`
  );
  const remaining = [
    ...pending.filter(
      (surface) =>
        (surface !== "file_memory" || queuedMemory.length > 0) &&
        (surface !== "matrix" ||
          matrixIds.length > 0 ||
          matrixDepartures.length > 0)
    ),
    ...(historicalMemory.length ? ["mem0"] : []),
  ];
  const backupExpiresAt = new Date(new Date().getTime() + 30 * 86400000);
  const rows = await query<{
    id: string;
    backupExpiresAt: string;
  }>(sql`INSERT INTO account_deletion_requests(
        id, user_id, status, blocked_reason, backup_expires_at, completed_at
      ) VALUES (
        ${randomUUID()}, ${userId}, 'pending_external', NULL, ${backupExpiresAt}, clock_timestamp()
      )
      ON CONFLICT (user_id) DO UPDATE SET
        status = 'pending_external', blocked_reason = NULL,
        backup_expires_at = COALESCE(account_deletion_requests.backup_expires_at,EXCLUDED.backup_expires_at),
        completed_at = COALESCE(account_deletion_requests.completed_at,clock_timestamp())
      RETURNING id,to_char(backup_expires_at AT TIME ZONE 'UTC','YYYY-MM-DD"T"HH24:MI:SS.MS"Z"') AS "backupExpiresAt"`);
  const requestId = rows[0]?.id;
  if (!requestId)
    throw new AccountDeletionError({
      reason: "unavailable",
    });
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
    ...(!queuedMemory.length ? [["file_memory", "erased"] as const] : []),
    ...(!remaining.includes("matrix") ? [["matrix", "erased"] as const] : []),
    ...remaining
      .filter((surface) => surface !== "backups")
      .map((surface) => [surface, "pending_external"] as const),
  ];
  for (const [surface, status] of ledger) {
    const handles = surface === "matrix" ? matrixIds : [];
    await query(sql`INSERT INTO account_deletion_ledger(id, request_id, surface, status,matrix_ids)
        VALUES (${randomUUID()}, ${requestId}, ${surface}, ${status},ARRAY[${sql.join(
          handles.map((id) => sql`${id}`),
          sql`, `
        )}]::text[])
        ON CONFLICT(request_id,surface) DO UPDATE SET
          status=EXCLUDED.status,matrix_ids=EXCLUDED.matrix_ids`);
  }
  await queuePayloadErasure({ kind: "account", ownerUserId: userId });
  return await resultSchema.parseAsync({
    backupExpiresAt: resultSchema.shape.backupExpiresAt.parse(
      rows[0]?.backupExpiresAt
    ),
    pending: remaining,
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
