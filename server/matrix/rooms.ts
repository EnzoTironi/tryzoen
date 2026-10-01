import { joinNativeGroup, retireMatrixGroupMember } from "./membership";
import { lockMatrixAdmission } from "./authority";
import {
  operationSignal,
  TimeoutError,
  withDeadline,
} from "../operations/async";
import {
  validateMatrixDeadline,
  validateMatrixLimit,
  withMatrixTransaction,
} from "./deadline";
import { readRoomMembers } from "./members";
import { findDirectRoom } from "./direct";
import { query, transaction as withDatabaseTransaction } from "@db/queries";
import { sql } from "drizzle-orm";
import { z } from "zod";
import { randomUUID } from "node:crypto";
import { roomSchema, type roomCreateSchema } from "@zoen/companion-ui/rooms";
import { projectMatrixMessage, readRoomMessage } from "./messages";

import {
  requireWorkspaceAccess,
  WorkspaceAccessDenied,
  type WorkspaceActorSchema,
} from "../workspaces/access";
import {
  matrixConfiguration,
  matrixRequest,
  MatrixError,
  MatrixEventSchema,
} from "./client";

import { ensureMatrixIdentity, registerVirtualUser } from "./identities";

const roomResult = z.object({ room_id: z.string() });
export const requireMatrixRoom = async function (
  actor: z.output<typeof WorkspaceActorSchema>,
  id: string,
  manage = false
) {
  return await withDatabaseTransaction(async () => {
    await lockMatrixAdmission([actor.workspaceId], [id]);
    const access = await requireWorkspaceAccess(actor, manage);
    if (!actor.authSessionId || !access.organizationId)
      throw new WorkspaceAccessDenied();
    if (!manage) {
      const direct = await findDirectRoom(actor, id);
      if (direct) return direct;
    }
    const config = await matrixConfiguration();

    const rows =
      await query(sql`SELECT id, workspace_id AS "workspaceId", conversation_id AS "roomId", label, epoch, avatar_uri AS "avatarUri", avatar_revision AS "avatarRevision", 'group' AS kind FROM workspace_group_bindings
    WHERE id = ${id} AND workspace_id = ${actor.workspaceId} AND channel = 'matrix'
      AND installation_id = ${config.serverName} AND revoked_at IS NULL
      ${manage ? sql`` : sql`AND NOT EXISTS (SELECT 1 FROM matrix_room_members m WHERE m.binding_id = workspace_group_bindings.id AND m.user_id = ${actor.userId} AND m.state <> 'joined')`} FOR SHARE`);
    if (rows.length !== 1) throw new WorkspaceAccessDenied();
    return await roomSchema.parseAsync(rows[0]);
  });
};

/** Confirmed human membership only. Call inside the protected read/write
 * transaction so current authority and the exact room/identity remain locked.
 * Admission never registers an identity or adds a native receiver.
 */
export const requireJoinedMatrixRoom = async function (
  actor: z.output<typeof WorkspaceActorSchema>,
  id: string
) {
  return await withDatabaseTransaction(async () => {
    await lockMatrixAdmission([actor.workspaceId], [id]);
    const access = await requireWorkspaceAccess(actor);
    if (
      !actor.authSessionId ||
      actor.groupBindingId ||
      actor.protocolTaskId ||
      !access.organizationId
    )
      throw new WorkspaceAccessDenied();
    const direct = await findDirectRoom(actor, id);
    const config = await matrixConfiguration();
    const rows = direct
      ? await query(sql`SELECT matrix_id AS "matrixId" FROM matrix_identities
          WHERE user_id = ${actor.userId} FOR SHARE`)
      : await query(sql`SELECT b.id, b.workspace_id AS "workspaceId", b.conversation_id AS "roomId", b.label,
          b.epoch, b.avatar_uri AS "avatarUri", b.avatar_revision AS "avatarRevision", 'group' AS kind,
          i.matrix_id AS "matrixId" FROM workspace_group_bindings b
          JOIN matrix_room_members m ON m.binding_id = b.id AND m.user_id = ${actor.userId}
            AND m.state = 'joined' AND NOT m.native_pending
          JOIN matrix_identities i ON i.user_id = m.user_id
          WHERE b.id = ${id} AND b.workspace_id = ${actor.workspaceId} AND b.channel = 'matrix'
            AND b.installation_id = ${config.serverName} AND b.revoked_at IS NULL
          FOR SHARE OF b, m, i`);
    const identity = z.string().safeParse(rows[0]?.matrixId);
    if (
      rows.length !== 1 ||
      !identity.success ||
      /^@[^:\s]+:([^\s]+)$/u.exec(identity.data)?.[1] !== config.serverName
    )
      throw new WorkspaceAccessDenied();
    return {
      ...(direct ?? (await roomSchema.parseAsync(rows[0]))),
      matrixId: identity.data,
    };
  });
};

