import { z } from "zod";
import { query } from "@db/queries";
import { sql } from "drizzle-orm";
import {
  type WorkspaceActorSchema,
  requireWorkspaceAccess,
  WorkspaceAccessDenied,
} from "../workspaces/access";

/** Acquire the complete organization set before member or room locks. Call
 * inside the protected transaction. These fences grant no access themselves.
 */
export async function lockMatrixOrganizations(
  ids: readonly string[],
  mode: "share" | "update" = "share"
) {
  for (const id of [...new Set(ids)].toSorted()) {
    const rows = await query(sql`SELECT id FROM organizations WHERE id = ${id}
      ${mode === "update" ? sql`FOR UPDATE` : sql`FOR SHARE`}`);
    if (rows.length !== 1) throw new WorkspaceAccessDenied();
  }
}

/** Acquire the complete room set before the first authority read. */
export async function lockMatrixRoomFences(ids: readonly string[]) {
  for (const id of [...new Set(ids)].toSorted())
    await query(sql`SELECT pg_advisory_xact_lock(hashtextextended(${id}, 5))`);
}

/** Locators discover a fence set without granting authority. Revalidate the
 * exact workspace/organization mapping before taking any membership locks.
 * Existing personal workspaces retain their own authentication rules.
 */
export async function lockMatrixAdmission(
  workspaceIds: readonly string[],
  bindingIds: readonly string[],
  mode: "share" | "update" = "share"
) {
  const workspaces = [...new Set(workspaceIds)].toSorted();
  const bindings = [...new Set(bindingIds)].toSorted();
  const locate = () =>
    query<{ workspaceId: string; organizationId: string | null }>(sql`
    SELECT w.id AS "workspaceId", w.organization_id AS "organizationId" FROM workspaces w
    WHERE ${
      workspaces.length
        ? sql`w.id IN (${sql.join(
            workspaces.map((id) => sql`${id}`),
            sql`, `
          )})`
        : sql`false`
    }
      OR ${
        bindings.length
          ? sql`w.id IN (SELECT workspace_id FROM workspace_group_bindings
        WHERE id IN (${sql.join(
          bindings.map((id) => sql`${id}`),
          sql`, `
        )}))`
          : sql`false`
      }
    ORDER BY w.id`);
  const before = await locate();
  if (workspaces.some((id) => !before.some((row) => row.workspaceId === id)))
    throw new WorkspaceAccessDenied();
  await lockMatrixOrganizations(
    before.flatMap((row) => (row.organizationId ? [row.organizationId] : [])),
    mode
  );
  await lockMatrixRoomFences(bindings);
  const after = await locate();
  if (JSON.stringify(before) !== JSON.stringify(after))
    throw new WorkspaceAccessDenied();
}

/** An event is authorized by its sender, current room epoch and live workspace membership. */
export const matrixDeliveryActor = async function (eventId: string) {
  const rows = await query<{
    userId: string;
    workspaceId: string;
    matrixIdentityId: string;
    groupBindingId: string;
    groupEpoch: string;
  }>(sql`SELECT d.user_id AS "userId", b.workspace_id AS "workspaceId", i.matrix_id AS "matrixIdentityId",
    b.id AS "groupBindingId", d.epoch AS "groupEpoch"
    FROM matrix_deliveries d JOIN workspace_group_bindings b ON b.id = d.binding_id
    JOIN matrix_identities i ON i.user_id = d.user_id
    WHERE d.event_id = ${eventId} AND d.state IN ('pending', 'dispatched', 'answer_ready')`);
  if (!rows[0]) throw new WorkspaceAccessDenied();
  await lockMatrixAdmission([rows[0].workspaceId], [rows[0].groupBindingId]);
  return await requireWorkspaceAccess(rows[0]);
};

export function matrixPrincipal(actor: z.output<typeof WorkspaceActorSchema>) {
  return {
    authenticator: "matrix",
    principalType: "user" as const,
    principalId: actor.userId,
    attributes: {
      workspaceId: actor.workspaceId,
      workspaceKind: "company",
      matrixIdentityId: actor.matrixIdentityId ?? "",
      groupBindingId: actor.groupBindingId ?? "",
      groupEpoch: actor.groupEpoch ?? "",
      conversationChannel: "matrix",
    },
  };
}

