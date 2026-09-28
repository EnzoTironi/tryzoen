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
}
