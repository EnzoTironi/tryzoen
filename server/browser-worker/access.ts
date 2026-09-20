import { query } from "@db/queries";
import { sql } from "drizzle-orm";

import type { AccessScope } from "../../shared/identity/access-scope";

export class BrowserWorkerAccessError extends Error {
  readonly _tag = "BrowserWorkerAccessError";
  declare readonly reason:
    | "unauthenticated"
    | "revoked"
    | "paused"
    | "lease_inactive"
    | "unavailable";
  constructor(input: {
    readonly reason:
      | "unauthenticated"
      | "revoked"
      | "paused"
      | "lease_inactive"
      | "unavailable";
  }) {
    super("BrowserWorkerAccessError");
    this.name = "BrowserWorkerAccessError";
    Object.assign(this, input);
  }
}

export const requireBrowserWorkerMembership = async function (
  scope: AccessScope
) {
  const rows = await query(sql`SELECT workspace_id FROM workspace_memberships
    WHERE user_id = ${scope.userId} AND workspace_id = ${scope.workspaceId} FOR SHARE`);
  if (rows.length !== 1)
    throw new BrowserWorkerAccessError({ reason: "unauthenticated" });
  return scope;
};

export const requireBrowserWorkerWebSession = async function (
  scope: AccessScope,
  sessionId: string
) {
  await requireBrowserWorkerMembership(scope);

  const rows = await query(sql`SELECT id FROM public.session
    WHERE id = ${sessionId} AND ('better-auth:' || "userId") = ${scope.userId}
      AND "expiresAt" > clock_timestamp() FOR SHARE`);
  if (rows.length !== 1)
    throw new BrowserWorkerAccessError({ reason: "unauthenticated" });
  return scope;
};

export const requireBrowserWorkerChannelIdentity = async function (
  scope: AccessScope,
  identityId: string
) {
  await requireBrowserWorkerMembership(scope);

  const rows = await query(sql`SELECT id FROM channel_identity
    WHERE id = ${identityId} AND revoked_at IS NULL
      AND ('better-auth:' || user_id) = ${scope.userId} FOR SHARE`);
  if (rows.length !== 1)
    throw new BrowserWorkerAccessError({ reason: "revoked" });
  return scope;
};

export const requireBrowserWorkerLease = async function (
  scope: AccessScope,
  runId: string,
  leaseToken: string
) {
  await requireBrowserWorkerMembership(scope);

  const rows = await query(sql`SELECT r.id FROM scheduled_agent_runs r
    JOIN scheduled_agent_jobs j ON j.id = r.job_id
    WHERE r.id = ${runId} AND r.status = 'running'
      AND j.workspace_id = ${scope.workspaceId} AND j.created_by_user_id = ${scope.userId}
      AND r.lease_token = ${leaseToken}
      AND r.lease_expires_at > clock_timestamp() FOR SHARE`);
  if (rows.length !== 1)
    throw new BrowserWorkerAccessError({ reason: "lease_inactive" });
  return scope;
};

export const requireBrowserWorkerScheduleActive = async function (
  scope: AccessScope,
  scheduleId: string
) {
  await requireBrowserWorkerMembership(scope);

  const rows = await query(sql`SELECT id FROM scheduled_agent_jobs
    WHERE id = ${scheduleId}
      AND workspace_id = ${scope.workspaceId}
      AND created_by_user_id = ${scope.userId}
      AND (status = 'active' OR (status = 'completed' AND EXISTS (
        SELECT 1 FROM scheduled_agent_runs r WHERE r.job_id = scheduled_agent_jobs.id
          AND r.status = 'running' AND r.lease_expires_at > clock_timestamp()
      ))) FOR SHARE`);
  if (rows.length !== 1)
    throw new BrowserWorkerAccessError({ reason: "paused" });
  return scope;
};
