import { query, transaction } from "@db/queries";
import { sql } from "drizzle-orm";
import { z } from "zod";
import {
  requireWorkspaceAccess,
  WorkspaceAccessDenied,
  type WorkspaceActorSchema,
} from "./access";

/** Fence app access and durable tasks before the existing Matrix reconciler performs native I/O. */
export async function revokeExternalAgentMember(
  actor: z.output<typeof WorkspaceActorSchema>,
  id: string
) {
  const memberId = z.uuid().parse(id);
  return transaction(async () => {
    await requireWorkspaceAccess(actor, true);
    if (!actor.authSessionId) throw new WorkspaceAccessDenied();
    const members =
      await query(sql`UPDATE workspace_agent_members SET revoked_at = COALESCE(revoked_at, clock_timestamp())
      WHERE id = ${memberId} AND workspace_id = ${actor.workspaceId} RETURNING id`);
    if (members.length !== 1) throw new WorkspaceAccessDenied();
    // The existing grant-revocation trigger cancels tasks without losing native cancellation receipts.
    await query(sql`UPDATE workspace_agent_grants SET revoked_at = clock_timestamp()
      WHERE external_member_id = ${memberId} AND revoked_at IS NULL`);
    await query(sql`WITH retired AS (
      UPDATE matrix_room_members m
        SET state = 'removed', native_pending = true, native_retry_at = now()
        FROM workspace_group_bindings b WHERE m.binding_id = b.id AND b.workspace_id = ${actor.workspaceId}
          AND m.user_id = ${"agent:" + memberId} AND m.state = 'joined' RETURNING m.binding_id
    ) UPDATE workspace_group_bindings SET epoch = gen_random_uuid()
      WHERE id IN (SELECT binding_id FROM retired)`);
    return { revoked: true };
  });
}
