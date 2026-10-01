import { query } from "@db/queries";
import { sql } from "drizzle-orm";
import { z } from "zod";
import { accessScopeForUser } from "@shared/identity/access-scope";
import { requireControlSession } from "./controls";
import { WorkspaceAccessDenied } from "../workspaces/access";
import { requireMemoryNamespaceAvailable } from "../memory/namespace";

export class AccountMemoryArchiveUnavailable extends Error {
  readonly _tag = "AccountMemoryArchiveUnavailable";
  constructor() {
    super("AccountMemoryArchiveUnavailable");
    this.name = "AccountMemoryArchiveUnavailable";
  }
}

/** Caller owns the transaction through content read. This entitlement authorizes
 * only its recorded source generation, never target recall or newer enrollment. */
export async function archivedPrivateNamespace(
  headers: Headers,
  archiveId: string
) {
  const id = z.uuid().parse(archiveId);
  const session = await requireControlSession(headers);
  const [raw] =
    await query(sql`SELECT source_user_id AS "sourceUserId", workspace_id AS "workspaceId",
    private_memory_namespace_id AS "namespaceId" FROM account_archive
    WHERE id=${id} AND target_user_id=${session.user.id} FOR SHARE`);
  if (!raw) throw new WorkspaceAccessDenied();
  const archive = z
    .object({
      sourceUserId: z.string(),
      workspaceId: z.string(),
      namespaceId: z.uuid().nullable(),
    })
    .parse(raw);
  const scope = accessScopeForUser(`better-auth:${archive.sourceUserId}`);
  if (scope.workspaceId !== archive.workspaceId)
    throw new WorkspaceAccessDenied();
  const [membership] =
    await query(sql`SELECT w.id FROM workspaces w JOIN workspace_memberships m ON m.workspace_id=w.id
    WHERE w.id=${scope.workspaceId} AND w.organization_id IS NULL AND m.user_id=${scope.userId} AND m.role='owner'
    FOR SHARE OF w,m`);
  if (!membership) throw new WorkspaceAccessDenied();
  if (archive.namespaceId === null) return { scope, namespace: null };
  const [rawNamespace] =
    await query(sql`SELECT namespace_id AS id, journal_event_count::float8 AS "journalEventCount",
    journal_high_water::float8 AS "journalHighWater" FROM workspace_memory_namespace
    WHERE namespace_id=${archive.namespaceId} AND workspace_id=${scope.workspaceId} AND user_id=${scope.userId} FOR UPDATE`);
  if (!rawNamespace) throw new AccountMemoryArchiveUnavailable();
  const namespace = z
    .object({
      id: z.uuid(),
      journalEventCount: z.int().nonnegative().max(Number.MAX_SAFE_INTEGER),
      journalHighWater: z
        .int()
        .positive()
        .max(Number.MAX_SAFE_INTEGER)
        .nullable(),
    })
    .parse(rawNamespace);
  await requireMemoryNamespaceAvailable(namespace.id);
  return { scope, namespace };
}
