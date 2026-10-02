import { createHash } from "node:crypto";
import { sql } from "drizzle-orm";
import { z } from "zod";
import { query, transaction } from "@db/queries";
import {
  directListSchema,
  directPeopleSchema,
  roomMemberSchema,
  roomSchema,
  type directOpenSchema,
} from "@zoen/companion-ui/rooms";
import {
  requireWorkspaceAccess,
  WorkspaceAccessDenied,
  type WorkspaceActorSchema,
} from "../workspaces/access";
import { ensureMatrixIdentity } from "./identities";
import { lockMatrixAdmission } from "./authority";
import { matrixConfiguration, matrixRequest, MatrixError } from "./client";

const roomResult = z.object({ room_id: z.string() });
const participant = z.object({ userId: z.string() });

export async function searchDirectPeople(
  actor: z.infer<typeof WorkspaceActorSchema>,
  search: string
) {
  await requireWorkspaceAccess(actor);
  if (!actor.authSessionId) throw new WorkspaceAccessDenied();
  const needle = search.trim().replace(/^@/u, "").toLowerCase();
  if (needle.length < 2) return [];
  const rows = await query(sql`
    SELECT u.name, d.username, u.image AS "avatarUri"
    FROM workspace_memberships m
    JOIN workspaces w ON w.id = m.workspace_id
    JOIN organization_memberships o ON o.organization_id = w.organization_id AND o.user_id = m.user_id
    JOIN public.user u ON ('better-auth:' || u.id) = m.user_id
    JOIN user_directory d ON d.user_id = u.id
    WHERE m.workspace_id = ${actor.workspaceId} AND m.user_id <> ${actor.userId}
      AND position(${needle} in lower(d.username || ' ' || u.name)) > 0
    ORDER BY d.username LIMIT 20`);
  await requireWorkspaceAccess(actor);
  return directPeopleSchema.parse(rows);
}

/** Neither workspace administrators nor the shared agent inherit access to a pair. */
export async function findDirectRoom(
  actor: z.infer<typeof WorkspaceActorSchema>,
  id: string
) {
  await requireWorkspaceAccess(actor);
  if (!actor.authSessionId) throw new WorkspaceAccessDenied();
  const config = await matrixConfiguration();
  const rows = await query(sql`
    SELECT d.id, d.workspace_id AS "workspaceId", d.room_id AS "roomId", d.id AS epoch, 'direct' AS kind,
      u.name AS label, u.image AS "avatarUri", n.username
    FROM matrix_direct_rooms d
    JOIN workspaces w ON w.id = d.workspace_id
    JOIN workspace_memberships a ON a.workspace_id = d.workspace_id AND a.user_id = d.first_user_id
    JOIN workspace_memberships b ON b.workspace_id = d.workspace_id AND b.user_id = d.second_user_id
    JOIN organization_memberships oa ON oa.organization_id = w.organization_id AND oa.user_id = a.user_id
    JOIN organization_memberships ob ON ob.organization_id = w.organization_id AND ob.user_id = b.user_id
    JOIN public.user u ON ('better-auth:' || u.id) = CASE WHEN d.first_user_id = ${actor.userId} THEN d.second_user_id ELSE d.first_user_id END
    LEFT JOIN user_directory n ON n.user_id = u.id
    WHERE d.id = ${id} AND d.workspace_id = ${actor.workspaceId} AND d.server_name = ${config.serverName}
      AND ${actor.userId} IN (d.first_user_id, d.second_user_id)
    FOR SHARE OF d, a, b, oa, ob`);
  return rows[0] ? roomSchema.parse(rows[0]) : null;
}

export async function listDirectRooms(
  actor: z.infer<typeof WorkspaceActorSchema>,
  before?: string
) {
  return transaction(async () => {
    await requireWorkspaceAccess(actor);
    if (!actor.authSessionId) throw new WorkspaceAccessDenied();
    const config = await matrixConfiguration();
    const rows = await query(sql`
      SELECT d.id, d.workspace_id AS "workspaceId", d.room_id AS "roomId", d.id AS epoch, 'direct' AS kind,
        u.name AS label, u.image AS "avatarUri", n.username
      FROM matrix_direct_rooms d
      JOIN workspaces w ON w.id = d.workspace_id
      JOIN organization_memberships oa ON oa.organization_id = w.organization_id AND oa.user_id = d.first_user_id
      JOIN organization_memberships ob ON ob.organization_id = w.organization_id AND ob.user_id = d.second_user_id
      JOIN public.user u ON ('better-auth:' || u.id) = CASE WHEN d.first_user_id = ${actor.userId} THEN d.second_user_id ELSE d.first_user_id END
      LEFT JOIN user_directory n ON n.user_id = u.id
      WHERE d.workspace_id = ${actor.workspaceId} AND d.server_name = ${config.serverName}
        AND ${actor.userId} IN (d.first_user_id, d.second_user_id)
        ${before ? sql`AND d.id < ${before}` : sql``}
      ORDER BY d.id DESC LIMIT 21`);
    const items = z.array(roomSchema).parse(rows);
    return directListSchema.parse({
      items: items.slice(0, 20),
      nextCursor: items.length > 20 ? items[19]?.id : null,
    });
  });
}

