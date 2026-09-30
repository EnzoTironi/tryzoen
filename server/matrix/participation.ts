import { randomUUID } from "node:crypto";
import { sql } from "drizzle-orm";
import type { z } from "zod";
import { query, transaction, SqlError } from "@db/queries";
import type { matrixRoomMembers } from "../../db/schema/matrix";
import { roomParticipationSchema, roomSchema } from "@zoen/companion-ui/rooms";
import {
  requireWorkspaceAccess,
  requireWorkspaceMembership,
  WorkspaceAccessDenied,
  type WorkspaceActorSchema,
} from "../workspaces/access";
import { TimeoutError } from "../operations/async";
import { lockMatrixAdmission } from "./authority";
import { matrixConfiguration, matrixRequest, MatrixError } from "./client";
import {
  matrixIdentityForUser,
  stageMatrixIdentity,
  registerVirtualUser,
} from "./identities";
import {
  readNativeGroupMembership,
  retireMatrixGroupMember,
} from "./membership";
import { requireMatrixRoom, requireJoinedMatrixRoom } from "./rooms";

async function currentHuman(actor: z.output<typeof WorkspaceActorSchema>) {
  const access = await requireWorkspaceAccess(actor);
  if (
    !actor.authSessionId ||
    actor.groupBindingId ||
    actor.protocolTaskId ||
    !access.organizationId
  )
    throw new WorkspaceAccessDenied();
  return access;
}

function membership(bindingId: string, userId: string) {
  return query<
    Pick<typeof matrixRoomMembers.$inferSelect, "state" | "nativePending"> & {
      due: boolean;
      retryAfterMs: number;
    }
  >(sql`SELECT state, native_pending AS "nativePending",
    native_retry_at <= clock_timestamp() AS due,
    greatest(1000, ceil(extract(epoch FROM (native_retry_at - clock_timestamp())) * 1000))::integer AS "retryAfterMs"
    FROM matrix_room_members WHERE binding_id = ${bindingId} AND user_id = ${userId} FOR UPDATE`);
}

async function scheduleRetry(bindingId: string, userId: string) {
  await transaction(
    async () => {
      await lockMatrixAdmission([], [bindingId]);
      await query(sql`UPDATE matrix_room_members SET native_retry_at = now() + interval '1 minute'
      WHERE binding_id = ${bindingId} AND user_id = ${userId} AND state = 'joined' AND native_pending`);
    },
    { outermost: true }
  );
}

/** One committed intent drives both foreground confirmation and scheduled
 * recovery. Only foreground confirmation carries a current human session.
 */
async function completeGroupJoin(
  bindingId: string,
  userId: string,
  actor?: z.output<typeof WorkspaceActorSchema>
) {
  try {
    const outcome = await transaction(
      async () => {
        await lockMatrixAdmission(actor ? [actor.workspaceId] : [], [
          bindingId,
        ]);
        if (actor) await currentHuman(actor);
        const config = await matrixConfiguration();
        const rows = await query<{
          workspaceId: string;
          roomId: string;
          matrixId: string;
          due: boolean;
        }>(sql`SELECT b.workspace_id AS "workspaceId", b.conversation_id AS "roomId",
        i.matrix_id AS "matrixId", m.native_retry_at <= clock_timestamp() AS due
        FROM workspace_group_bindings b
        JOIN matrix_room_members m ON m.binding_id = b.id AND m.user_id = ${userId}
        JOIN matrix_identities i ON i.user_id = m.user_id
        WHERE b.id = ${bindingId} AND b.channel = 'matrix' AND b.installation_id = ${config.serverName}
          AND b.revoked_at IS NULL AND m.state = 'joined' AND m.native_pending
        FOR UPDATE OF b, m FOR SHARE OF i`);
        const row = rows[0];
        if (!row) return "pending" as const;
        if (
          actor &&
          (actor.userId !== userId || actor.workspaceId !== row.workspaceId)
        )
          throw new WorkspaceAccessDenied();
        const identity = matrixIdentityForUser(userId, config.serverName);
        if (row.matrixId !== identity.matrixId)
          throw new WorkspaceAccessDenied();
        try {
          const access = await requireWorkspaceMembership({
            userId,
            workspaceId: row.workspaceId,
          });
          const account = await query(sql`SELECT id FROM public.user
          WHERE ('better-auth:' || id) = ${userId} FOR SHARE`);
          if (!access.organization_id || account.length !== 1)
            throw new WorkspaceAccessDenied();
        } catch (error) {
          if (actor || !(error instanceof WorkspaceAccessDenied)) throw error;
          await query(sql`UPDATE matrix_room_members SET state = 'removed', native_pending = true, native_retry_at = now()
          WHERE binding_id = ${bindingId} AND user_id = ${userId} AND state = 'joined' AND native_pending`);
          await query(
            sql`UPDATE workspace_group_bindings SET epoch = ${randomUUID()} WHERE id = ${bindingId}`
          );
          return "removed" as const;
        }
        if (!row.due) return "pending" as const;
        // SQL staging survives restart; registration must still be attempted.
        await registerVirtualUser(identity.localpart);
        const native = await readNativeGroupMembership(
          row.roomId,
          row.matrixId
        );
        if (native === "ban") throw new MatrixError({ reason: "forbidden" });
        if (native !== "join") {
          await matrixRequest(
            "POST",
            `rooms/${encodeURIComponent(row.roomId)}/invite`,
            { user_id: row.matrixId }
          );
          await matrixRequest(
            "POST",
            `join/${encodeURIComponent(row.roomId)}`,
            {},
            row.matrixId
          );
          if (
            (await readNativeGroupMembership(row.roomId, row.matrixId)) !==
            "join"
          ) {
            await query(sql`UPDATE matrix_room_members SET native_retry_at = now() + interval '1 minute'
            WHERE binding_id = ${bindingId} AND user_id = ${userId} AND state = 'joined' AND native_pending`);
            return "pending" as const;
          }
        }
        await query(sql`UPDATE matrix_room_members SET native_pending = false
        WHERE binding_id = ${bindingId} AND user_id = ${userId} AND state = 'joined' AND native_pending`);
        return "joined" as const;
      },
      { outermost: true }
    );
    if (outcome === "removed") await retireMatrixGroupMember(bindingId, userId);
    return outcome === "joined";
  } catch (error) {
    if (error instanceof MatrixError && error.reason === "forbidden") {
      // Advance native-denied candidates without treating denial as pending.
      await scheduleRetry(bindingId, userId).catch(() => undefined);
      throw error;
    }
    if (
      !(
        error instanceof SqlError ||
        error instanceof TimeoutError ||
        (error instanceof MatrixError && error.reason === "unavailable")
      )
    )
      throw error;
    // An earlier owning commit still contains the receipt if retry scheduling fails.
    await scheduleRetry(bindingId, userId).catch(() => undefined);
    return false;
  }
}

