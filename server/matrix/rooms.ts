import { query, transaction as withDatabaseTransaction } from "@db/queries";
import { sql } from "drizzle-orm";
import { z } from "zod";
import { randomUUID } from "node:crypto";
import {
  addReactionToMessageOutputSchema,
  reactionTextFor,
} from "@shared/chat/reaction";

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
const roomSchema = z.object({
  id: z.string(),
  roomId: z.string(),
  label: z.string(),
  epoch: z.string(),
});
export const MatrixRoomInput = z.object({
  id: z.uuid(),
});
export const MatrixCreateInput = z.object({
  operationId: z.uuid(),
  name: z
    .string()
    .min(1)
    .refine((value) => value === value.trim(), "Expected trimmed text")
    .max(80),
});
export const MatrixMessageInput = z.object({
  id: z.uuid(),
  operationId: z.uuid(),
  text: z
    .string()
    .min(1)
    .refine((value) => value === value.trim(), "Expected trimmed text")
    .max(8000),
});

const requireMatrixRoom = async function (
  actor: z.output<typeof WorkspaceActorSchema>,
  id: string,
  manage = false
) {
  const access = await requireWorkspaceAccess(actor, manage);
  if (!actor.authSessionId || !access.organizationId)
    throw new WorkspaceAccessDenied();
  const config = await matrixConfiguration();

  const rows =
    await query(sql`SELECT id, conversation_id AS "roomId", label, epoch FROM workspace_group_bindings
    WHERE id = ${id} AND workspace_id = ${actor.workspaceId} AND channel = 'matrix'
      AND installation_id = ${config.serverName} AND revoked_at IS NULL FOR SHARE`);
  if (rows.length !== 1) throw new WorkspaceAccessDenied();
  return await roomSchema.parseAsync(rows[0]);
};

export const listMatrixRooms = async function (
  actor: z.output<typeof WorkspaceActorSchema>
) {
  const access = await requireWorkspaceAccess(actor);
  const configured = await Promise.try(async () => {
    await matrixConfiguration();
    return true;
  }).catch((error: unknown) => {
    if (error instanceof MatrixError) return Promise.resolve(false);
    throw error;
  });

  const rows =
    await query(sql`SELECT id, conversation_id AS "roomId", label, epoch FROM workspace_group_bindings
    WHERE workspace_id = ${actor.workspaceId} AND channel = 'matrix' AND revoked_at IS NULL ORDER BY created_at`);
  return {
    configured,
    mayManage: !!access.organizationId && access.role !== "member",
    rooms: await z.array(roomSchema).parseAsync(rows),
  };
};