export const listMatrixRooms = async function (
  actor: z.output<typeof WorkspaceActorSchema>
) {
  return await withDatabaseTransaction(async () => {
    await lockMatrixAdmission([actor.workspaceId], []);
    const access = await requireWorkspaceAccess(actor);
    const configured = await Promise.try(async () => {
      await matrixConfiguration();
      return true;
    }).catch((error: unknown) => {
      if (error instanceof MatrixError) return Promise.resolve(false);
      throw error;
    });

    const rows =
      await query(sql`SELECT id, workspace_id AS "workspaceId", conversation_id AS "roomId", label, epoch, avatar_uri AS "avatarUri", avatar_revision AS "avatarRevision", 'group' AS kind FROM workspace_group_bindings
    WHERE workspace_id = ${actor.workspaceId} AND channel = 'matrix' AND revoked_at IS NULL AND NOT EXISTS (SELECT 1 FROM matrix_room_members m WHERE m.binding_id = workspace_group_bindings.id AND m.user_id = ${actor.userId} AND m.state <> 'joined') ORDER BY created_at LIMIT 20`);
    return {
      configured,
      mayManage: !!access.organizationId && access.role !== "member",
      rooms: await z.array(roomSchema).parseAsync(rows),
    };
  });
};

export const createMatrixRoom = async function (
  actor: z.output<typeof WorkspaceActorSchema>,
  input: z.output<typeof roomCreateSchema>
) {
  return await withDatabaseTransaction(async () => {
    await lockMatrixAdmission([actor.workspaceId], [input.operationId]);
    await query(
      sql`SELECT pg_advisory_xact_lock(hashtextextended(${actor.workspaceId}, 4))`
    );
    const access = await requireWorkspaceAccess(actor, true);
    if (!actor.authSessionId || !access.organizationId)
      throw new WorkspaceAccessDenied();
    const config = await matrixConfiguration();
    const existing = await query(
      sql`SELECT id FROM workspace_group_bindings WHERE id = ${input.operationId}`
    );
    if (existing.length)
      return await requireMatrixRoom(actor, input.operationId);
    const rooms = await query(
      sql`SELECT id FROM workspace_group_bindings WHERE workspace_id = ${actor.workspaceId} AND revoked_at IS NULL`
    );
    if (rooms.length >= 20) throw new MatrixError({ reason: "conflict" });
    await registerVirtualUser("_zoen_bot");
    const alias = `_zoen_room_${input.operationId}`;
    const response = await Promise.try(async () =>
      matrixRequest("POST", "createRoom", {
        name: input.name,
        room_alias_name: alias,
        preset: "private_chat",
        visibility: "private",
        creation_content: { "m.federate": false },
        initial_state: [
          {
            type: "m.room.history_visibility",
            state_key: "",
            content: { history_visibility: "joined" },
          },
        ],
        power_level_content_override: {
          users_default: 0,
          invite: 100,
          kick: 100,
          ban: 100,
          state_default: 100,
        },
      })
    ).catch((error: unknown) => {
      if (error instanceof MatrixError)
        return error.reason === "conflict"
          ? matrixRequest(
              "GET",
              `directory/room/${encodeURIComponent(`#${alias}:${config.serverName}`)}`
            )
          : Promise.reject(error);
      throw error;
    });
    const room = await roomResult.parseAsync(response);
    await query(sql`INSERT INTO workspace_group_bindings(id, workspace_id, channel, installation_id, conversation_id, label, created_by)
      VALUES (${input.operationId}, ${actor.workspaceId}, 'matrix', ${config.serverName}, ${room.room_id}, ${input.name}, ${actor.userId})`);
    return await requireMatrixRoom(actor, input.operationId);
  });
};

