import { query, transaction } from "@db/queries";
import { sql } from "drizzle-orm";
import { z } from "zod";
import { mapAsync, withDeadline } from "../operations/async";
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

function activityTransaction<Value>(
  deadlineMs: number,
  run: () => Promise<Value>
) {
  const remaining = deadlineMs - Date.now();
  if (remaining <= 0) throw new Error("Matrix activity deadline reached.");
  return withDeadline(
    () =>
      transaction(
        async () => {
          await query(
            sql`SELECT set_config('statement_timeout',${String(Math.max(1, deadlineMs - Date.now()))},true)`
          );
          return run();
        },
        { outermost: true }
      ),
    deadlineMs
  );
}

/** One 100-event page per admitted room, at most two concurrent requests.
 * The existing Matrix schedule owns the absolute deadline and item budget.
 */
export async function reconcileMatrixActivity(
  deadlineMs: number,
  limit: number
) {
  z.number().int().min(0).max(5).parse(limit);
  z.number().int().min(0).max(Number.MAX_SAFE_INTEGER).parse(deadlineMs);
  if (limit === 0 || deadlineMs <= Date.now()) return 0;
  if (deadlineMs > Date.now() + 30_000)
    throw new Error(
      "Matrix activity deadline exceeds bounded schedule budget."
    );
  return withDeadline(async () => {
    const config = await matrixConfiguration();
    const rooms = await activityTransaction(deadlineMs, async () =>
      z
        .array(pendingRoom)
        .max(limit)
        .parse(
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
    ORDER BY a.reconcile_attempted_at NULLS FIRST, b.room_id LIMIT ${limit}
  `)
        )
    );
    let attempted = 0;
    await mapAsync(
      rooms,
      async (room) => {
        if (Date.now() >= deadlineMs) return;
        attempted += 1;
        await activityTransaction(deadlineMs, () =>
          query(sql`INSERT INTO matrix_room_activity(server_name, room_id, reconcile_attempted_at)
        VALUES (${config.serverName}, ${room.roomId}, now())
        ON CONFLICT (server_name, room_id) DO UPDATE SET reconcile_attempted_at = now()`)
        );
        try {
          await reconcileRoomActivity(config.serverName, room, deadlineMs);
        } catch (error) {
          if (!(error instanceof MatrixError)) throw error;
          // Cursor stays durable; another room gets a turn before this one retries.
        }
      },
      2
    );
    return attempted;
  }, deadlineMs);
}

async function reconcileRoomActivity(
  serverName: string,
  room: z.infer<typeof pendingRoom>,
  deadlineMs: number
) {
  const remaining = deadlineMs - Date.now();
  if (remaining <= 0) throw new Error("Matrix activity deadline reached.");
  const result = historyPage.parse(
    await withDeadline(
      () =>
        matrixRequest(
          "GET",
          `rooms/${encodeURIComponent(room.roomId)}/messages?dir=b&limit=100&filter=${encodeURIComponent(JSON.stringify({ types: ["m.room.message"] }))}${room.cursor ? `&from=${encodeURIComponent(room.cursor)}` : ""}`,
          undefined,
          room.matrixId
        ),
      deadlineMs
    )
  );
  const messages = result.chunk.filter(
    (event) =>
      event.type === "m.room.message" &&
      event.content["m.relates_to"]?.rel_type !== "m.replace"
  );
  for (const event of messages)
    await activityTransaction(deadlineMs, () =>
      projectMatrixActivity(serverName, { ...event, room_id: room.roomId })
    );
  for (const event of result.chunk)
    if (event.content["m.relates_to"]?.rel_type === "m.replace")
      await activityTransaction(deadlineMs, () =>
        projectMatrixActivity(serverName, {
          ...event,
          room_id: room.roomId,
        })
      );
  if (!messages.length && result.end && result.end === room.cursor)
    throw new MatrixError({ reason: "conflict" });
  const complete = messages.length > 0 || !result.end;
  const uncertainEdits =
    Boolean(room.cursor && room.edited) ||
    (!messages.length &&
      result.chunk.some(
        (event) => event.content["m.relates_to"]?.rel_type === "m.replace"
      ));
  await activityTransaction(deadlineMs, async () => {
    if (uncertainEdits)
      await query(sql`UPDATE matrix_room_activity SET latest_edited = true
        WHERE server_name = ${serverName} AND room_id = ${room.roomId}`);
    await query(sql`UPDATE matrix_room_activity SET reconcile_cursor = ${complete ? null : (result.end ?? null)},
      reconciled_at = ${complete ? new Date() : null}
      WHERE server_name = ${serverName} AND room_id = ${room.roomId}`);
  });
}
