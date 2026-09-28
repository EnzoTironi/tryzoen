import { query } from "@db/queries";
import { sql } from "drizzle-orm";
import { z } from "zod";
import { mapAsync } from "../operations/async";
import {
  MatrixError,
  matrixConfiguration,
  matrixRequest,
  MatrixEventSchema,
} from "./client";
import { projectMatrixActivity } from "./activity";

const pendingRoom = z.object({
  roomId: z.string(),
  matrixId: z.string(),
  cursor: z.string().nullable(),
  edited: z.boolean(),
});
const historyPage = z.object({
  chunk: z.array(MatrixEventSchema).max(100),
  end: z.string().optional(),
});

/** Five rooms/tick, one 100-event history page each, two concurrent requests. */
export async function reconcileMatrixActivity() {
  const config = await matrixConfiguration();
  const rooms = z.array(pendingRoom).parse(
    await query(sql`
    WITH bindings AS (
      SELECT conversation_id AS room_id, ${config.botId}::text AS matrix_id FROM workspace_group_bindings
      WHERE channel = 'matrix' AND installation_id = ${config.serverName} AND revoked_at IS NULL
      UNION
      SELECT d.room_id, i.matrix_id FROM matrix_direct_rooms d JOIN matrix_identities i ON i.user_id = d.first_user_id
      WHERE d.server_name = ${config.serverName}
    )
    SELECT b.room_id AS "roomId", b.matrix_id AS "matrixId", a.reconcile_cursor AS cursor, COALESCE(a.latest_edited, false) AS edited
    FROM bindings b LEFT JOIN matrix_room_activity a ON a.server_name = ${config.serverName} AND a.room_id = b.room_id
    WHERE a.reconciled_at IS NULL
    ORDER BY a.reconcile_attempted_at NULLS FIRST, b.room_id LIMIT 5
  `)
  );
  return mapAsync(
    rooms,
    async (room) => {
      await query(sql`INSERT INTO matrix_room_activity(server_name, room_id, reconcile_attempted_at)
      VALUES (${config.serverName}, ${room.roomId}, now())
      ON CONFLICT (server_name, room_id) DO UPDATE SET reconcile_attempted_at = now()`);
      try {
        await reconcileRoomActivity(config.serverName, room);
        return { roomId: room.roomId, synchronized: true };
      } catch (error) {
        if (!(error instanceof MatrixError)) throw error;
        // Cursor stays durable; another room gets a turn before this one retries.
        return { roomId: room.roomId, synchronized: false };
      }
    },
    2
  );
}

async function reconcileRoomActivity(
  serverName: string,
  room: z.infer<typeof pendingRoom>
) {
  const result = historyPage.parse(
    await matrixRequest(
      "GET",
      `rooms/${encodeURIComponent(room.roomId)}/messages?dir=b&limit=100&filter=${encodeURIComponent(JSON.stringify({ types: ["m.room.message"] }))}${room.cursor ? `&from=${encodeURIComponent(room.cursor)}` : ""}`,
      undefined,
      room.matrixId
    )
  );
  const messages = result.chunk.filter(
    (event) =>
      event.type === "m.room.message" &&
      event.content["m.relates_to"]?.rel_type !== "m.replace"
  );
  for (const event of messages)
    await projectMatrixActivity(serverName, { ...event, room_id: room.roomId });
  for (const event of result.chunk)
    if (event.content["m.relates_to"]?.rel_type === "m.replace")
      await projectMatrixActivity(serverName, {
        ...event,
        room_id: room.roomId,
      });
  if (!messages.length && result.end && result.end === room.cursor)
    throw new MatrixError({ reason: "conflict" });
  const complete = messages.length > 0 || !result.end;
  const uncertainEdits =
    Boolean(room.cursor && room.edited) ||
    (!messages.length &&
      result.chunk.some(
        (event) => event.content["m.relates_to"]?.rel_type === "m.replace"
      ));
  if (uncertainEdits)
    await query(
      sql`UPDATE matrix_room_activity SET latest_edited = true WHERE server_name = ${serverName} AND room_id = ${room.roomId}`
    );
  await query(sql`UPDATE matrix_room_activity SET reconcile_cursor = ${complete ? null : (result.end ?? null)},
    reconciled_at = ${complete ? new Date() : null}
    WHERE server_name = ${serverName} AND room_id = ${room.roomId}`);
}
