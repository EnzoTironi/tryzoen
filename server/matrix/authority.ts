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
