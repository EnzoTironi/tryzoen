import { randomUUID } from "node:crypto";
import { sql } from "drizzle-orm";
import { z } from "zod";
import { query, transaction, TransactionBoundaryError } from "@db/queries";
import {
  operationDeadline,
  operationSignal,
  TimeoutError,
  withDeadline,
} from "../operations/async";
import {
  validateMatrixDeadline,
  validateMatrixLimit,
  withMatrixTransaction,
} from "./deadline";
import { roomMembershipChangeSchema } from "@zoen/companion-ui/rooms";
import {
  requireWorkspaceAccess,
  WorkspaceAccessDenied,
  type WorkspaceActorSchema,
} from "../workspaces/access";
import { matrixConfiguration, matrixRequest, MatrixError } from "./client";
import { ensureMatrixIdentity } from "./identities";
import { lockMatrixAdmission } from "./authority";

/** Exact current state, never a potentially delayed membership callback. */
export async function readNativeGroupMembership(
  roomId: string,
  matrixId: string
) {
  operationSignal().throwIfAborted();
  try {
    const response = await matrixRequest(
      "GET",
      `rooms/${encodeURIComponent(roomId)}/state/m.room.member/${encodeURIComponent(matrixId)}`,
      undefined,
      undefined,
      { maxResponseBytes: 8192 }
    );
    operationSignal().throwIfAborted();
    return z
      .object({
        membership: z.enum(["join", "invite", "leave", "ban", "knock"]),
      })
      .parse(response).membership;
  } catch (error) {
    if (error instanceof MatrixError && error.reason === "not-found") {
      operationSignal().throwIfAborted();
      return null;
    }
    throw error;
  }
}

export async function changeMatrixGroupMembership(
  actor: z.infer<typeof WorkspaceActorSchema>,
  raw: z.infer<typeof roomMembershipChangeSchema>
) {
  const input = roomMembershipChangeSchema.parse(raw);
  const target = await transaction(async () => {
    await lockMatrixAdmission([actor.workspaceId], [input.id]);
    const { binding, person } = await groupMembershipTarget(actor, input);
    const matrixId = await ensureMatrixIdentity(person);
    const current = await query<{
      state: string;
      native_pending: boolean;
    }>(sql`SELECT state, native_pending FROM matrix_room_members
      WHERE binding_id = ${input.id} AND user_id = ${person.userId}`);
    if (input.action === "add") {
      await joinNativeGroup(binding.roomId, matrixId);
      if (current[0]?.state === "joined") return person.userId;
      await query(sql`INSERT INTO matrix_room_members(binding_id, user_id) VALUES (${input.id}, ${person.userId})
        ON CONFLICT (binding_id, user_id) DO UPDATE SET state = 'joined', native_pending = false, joined_at = now()`);
    } else {
      // Revocation is committed before native I/O. Retain the row so reads cannot auto-join again.
      const state =
        input.action === "remove" || current[0]?.state === "removed"
          ? "removed"
          : "left";
      if (current[0]?.state === state && !current[0].native_pending)
        return person.userId;
      await query(sql`INSERT INTO matrix_room_members(binding_id, user_id, state, native_pending)
        VALUES (${input.id}, ${person.userId}, ${state}, true)
        ON CONFLICT (binding_id, user_id) DO UPDATE SET state = EXCLUDED.state, native_pending = true, native_retry_at = now()`);
    }
    await query(
      sql`UPDATE workspace_group_bindings SET epoch = ${randomUUID()} WHERE id = ${input.id}`
    );
    return person.userId;
  });
  if (input.action === "add") return { nativePending: false };
  return { nativePending: !(await retireMatrixGroupMember(input.id, target)) };
}

async function groupMembershipTarget(
  actor: z.infer<typeof WorkspaceActorSchema>,
  input: z.infer<typeof roomMembershipChangeSchema>
) {
  const access = await requireWorkspaceAccess(actor, input.action !== "leave");
  if (!actor.authSessionId || !access.organizationId)
    throw new WorkspaceAccessDenied();
  const config = await matrixConfiguration();
  const bindings = await query<{
    roomId: string;
  }>(sql`SELECT conversation_id AS "roomId" FROM workspace_group_bindings
      WHERE id = ${input.id} AND workspace_id = ${actor.workspaceId} AND channel = 'matrix'
        AND installation_id = ${config.serverName} AND revoked_at IS NULL FOR UPDATE`);
  const binding = bindings[0];
  if (!binding) throw new WorkspaceAccessDenied();
  const people = await query<{
    userId: string;
    role: string;
  }>(sql`SELECT w.user_id AS "userId", w.role
      FROM workspace_memberships w
      JOIN organization_memberships o ON o.organization_id = ${access.organizationId} AND o.user_id = w.user_id
      LEFT JOIN user_directory d ON ('better-auth:' || d.user_id) = w.user_id
      WHERE w.workspace_id = ${actor.workspaceId}
        AND ${input.action === "leave" ? sql`w.user_id = ${actor.userId}` : sql`d.username = ${input.username}`}
      FOR SHARE OF w, o`);
  const person = people[0];
  if (
    !person ||
    (input.action === "remove" &&
      (person.userId === actor.userId || person.role !== "member"))
  )
    throw new WorkspaceAccessDenied();
  return { binding, person };
}