export async function directRoomMembers(
  actor: z.infer<typeof WorkspaceActorSchema>,
  id: string
) {
  const room = await findDirectRoom(actor, id);
  if (!room) throw new WorkspaceAccessDenied();
  return z
    .array(roomMemberSchema)
    .max(2)
    .parse(
      await query(sql`
    SELECT i.matrix_id AS id, u.name, u.image AS "avatarUri", n.username,
      i.user_id = ${actor.userId} AS mine, false AS bot
    FROM matrix_direct_rooms d
    JOIN matrix_identities i ON i.user_id IN (d.first_user_id, d.second_user_id)
    JOIN public.user u ON ('better-auth:' || u.id) = i.user_id
    LEFT JOIN user_directory n ON n.user_id = u.id
    WHERE d.id = ${id} ORDER BY i.user_id`)
    );
}

export async function openDirectRoom(
  actor: z.infer<typeof WorkspaceActorSchema>,
  input: z.infer<typeof directOpenSchema>
) {
  return transaction(async () => {
    await lockMatrixAdmission([actor.workspaceId], []);
    await requireWorkspaceAccess(actor);
    if (!actor.authSessionId) throw new WorkspaceAccessDenied();
    const peers = await query(sql`
      SELECT m.user_id AS "userId" FROM user_directory d
      JOIN workspace_memberships m ON m.user_id = ('better-auth:' || d.user_id)
      JOIN workspaces w ON w.id = m.workspace_id
      JOIN organization_memberships o ON o.organization_id = w.organization_id AND o.user_id = m.user_id
      WHERE d.username = ${input.username} AND m.workspace_id = ${actor.workspaceId}
        AND m.user_id <> ${actor.userId} FOR SHARE OF m, o`);
    if (!peers[0]) throw new WorkspaceAccessDenied();
    const peer = participant.parse(peers[0]);
    const pair = [actor.userId, peer.userId].toSorted();
    await query(
      sql`SELECT pg_advisory_xact_lock(hashtextextended(${JSON.stringify([actor.workspaceId, ...pair])}, 17))`
    );
    const existing = await query(
      sql`SELECT id FROM matrix_direct_rooms WHERE workspace_id = ${actor.workspaceId} AND first_user_id = ${pair[0]} AND second_user_id = ${pair[1]}`
    );
    if (existing[0]) {
      const room = await findDirectRoom(
        actor,
        z.object({ id: z.string() }).parse(existing[0]).id
      );
      if (!room) throw new WorkspaceAccessDenied();
      return room;
    }
    const collision = await query(
      sql`SELECT id FROM matrix_direct_rooms WHERE id = ${input.operationId}`
    );
    if (collision.length) throw new WorkspaceAccessDenied();
    // Keep identity writes and Matrix account-data merges in the same user order.
    for (const userId of pair)
      await query(
        sql`SELECT pg_advisory_xact_lock(hashtextextended(${userId}, 18))`
      );
    const config = await matrixConfiguration();
    const sender = await ensureMatrixIdentity(actor);
    const recipient = await ensureMatrixIdentity(peer);
    const alias = `_zoen_room_direct_${createHash("sha256")
      .update(JSON.stringify([actor.workspaceId, ...pair, input.operationId]))
      .digest("hex")}`;
    const response = await matrixRequest(
      "POST",
      "createRoom",
      {
        room_alias_name: alias,
        preset: "private_chat",
        visibility: "private",
        is_direct: true,
        invite: [recipient],
        creation_content: { "m.federate": false },
        initial_state: [
          {
            type: "m.room.history_visibility",
            state_key: "",
            content: { history_visibility: "joined" },
          },
        ],
        power_level_content_override: {
          invite: 100,
          kick: 100,
          ban: 100,
          state_default: 100,
        },
      },
      sender
    ).catch((error: unknown) => {
      if (error instanceof MatrixError && error.reason === "conflict")
        return matrixRequest(
          "GET",
          `directory/room/${encodeURIComponent(`#${alias}:${config.serverName}`)}`,
          undefined,
          sender
        );
      throw error;
    });
    const created = roomResult.parse(response);
    await matrixRequest(
      "POST",
      `join/${encodeURIComponent(created.room_id)}`,
      {},
      recipient
    );
    await query(sql`INSERT INTO matrix_direct_rooms(id, workspace_id, first_user_id, second_user_id, room_id, server_name)
      VALUES (${input.operationId}, ${actor.workspaceId}, ${pair[0]}, ${pair[1]}, ${created.room_id}, ${config.serverName})`);
    await recordDirectAccountData(sender, recipient, created.room_id);
    await recordDirectAccountData(recipient, sender, created.room_id);
    const room = await findDirectRoom(actor, input.operationId);
    if (!room) throw new WorkspaceAccessDenied();
    return room;
  });
}

async function recordDirectAccountData(
  userId: string,
  peerId: string,
  roomId: string
) {
  const path = `user/${encodeURIComponent(userId)}/account_data/m.direct`;
  const current = await matrixRequest("GET", path, undefined, userId).catch(
    (error: unknown) => {
      if (error instanceof MatrixError && error.reason === "not-found")
        return {};
      throw error;
    }
  );
  const data = z
    .record(z.string(), z.array(z.string()).max(1000))
    .parse(current);
  const rooms = new Set(data[peerId] ?? []);
  rooms.add(roomId);
  await matrixRequest("PUT", path, { ...data, [peerId]: [...rooms] }, userId);
}