export const createMatrixRoom = async function (
  actor: z.output<typeof WorkspaceActorSchema>,
  input: z.output<typeof MatrixCreateInput>
) {
  const access = await requireWorkspaceAccess(actor, true);
  if (!actor.authSessionId || !access.organizationId)
    throw new WorkspaceAccessDenied();
  const config = await matrixConfiguration();

  return await withDatabaseTransaction(async () => {
    await query(
      sql`SELECT pg_advisory_xact_lock(hashtextextended(${actor.workspaceId}, 4))`
    );
    await requireWorkspaceAccess(actor, true);
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
const joinMatrixRoom = async function (
  actor: z.output<typeof WorkspaceActorSchema>,
  id: string
) {
  return await withDatabaseTransaction(async () => {
    await query(sql`SELECT pg_advisory_xact_lock(hashtextextended(${id}, 5))`);
    const room = await requireMatrixRoom(actor, id);
    const matrixId = await ensureMatrixIdentity(actor);
    const members = await query(
      sql`SELECT user_id FROM matrix_room_members WHERE binding_id = ${id} AND user_id = ${actor.userId}`
    );
    if (!members.length) {
      const joined = await z
        .object({
          joined: z.record(z.string(), z.unknown()),
        })
        .parseAsync(
          await matrixRequest(
            "GET",
            `rooms/${encodeURIComponent(room.roomId)}/joined_members`
          )
        );
      if (!(matrixId in joined.joined)) {
        await matrixRequest(
          "POST",
          `rooms/${encodeURIComponent(room.roomId)}/invite`,
          { user_id: matrixId }
        );
        await matrixRequest(
          "POST",
          `join/${encodeURIComponent(room.roomId)}`,
          {},
          matrixId
        );
      }
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
  id: string
) {
  return await withDatabaseTransaction(async () => {
    const room = await joinMatrixRoom(actor, id);
    await requireWorkspaceAccess(actor);
    const response = await matrixRequest(
      "GET",
      `rooms/${encodeURIComponent(room.roomId)}/messages?dir=b&limit=100&filter=${encodeURIComponent(JSON.stringify({ types: ["m.room.message", "m.reaction"] }))}`,
      undefined,
      room.matrixId
    );
    const events = await z
      .object({ chunk: z.array(MatrixEventSchema) })
      .parseAsync(response);
    const people = await query<{
      matrixId: string;
      name: string;
    }>(
      sql`SELECT i.matrix_id AS "matrixId", COALESCE(d.username, u.name) AS name FROM matrix_identities i JOIN public.user u ON ('better-auth:' || u.id) = i.user_id LEFT JOIN user_directory d ON d.user_id = u.id JOIN matrix_room_members m ON m.user_id = i.user_id WHERE m.binding_id = ${id}`
    );
    await requireMatrixRoom(actor, id);
    const config = await matrixConfiguration();
    return {
      room,
      messages: events.chunk
        .filter((event) => event.type === "m.room.message")
        .slice(0, 40)
        .toReversed()
        .map((event) => ({
          id: event.event_id,
          text: event.content.body ?? "",
          sender:
            event.sender === config.botId
              ? "Zoen"
              : (people.find((p) => p.matrixId === event.sender)?.name ??
                "Matrix"),
          mine: event.sender === room.matrixId,
          timestamp: event.origin_server_ts ?? 0,
          reactions: addReactionToMessageOutputSchema.shape.type.options
            .map((type) => ({
              type,
              count: new Set(
                events.chunk
                  .filter((candidate) => {
                    const relation = candidate.content["m.relates_to"];
                    return (
                      candidate.type === "m.reaction" &&
                      relation?.rel_type === "m.annotation" &&
                      relation.event_id === event.event_id &&
                      relation.key === reactionTextFor(type)
                    );
                  })
                  .map((reaction) => reaction.sender)
              ).size,
            }))
            .filter((reaction) => reaction.count > 0),
        })),
    };
  });
};

export const sendMatrixMessage = async function (
  actor: z.output<typeof WorkspaceActorSchema>,
  input: z.output<typeof MatrixMessageInput>
) {
  return await withDatabaseTransaction(async () => {
    const room = await joinMatrixRoom(actor, input.id);
    await requireWorkspaceAccess(actor);
    const sent = await matrixRequest(
      "PUT",
      `rooms/${encodeURIComponent(room.roomId)}/send/m.room.message/${input.operationId}`,
      { msgtype: "m.text", body: input.text },
      room.matrixId
    );
    return await z.object({ event_id: z.string() }).parseAsync(sent);
  });
};

export const closeMatrixRoom = async function (
  actor: z.output<typeof WorkspaceActorSchema>,
  id: string
) {
  return await withDatabaseTransaction(async () => {
    await requireMatrixRoom(actor, id, true);
    await query(
      sql`UPDATE workspace_group_bindings SET revoked_at = now(), epoch = ${randomUUID()} WHERE id = ${id} AND workspace_id = ${actor.workspaceId}`
    );
    return { closed: true };
  });
};

/** Mirror live workspace revocation into Matrix; failed kicks remain retryable. */
export const reconcileMatrixRooms = async function () {
  const stale = await query<{
    bindingId: string;
    userId: string;
    matrixId: string;
    roomId: string;
  }>(sql`
    SELECT m.binding_id AS "bindingId", m.user_id AS "userId", i.matrix_id AS "matrixId", b.conversation_id AS "roomId"
    FROM matrix_room_members m JOIN workspace_group_bindings b ON b.id = m.binding_id
    JOIN matrix_identities i ON i.user_id = m.user_id
    WHERE b.channel = 'matrix' AND (b.revoked_at IS NOT NULL OR NOT EXISTS (
      SELECT 1 FROM workspace_memberships w JOIN workspaces s ON s.id = w.workspace_id
      JOIN organization_memberships o ON o.organization_id = s.organization_id AND o.user_id = w.user_id
      WHERE w.workspace_id = b.workspace_id AND w.user_id = m.user_id
    )) LIMIT 50`);
  for (const member of stale) {
    await query(
      sql`UPDATE workspace_group_bindings SET epoch = ${randomUUID()} WHERE id = ${member.bindingId}`
    );
    const joined = await z
      .object({ joined: z.record(z.string(), z.unknown()) })
      .parseAsync(
        await matrixRequest(
          "GET",
          `rooms/${encodeURIComponent(member.roomId)}/joined_members`
        )
      );
    if (member.matrixId in joined.joined)
      await matrixRequest(
        "POST",
        `rooms/${encodeURIComponent(member.roomId)}/kick`,
        { user_id: member.matrixId, reason: "Workspace access ended" }
      );
    await query(
      sql`DELETE FROM matrix_room_members WHERE binding_id = ${member.bindingId} AND user_id = ${member.userId}`
    );
  }
};