/** A single exact-state contract for initial joins and explicit additions. */
export async function joinNativeGroup(roomId: string, matrixId: string) {
  const native = await readNativeGroupMembership(roomId, matrixId);
  if (native === "join") return;
  if (native === "ban") throw new MatrixError({ reason: "conflict" });
  operationSignal().throwIfAborted();
  await matrixRequest("POST", `rooms/${encodeURIComponent(roomId)}/invite`, {
    user_id: matrixId,
  });
  operationSignal().throwIfAborted();
  await matrixRequest(
    "POST",
    `join/${encodeURIComponent(roomId)}`,
    {},
    matrixId
  );
  if ((await readNativeGroupMembership(roomId, matrixId)) !== "join")
    throw new MatrixError({ reason: "conflict" });
}

/** Clear the committed departure receipt only after exact native absence. */
export async function retireMatrixGroupMember(
  bindingId: string,
  userId: string
) {
  const deadlineMs = operationDeadline();
  const retire = async () => {
    operationSignal().throwIfAborted();
    await lockMatrixAdmission([], [bindingId]);
    operationSignal().throwIfAborted();
    const config = await matrixConfiguration();
    operationSignal().throwIfAborted();
    const rows = await query<{
      roomId: string;
      matrixId: string;
      state: string;
    }>(sql`SELECT b.conversation_id AS "roomId", i.matrix_id AS "matrixId", m.state
      FROM matrix_room_members m JOIN workspace_group_bindings b ON b.id = m.binding_id
      JOIN matrix_identities i ON i.user_id = m.user_id
      WHERE m.binding_id = ${bindingId} AND m.user_id = ${userId} AND m.native_pending
        AND m.state <> 'joined' AND m.native_retry_at <= now() AND b.installation_id = ${config.serverName} AND b.channel = 'matrix' FOR UPDATE OF b, m`);
    operationSignal().throwIfAborted();
    const row = rows[0];
    if (!row) return true;
    const native = await readNativeGroupMembership(row.roomId, row.matrixId);
    operationSignal().throwIfAborted();
    if (native === "join" || native === "invite" || native === "knock") {
      await matrixRequest(
        "POST",
        `rooms/${encodeURIComponent(row.roomId)}/${row.state === "left" ? "leave" : "kick"}`,
        row.state === "left"
          ? {}
          : { user_id: row.matrixId, reason: "Removed from group" },
        row.state === "left" ? row.matrixId : undefined
      );
      operationSignal().throwIfAborted();
    }
    const verified = await readNativeGroupMembership(row.roomId, row.matrixId);
    operationSignal().throwIfAborted();
    if (verified && verified !== "leave" && verified !== "ban")
      throw new MatrixError({ reason: "conflict" });
    await query(
      sql`UPDATE matrix_room_members SET native_pending = false WHERE binding_id = ${bindingId} AND user_id = ${userId}`
    );
    operationSignal().throwIfAborted();
    return true;
  };
  try {
    return await (deadlineMs === undefined
      ? transaction(retire)
      : withMatrixTransaction(deadlineMs, retire));
  } catch (error) {
    if (
      error instanceof TransactionBoundaryError ||
      error instanceof WorkspaceAccessDenied ||
      error instanceof RangeError
    )
      throw error;
    operationSignal().throwIfAborted();
    // The committed receipt withholds access. Schedule retries only while the
    // same inherited budget remains active; never replace it with a new window.
    const retry = async () => {
      operationSignal().throwIfAborted();
      await lockMatrixAdmission([], [bindingId]);
      operationSignal().throwIfAborted();
      await query(sql`UPDATE matrix_room_members SET native_retry_at = now() + interval '1 minute'
        WHERE binding_id = ${bindingId} AND user_id = ${userId} AND native_pending AND state <> 'joined'`);
      operationSignal().throwIfAborted();
    };
    try {
      await (deadlineMs === undefined
        ? transaction(retry)
        : withMatrixTransaction(deadlineMs, retry));
    } catch (retryError) {
      if (
        retryError instanceof TransactionBoundaryError ||
        retryError instanceof WorkspaceAccessDenied ||
        retryError instanceof RangeError
      )
        throw retryError;
      operationSignal().throwIfAborted();
    }
    console.warn("Group membership retirement remains pending");
    return false;
  }
}

export async function reconcileGroupDepartures(
  deadlineMs: number,
  limit: number
): Promise<number> {
  validateMatrixDeadline(deadlineMs);
  validateMatrixLimit(limit, 10);
  operationSignal().throwIfAborted();
  if (limit === 0 || Date.now() >= deadlineMs) return 0;
  let attempted = 0;
  try {
    return await withDeadline(async () => {
      const rows = await withMatrixTransaction(deadlineMs, async () => {
        operationSignal().throwIfAborted();
        const candidates =
          await query(sql`SELECT binding_id AS "bindingId", user_id AS "userId"
          FROM matrix_room_members WHERE native_pending AND state <> 'joined' AND native_retry_at <= now()
          ORDER BY native_retry_at, binding_id, user_id LIMIT ${limit}`);
        operationSignal().throwIfAborted();
        return z
          .array(z.object({ bindingId: z.string(), userId: z.string() }))
          .max(limit)
          .parse(candidates);
      });
      for (const row of rows) {
        operationSignal().throwIfAborted();
        attempted++;
        await retireMatrixGroupMember(row.bindingId, row.userId);
        operationSignal().throwIfAborted();
      }
      return attempted;
    }, deadlineMs);
  } catch (error) {
    if (error instanceof TimeoutError) {
      operationSignal().throwIfAborted();
      if (Date.now() >= deadlineMs) return attempted;
    }
    throw error;
  }
}
