import { uploadMatrixMedia } from "./media/upload";
import { directRoomMembers, findDirectRoom } from "./direct";
import { query, transaction as withDatabaseTransaction } from "@db/queries";
import { sql } from "drizzle-orm";
import { z } from "zod";
import { randomUUID } from "node:crypto";
import {
  roomSchema,
  roomMemberSchema,
  type roomCreateSchema,
  type roomSendSchema,
} from "@zoen/companion-ui/rooms";
import {
  projectMatrixMessage,
  readMatrixText,
  readRoomMessage,
} from "./messages";

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
  const access = await requireWorkspaceAccess(actor, manage);
  if (!actor.authSessionId || !access.organizationId)
    throw new WorkspaceAccessDenied();
  if (!manage) {
    const direct = await findDirectRoom(actor, id);
    if (direct) return direct;
  }
  const config = await matrixConfiguration();

  const rows =
    await query(sql`SELECT id, conversation_id AS "roomId", label, epoch, 'group' AS kind FROM workspace_group_bindings
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
    await query(sql`SELECT id, conversation_id AS "roomId", label, epoch, 'group' AS kind FROM workspace_group_bindings
    WHERE workspace_id = ${actor.workspaceId} AND channel = 'matrix' AND revoked_at IS NULL ORDER BY created_at LIMIT 20`);
  return {
    configured,
    mayManage: !!access.organizationId && access.role !== "member",
    rooms: await z.array(roomSchema).parseAsync(rows),
  };
};

export const createMatrixRoom = async function (
  actor: z.output<typeof WorkspaceActorSchema>,
  input: z.output<typeof roomCreateSchema>
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
export const joinMatrixRoom = async function (
  actor: z.output<typeof WorkspaceActorSchema>,
  id: string
) {
  return await withDatabaseTransaction(async () => {
    await query(sql`SELECT pg_advisory_xact_lock(hashtextextended(${id}, 5))`);
    const room = await requireMatrixRoom(actor, id);
    const matrixId = await ensureMatrixIdentity(actor);
    if (room.kind === "direct") return { ...room, matrixId };
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
  id: string,
  from?: string,
  rootId?: string
) {
  return await withDatabaseTransaction(async () => {
    const room = await joinMatrixRoom(actor, id);
    await requireWorkspaceAccess(actor);
    const base = `rooms/${encodeURIComponent(room.roomId)}`;
    const parent = rootId ? await readRoomMessage(room, rootId) : undefined;
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
      rootId ? "v1" : "v3"
    );
    const events = await z
      .object({
        chunk: z.array(MatrixEventSchema).max(100),
        end: z.string().optional(),
        next_batch: z.string().optional(),
      })
      .parseAsync(response);
    const members =
      room.kind === "direct"
        ? await directRoomMembers(actor, id)
        : z.array(roomMemberSchema).parse(
            await query(sql`
      SELECT i.matrix_id AS id, u.name AS name, d.username,
        i.user_id = ${actor.userId} AS mine, false AS bot, u.image AS "avatarUri"
      FROM matrix_identities i
      JOIN public.user u ON ('better-auth:' || u.id) = i.user_id
      LEFT JOIN user_directory d ON d.user_id = u.id
      JOIN matrix_room_members m ON m.user_id = i.user_id
      JOIN workspace_memberships w ON w.user_id = i.user_id AND w.workspace_id = ${actor.workspaceId}
      WHERE m.binding_id = ${id} ORDER BY i.matrix_id LIMIT 100
    `)
          );
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
        .filter((event) => event.type === "m.room.message")
        .toReversed()
        .map(project),
      ...(parent ? { parent: project(parent) } : {}),
    };
  });
};

export const sendMatrixMessage = async function (
  actor: z.output<typeof WorkspaceActorSchema>,
  input: z.output<typeof roomSendSchema>
) {
  return await withDatabaseTransaction(async () => {
    const room = await joinMatrixRoom(actor, input.id);
    await requireWorkspaceAccess(actor);
    if (input.rootId) {
      const parent = await readRoomMessage(room, input.rootId);
      if (parent.content["m.relates_to"]?.rel_type === "m.thread")
        throw new WorkspaceAccessDenied();
    }
    const reply = input.replyTo
      ? await readRoomMessage(room, input.replyTo)
      : undefined;
    const replyThread = reply?.content["m.relates_to"];
    if (reply && reply.event_id !== input.rootId) {
      const threadId =
        replyThread?.rel_type === "m.thread" ? replyThread.event_id : undefined;
      if (threadId !== input.rootId) throw new WorkspaceAccessDenied();
    }
    const replyTarget = reply?.event_id ?? input.rootId;
    const relation = {
      ...(input.rootId
        ? {
            rel_type: "m.thread",
            event_id: input.rootId,
            is_falling_back: !reply,
          }
        : {}),
      ...(replyTarget ? { "m.in_reply_to": { event_id: replyTarget } } : {}),
    };
    const body = reply
      ? `> <${reply.sender}> ${readMatrixText(reply.content).text.slice(0, 4000).replaceAll("\n", "\n> ")}\n\n${input.text}`
      : input.text;
    const sent = [];
    if (input.text)
      sent.push(
        await matrixRequest(
          "PUT",
          `rooms/${encodeURIComponent(room.roomId)}/send/m.room.message/${input.operationId}`,
          {
            msgtype: "m.text",
            body,
            ...(input.rootId || reply ? { "m.relates_to": relation } : {}),
          },
          room.matrixId
        )
      );
    for (const [index, file] of (input.files ?? []).entries()) {
      await requireMatrixRoom(actor, input.id);
      const media = await uploadMatrixMedia(file, room.matrixId);
      const category = file.mediaType.split("/")[0] ?? "application";
      sent.push(
        await matrixRequest(
          "PUT",
          `rooms/${encodeURIComponent(room.roomId)}/send/m.room.message/${input.operationId}.file.${index}`,
          {
            ...media,
            msgtype: ["image", "audio", "video"].includes(category)
              ? `m.${category}`
              : "m.file",
            body: file.filename ?? "Attachment",
            filename: file.filename ?? "Attachment",
            ...(input.rootId || reply ? { "m.relates_to": relation } : {}),
          },
          room.matrixId
        )
      );
    }
    return await z.object({ event_id: z.string() }).parseAsync(sent[0]);
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
