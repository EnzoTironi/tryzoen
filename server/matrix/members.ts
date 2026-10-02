import { query } from "@db/queries";
import { sql } from "drizzle-orm";
import { z } from "zod";
import { roomMemberSchema, type roomSchema } from "@zoen/companion-ui/rooms";
import type { WorkspaceActorSchema } from "../workspaces/access";
import { directRoomMembers } from "./direct";
/** Attribution for an already authorized room, shared by history and exact context. */
export async function readRoomMembers(
  actor: z.infer<typeof WorkspaceActorSchema>,
  id: string,
  kind: z.infer<typeof roomSchema>["kind"]
) {
  return kind === "direct"
    ? await directRoomMembers(actor, id)
    : z.array(roomMemberSchema).parse(
        await query(sql`
      SELECT * FROM (
      SELECT i.matrix_id AS id, u.name AS name, d.username,
        i.user_id = ${actor.userId} AS mine, false AS bot, (w.role = 'member' AND i.user_id <> ${actor.userId}) AS "mayRemove", u.image AS "avatarUri"
      FROM matrix_identities i
      JOIN public.user u ON ('better-auth:' || u.id) = i.user_id
      LEFT JOIN user_directory d ON d.user_id = u.id
      JOIN matrix_room_members m ON m.user_id = i.user_id
      JOIN workspace_memberships w ON w.user_id = i.user_id AND w.workspace_id = ${actor.workspaceId}
      WHERE m.binding_id = ${id} AND m.state = 'joined'
      UNION ALL
      SELECT i.matrix_id AS id, a.name, a.username,
        false AS mine, true AS bot, false AS "mayRemove", NULL::text AS "avatarUri"
      FROM workspace_agent_members a
      JOIN matrix_identities i ON i.user_id = ('agent:' || a.id::text)
      JOIN matrix_room_members m ON m.user_id = i.user_id
      JOIN workspace_group_bindings b ON b.id = m.binding_id
      WHERE m.binding_id = ${id} AND m.state = 'joined'
        AND a.workspace_id = ${actor.workspaceId} AND a.revoked_at IS NULL
        AND b.workspace_id = a.workspace_id AND b.channel = 'matrix' AND b.revoked_at IS NULL
      ) people ORDER BY id LIMIT 100
    `)
      );
}
