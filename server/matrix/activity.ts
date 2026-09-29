import { query } from "@db/queries";
import { sql } from "drizzle-orm";
import type { z } from "zod";
import type { MatrixEventSchema } from "./client";

/** Replayed callbacks update an index, never create a second message authority. */
export async function projectMatrixActivity(
  serverName: string,
  event: z.infer<typeof MatrixEventSchema>
) {
  if (
    !event.room_id ||
    event.type !== "m.room.message" ||
    !Number.isSafeInteger(event.origin_server_ts) ||
    (event.origin_server_ts ?? -1) < 0
  )
    return;
  const relation = event.content["m.relates_to"];
  if (relation?.rel_type === "m.replace") {
    await query(sql`UPDATE matrix_room_activity SET latest_edited = true
      WHERE server_name = ${serverName} AND room_id = ${event.room_id} AND latest_event_id = ${relation.event_id ?? null}`);
    return;
  }
  await query(sql`
    INSERT INTO matrix_room_activity(server_name, room_id, latest_event_id, latest_at)
    SELECT ${serverName}, ${event.room_id}, ${event.event_id}, ${event.origin_server_ts}
    WHERE EXISTS (SELECT 1 FROM workspace_group_bindings WHERE channel = 'matrix' AND installation_id = ${serverName} AND conversation_id = ${event.room_id} AND revoked_at IS NULL)
       OR EXISTS (SELECT 1 FROM matrix_direct_rooms WHERE server_name = ${serverName} AND room_id = ${event.room_id})
    ON CONFLICT (server_name, room_id) DO UPDATE
    SET latest_event_id = EXCLUDED.latest_event_id, latest_at = EXCLUDED.latest_at, latest_edited = false
    WHERE (COALESCE(matrix_room_activity.latest_at, -1), COALESCE(matrix_room_activity.latest_event_id, '')) < (EXCLUDED.latest_at, EXCLUDED.latest_event_id)
  `);
}
