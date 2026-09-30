import type { z } from "zod";
import { query } from "@db/queries";
import { sql } from "drizzle-orm";
import {
  type WorkspaceActorSchema,
  requireWorkspaceAccess,
  WorkspaceAccessDenied,
} from "../workspaces/access";

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

/** The native session and event must both belong to the currently authorized requester. */
export async function matrixSessionActor(eventId: string, sessionId: string) {
  const actor = await matrixDeliveryActor(eventId);
  const rows = await query(
    sql`SELECT event_id FROM matrix_deliveries WHERE event_id = ${eventId} AND session_id = ${sessionId}`
  );
  if (rows.length !== 1) throw new WorkspaceAccessDenied();
  return actor;
}

/** Call inside the transaction that emits the event. The captured room epoch
 * and current audience stay locked through the bounded homeserver request.
 * A committed native departure remains unsafe until its exact state is verified;
 * current workspace/org and agent-member rows also fence recipient revocation.
 */
export async function requireMatrixEgress(eventId: string) {
  const actor = await matrixDeliveryActor(eventId);
  if (!actor.groupBindingId) throw new WorkspaceAccessDenied();
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