/** Access is checked again before every read/send. Virtual users receive no bearer tokens. */
export const joinMatrixRoom = async function (
  actor: z.output<typeof WorkspaceActorSchema>,
  id: string
) {
  return await withDatabaseTransaction(async () => {
    await lockMatrixAdmission([actor.workspaceId], [id]);
    const room = await requireMatrixRoom(actor, id);
    if (room.kind === "group") {
      // A new receiver must conflict with an in-flight output's binding lock
      // before identity registration or native join makes that receiver visible.
      const binding = await query(sql`SELECT id FROM workspace_group_bindings
        WHERE id = ${id} AND workspace_id = ${actor.workspaceId} AND channel = 'matrix'
          AND revoked_at IS NULL FOR UPDATE`);
      if (binding.length !== 1) throw new WorkspaceAccessDenied();
    }
    const matrixId = await ensureMatrixIdentity(actor);
    if (room.kind === "direct") return { ...room, matrixId };
    const members = await query(
      sql`SELECT user_id FROM matrix_room_members WHERE binding_id = ${id} AND user_id = ${actor.userId}`
    );
    if (!members.length) {
      await joinNativeGroup(room.roomId, matrixId);
      await query(
        sql`INSERT INTO matrix_room_members(binding_id, user_id) VALUES (${id}, ${actor.userId}) ON CONFLICT DO NOTHING`
      );
      await query(
        sql`UPDATE workspace_group_bindings SET epoch = ${randomUUID()} WHERE id = ${id}`
      );
    }
    return { ...(await requireMatrixRoom(actor, id)), matrixId };
  });
};

export const readMatrixMessages = async function (
  actor: z.output<typeof WorkspaceActorSchema>,
  id: string,
  from?: string,
  rootId?: string
) {
  return await withDatabaseTransaction(async () => {
    const room = await joinMatrixRoom(actor, id);
    await requireWorkspaceAccess(actor);
    const base = `rooms/${encodeURIComponent(room.roomId)}`;
    const parent = rootId
      ? await readRoomMessage(room, rootId, true)
      : undefined;
    if (parent?.content["m.relates_to"]?.rel_type === "m.thread")
      throw new WorkspaceAccessDenied();
    const endpoint = rootId
      ? `${base}/relations/${encodeURIComponent(rootId)}/m.thread/m.room.message?dir=b&limit=100`
      : `${base}/messages?dir=b&limit=100&filter=${encodeURIComponent(JSON.stringify({ types: ["m.room.message", "m.reaction"] }))}`;
    const response = await matrixRequest(
      "GET",
      endpoint + (from ? `&from=${encodeURIComponent(from)}` : ""),
      undefined,
      room.matrixId,
      { version: rootId ? "v1" : "v3" }
    );
    const events = await z
      .object({
        chunk: z.array(MatrixEventSchema).max(100),
        end: z.string().optional(),
        next_batch: z.string().optional(),
      })
      .parseAsync(response);
    const members = await readRoomMembers(actor, id, room.kind);
    await requireMatrixRoom(actor, id);
    const config = await matrixConfiguration();
    const project = (event: z.infer<typeof MatrixEventSchema>) =>
      projectMatrixMessage(event, members, room.matrixId, config.botId);
    return {
      room,
      members:
        room.kind === "direct"
          ? members
          : [
              ...members.slice(0, 99),
              {
                id: config.botId,
                name: "Zoen",
                username: "zoen",
                mine: false,
                bot: true,
              },
            ],
      membersTruncated: members.length > 99,
      nextCursor: (rootId ? events.next_batch : events.end) ?? null,
      messages: events.chunk
        .filter(
          (event) =>
            event.type === "m.room.message" &&
            event.content["m.relates_to"]?.rel_type !== "m.replace"
        )
        .toReversed()
        .map(project),
      ...(parent ? { parent: project(parent) } : {}),
    };
  });
};

export const closeMatrixRoom = async function (
  actor: z.output<typeof WorkspaceActorSchema>,
  id: string
) {
  return await withDatabaseTransaction(async () => {
    await lockMatrixAdmission([actor.workspaceId], [id]);
    await requireMatrixRoom(actor, id, true);
    await query(
      sql`UPDATE workspace_group_bindings SET revoked_at = now(), epoch = ${randomUUID()} WHERE id = ${id} AND workspace_id = ${actor.workspaceId}`
    );
    return { closed: true };
  });
};

