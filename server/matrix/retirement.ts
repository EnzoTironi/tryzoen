import { query } from "@db/queries";
import { sql } from "drizzle-orm";
import { mapAsync } from "../operations/async";
import { matrixConfiguration, matrixRequest } from "./client";

/** Current application access is already denied; this outbox also removes homeserver membership. */
export const retireMatrixRooms = async function () {
  const config = await matrixConfiguration();
  // Expiry or unpublishing must also retire rooms without waiting for another user request.
  await query(sql`UPDATE matrix_agent_conversations c SET closed_at = now()
    FROM workspace_agent_grants g JOIN workspace_bots b ON b.id = g.bot_id
    WHERE c.grant_id = g.id AND c.closed_at IS NULL
      AND (g.revoked_at IS NOT NULL OR g.expires_at <= now() OR NOT b.discoverable)`);
  const rows = await query<{
    room_id: string;
    sender_id: string;
    bot_id: string;
  }>(sql`
    SELECT room_id, sender_id, bot_id FROM matrix_room_retirements
    WHERE server_name = ${config.serverName} ORDER BY requested_at LIMIT 25`);
  await mapAsync(
    rows,
    async (row) => {
      try {
        // Each identity voluntarily leaves: replay is idempotent even after the bot has left.
        for (const identity of [row.sender_id, row.bot_id]) {
          await matrixRequest(
            "POST",
            `rooms/${encodeURIComponent(row.room_id)}/leave`,
            {},
            identity
          );
        }
        await query(
          sql`DELETE FROM matrix_room_retirements WHERE room_id = ${row.room_id} AND server_name = ${config.serverName}`
        );
      } catch {
        console.warn("Matrix membership retirement remains pending");
      }
    },
    2
  );
};