/** Eve's durable consumption receipt identifies the exact native session.
 * A NULL delivery session never authorizes a callback by itself. Hold the
 * delivery row through publication and recheck the receipt before every send.
 */
export async function matrixSessionActor(eventId: string, sessionId: string) {
  if (!z.string().min(1).safeParse(sessionId).success)
    throw new WorkspaceAccessDenied();
  const actor = await matrixDeliveryActor(eventId);
  const rows =
    await query(sql`UPDATE matrix_deliveries d SET session_id = ${sessionId}
    WHERE d.event_id = ${eventId} AND d.state IN ('pending', 'dispatched', 'answer_ready')
      AND (d.session_id IS NULL OR d.session_id = ${sessionId})
      AND EXISTS (SELECT 1 FROM native_delivery_receipts r
        WHERE r.workspace_id = ${actor.workspaceId} AND r.input_id = d.event_id
          AND r.session_id = ${sessionId}) RETURNING d.event_id`);
  if (rows.length !== 1) throw new WorkspaceAccessDenied();
  return actor;
}

/** Native output requires an exact stored session receipt, without a bypass. */
export async function requireMatrixEgress(eventId: string, sessionId: string) {
  return requireSafeMatrixAudience(
    await matrixSessionActor(eventId, sessionId)
  );
}

/** Only the fixed pre-session input diagnostics use this path. They must have
 * neither a native session nor a native consumption receipt. This function
 * does not admit native output and remains subject to the same audience gate.
 */
export async function requireMatrixInputNoticeEgress(eventId: string) {
  const actor = await matrixDeliveryActor(eventId);
  const rows = await query(sql`SELECT d.event_id FROM matrix_deliveries d
    WHERE d.event_id = ${eventId} AND d.session_id IS NULL
      AND NOT EXISTS (SELECT 1 FROM native_delivery_receipts r
        WHERE r.workspace_id = ${actor.workspaceId} AND r.input_id = d.event_id)
    FOR UPDATE OF d`);
  if (rows.length !== 1) throw new WorkspaceAccessDenied();
  return requireSafeMatrixAudience(actor);
}

/** Call inside the transaction that emits the event. The captured room epoch
 * and current audience stay locked through the bounded homeserver request.
 * A committed native departure remains unsafe until its exact state is verified;
 * current workspace/org and agent-member rows also fence recipient revocation.
 */
async function requireSafeMatrixAudience(
  actor: Awaited<ReturnType<typeof matrixDeliveryActor>>
) {
  if (!actor.groupBindingId) throw new WorkspaceAccessDenied();
  // Identity deletion must not erase the uncertain native audience marker.
  // Capture/reconciliation use the same organization and room admission fences.
  const erased = await query(sql`SELECT 1 FROM matrix_erasure_departures
    WHERE binding_id = ${actor.groupBindingId} LIMIT 1`);
  if (erased.length) throw new WorkspaceAccessDenied();
  const unsafe = await query(sql`
    WITH audience AS MATERIALIZED (
      SELECT m.user_id, m.state, m.native_pending FROM matrix_room_members m
      WHERE m.binding_id = ${actor.groupBindingId} FOR SHARE OF m
    ), human_access AS MATERIALIZED (
      SELECT w.user_id FROM workspace_memberships w
      JOIN audience a ON a.user_id = w.user_id AND a.state = 'joined'
      JOIN organization_memberships o ON o.user_id = w.user_id
        AND o.organization_id = ${actor.organizationId}
      WHERE w.workspace_id = ${actor.workspaceId} FOR SHARE OF w, o
    ), agent_access AS MATERIALIZED (
      SELECT ('agent:' || m.id) AS user_id FROM workspace_agent_members m
      JOIN audience a ON a.user_id = ('agent:' || m.id) AND a.state = 'joined'
      WHERE m.workspace_id = ${actor.workspaceId} AND m.revoked_at IS NULL FOR SHARE OF m
    ) SELECT a.user_id FROM audience a WHERE a.native_pending
      OR (a.state = 'joined'
        AND NOT EXISTS (SELECT 1 FROM human_access h WHERE h.user_id = a.user_id)
        AND NOT EXISTS (SELECT 1 FROM agent_access g WHERE g.user_id = a.user_id))
      LIMIT 1`);
  if (unsafe.length) throw new WorkspaceAccessDenied();
  return actor;
}