/** Mirror live workspace revocation into Matrix; failed kicks remain retryable. */
export const reconcileMatrixRooms = async function (
  deadlineMs: number,
  limit: number
): Promise<number> {
  validateMatrixDeadline(deadlineMs);
  validateMatrixLimit(limit, 5);
  operationSignal().throwIfAborted();
  if (limit === 0 || Date.now() >= deadlineMs) return 0;
  let attempted = 0;
  try {
    return await withDeadline(async () => {
      const { config, stale } = await withMatrixTransaction(
        deadlineMs,
        async () => {
          operationSignal().throwIfAborted();
          const configuration = await matrixConfiguration();
          operationSignal().throwIfAborted();
          const candidates = await query(sql`
          SELECT m.binding_id AS "bindingId", m.user_id AS "userId"
          FROM matrix_room_members m JOIN workspace_group_bindings b ON b.id = m.binding_id
          WHERE b.channel = 'matrix' AND b.installation_id = ${configuration.serverName} AND m.state = 'joined' AND (b.revoked_at IS NOT NULL OR NOT EXISTS (
            SELECT 1 FROM workspace_memberships w JOIN workspaces s ON s.id = w.workspace_id
            JOIN organization_memberships o ON o.organization_id = s.organization_id AND o.user_id = w.user_id
            WHERE w.workspace_id = b.workspace_id AND w.user_id = m.user_id
          ) AND NOT EXISTS (
            SELECT 1 FROM workspace_agent_members a WHERE a.workspace_id = b.workspace_id
              AND ('agent:' || a.id) = m.user_id AND a.revoked_at IS NULL
          )) ORDER BY m.binding_id, m.user_id LIMIT ${limit}`);
          operationSignal().throwIfAborted();
          return {
            config: configuration,
            stale: z
              .array(z.object({ bindingId: z.string(), userId: z.string() }))
              .max(limit)
              .parse(candidates),
          };
        }
      );
      for (const member of stale) {
        operationSignal().throwIfAborted();
        attempted++;
        const pending = await withMatrixTransaction(deadlineMs, async () => {
          operationSignal().throwIfAborted();
          await lockMatrixAdmission([], [member.bindingId]);
          operationSignal().throwIfAborted();
          const binding =
            await query(sql`SELECT b.workspace_id AS "workspaceId" FROM workspace_group_bindings b
            WHERE b.id = ${member.bindingId} AND b.channel = 'matrix'
              AND b.installation_id = ${config.serverName} FOR UPDATE OF b`);
          operationSignal().throwIfAborted();
          if (binding.length !== 1) return false;
          // Commit local revocation before native retirement. Its pending receipt
          // remains durable even when the shared budget ends before confirmation.
          const changed =
            await query(sql`UPDATE matrix_room_members m SET state = 'removed',
            native_pending = true, native_retry_at = now() FROM workspace_group_bindings b
            WHERE b.id = m.binding_id AND b.id = ${member.bindingId} AND m.user_id = ${member.userId}
              AND m.state = 'joined' AND (b.revoked_at IS NOT NULL OR NOT EXISTS (
                SELECT 1 FROM workspace_memberships w JOIN workspaces s ON s.id = w.workspace_id
                JOIN organization_memberships o ON o.organization_id = s.organization_id AND o.user_id = w.user_id
                WHERE w.workspace_id = b.workspace_id AND w.user_id = m.user_id
              ) AND NOT EXISTS (
                SELECT 1 FROM workspace_agent_members a WHERE a.workspace_id = b.workspace_id
                  AND ('agent:' || a.id) = m.user_id AND a.revoked_at IS NULL
              )) RETURNING m.user_id`);
          operationSignal().throwIfAborted();
          if (changed.length !== 1) return false;
          await query(
            sql`UPDATE workspace_group_bindings SET epoch = ${randomUUID()} WHERE id = ${member.bindingId}`
          );
          operationSignal().throwIfAborted();
          return true;
        });
        operationSignal().throwIfAborted();
        if (pending)
          await retireMatrixGroupMember(member.bindingId, member.userId);
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
};