/** Explicit room opening; never call from an existing transaction. The provider
 * cannot observe a receiver before its exact identity, pending intent and epoch
 * have completed their owning database commit.
 */
export async function ensureMatrixParticipation(
  actor: z.output<typeof WorkspaceActorSchema>,
  id: string
): Promise<z.output<typeof roomParticipationSchema>> {
  const prepared = await transaction(
    async () => {
      await lockMatrixAdmission([actor.workspaceId], [id]);
      await currentHuman(actor);
      const room = await requireMatrixRoom(actor, id);
      if (room.kind === "direct") return { joined: true, due: false };
      const config = await matrixConfiguration();
      const binding = await query(sql`SELECT id FROM workspace_group_bindings
      WHERE id = ${id} AND workspace_id = ${actor.workspaceId} AND channel = 'matrix'
        AND installation_id = ${config.serverName} AND revoked_at IS NULL FOR UPDATE`);
      if (binding.length !== 1) throw new WorkspaceAccessDenied();
      await stageMatrixIdentity(actor);
      const current = (await membership(id, actor.userId))[0];
      if (current && current.state !== "joined")
        throw new WorkspaceAccessDenied();
      if (!current) {
        await query(sql`INSERT INTO matrix_room_members(binding_id, user_id, state, native_pending, native_retry_at)
        VALUES (${id}, ${actor.userId}, 'joined', true, now())`);
        await query(
          sql`UPDATE workspace_group_bindings SET epoch = ${randomUUID()} WHERE id = ${id}`
        );
      }
      return {
        joined: current?.nativePending === false,
        due: current?.due ?? true,
      };
    },
    { outermost: true }
  );
  if (!prepared.joined && prepared.due)
    await completeGroupJoin(id, actor.userId, actor);
  return transaction(
    async () => {
      await lockMatrixAdmission([actor.workspaceId], [id]);
      await currentHuman(actor);
      const room = await requireMatrixRoom(actor, id);
      const current =
        room.kind === "group"
          ? (await membership(id, actor.userId))[0]
          : undefined;
      if (
        room.kind === "direct" ||
        (current?.state === "joined" && !current.nativePending)
      ) {
        const joined = await requireJoinedMatrixRoom(actor, id);
        return roomParticipationSchema.parse({
          status: "joined",
          room: roomSchema.parse(joined),
        });
      }
      if (current?.state !== "joined" || !current.nativePending)
        throw new WorkspaceAccessDenied();
      return roomParticipationSchema.parse({
        status: "pending",
        id,
        retryAfterMs: Math.min(30000, Math.max(100, current.retryAfterMs)),
      });
    },
    { outermost: true }
  );
}

/** Scheduled recovery uses the committed intent and current target membership;
 * no captured human session becomes an authorization credential.
 */
export function completeMatrixGroupJoin(
  bindingId: string,
  userId: string
): Promise<boolean> {
  return completeGroupJoin(bindingId, userId);
}

/** Candidate discovery grants no authority. The owning poll supplies its budget
 * and completion reacquires the exact organization, room and target fences.
 */
export async function pendingMatrixGroupJoins(limit: number) {
  if (!Number.isInteger(limit) || limit < 0 || limit > 10)
    throw new RangeError("Expected a join budget from 0 to 10.");
  if (!limit) return [];
  return query<
    Pick<typeof matrixRoomMembers.$inferSelect, "bindingId" | "userId">
  >(
    sql`SELECT binding_id AS "bindingId", user_id AS "userId" FROM matrix_room_members
      WHERE state = 'joined' AND native_pending AND native_retry_at <= clock_timestamp()
      ORDER BY native_retry_at, binding_id, user_id LIMIT ${limit}`
  );
}
