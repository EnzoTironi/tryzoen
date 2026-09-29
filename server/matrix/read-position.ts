import { query, transaction } from "@db/queries";
import { sql } from "drizzle-orm";
import type { z } from "zod";
import {
  roomReadPositionSchema,
  roomUnreadSchema,
} from "@zoen/companion-ui/rooms";
import type { WorkspaceActorSchema } from "../workspaces/access";
import { WorkspaceAccessDenied } from "../workspaces/access";
import { joinMatrixRoom, requireMatrixRoom } from "./rooms";
import { readRoomMessage } from "./messages";
import { matrixRequest } from "./client";

/** Reading is private. The UI must explicitly submit a visible event, not a fetched page. */
export async function markMatrixRoomRead(
  actor: z.infer<typeof WorkspaceActorSchema>,
  raw: z.infer<typeof roomReadPositionSchema>
) {
  const input = roomReadPositionSchema.parse(raw);
  return transaction(async () => {
    await query(
      sql`SELECT pg_advisory_xact_lock(hashtextextended(${`matrix-read:${actor.userId}:${input.id}`}, 0))`
    );
    const room = await joinMatrixRoom(actor, input.id);
    const event = await readRoomMessage(room, input.messageId, true);
    const relation = event.content["m.relates_to"];
    const thread =
      relation?.rel_type === "m.thread" ? relation.event_id : undefined;
    if (
      (event.room_id && event.room_id !== room.roomId) ||
      (event.event_id !== input.rootId && thread !== input.rootId)
    )
      throw new WorkspaceAccessDenied();
    await requireMatrixRoom(actor, input.id);
    await matrixRequest(
      "POST",
      `rooms/${encodeURIComponent(room.roomId)}/receipt/m.read.private/${encodeURIComponent(input.messageId)}`,
      { thread_id: input.rootId ?? "main" },
      room.matrixId
    );
    if (!input.rootId) {
      await matrixRequest(
        "POST",
        `rooms/${encodeURIComponent(room.roomId)}/read_markers`,
        { "m.fully_read": input.messageId },
        room.matrixId
      );
      await writeUnreadMarker(room, false);
    }
  });
}

/** A private reminder, independent of receipts and fully-read positions. */
export async function setMatrixRoomUnread(
  actor: z.infer<typeof WorkspaceActorSchema>,
  raw: z.infer<typeof roomUnreadSchema>
) {
  const input = roomUnreadSchema.parse(raw);
  return transaction(async () => {
    await query(
      sql`SELECT pg_advisory_xact_lock(hashtextextended(${`matrix-read:${actor.userId}:${input.id}`}, 0))`
    );
    const room = await joinMatrixRoom(actor, input.id);
    await requireMatrixRoom(actor, input.id);
    await writeUnreadMarker(room, input.unread);
  });
}

async function writeUnreadMarker(
  room: Awaited<ReturnType<typeof joinMatrixRoom>>,
  unread: boolean
) {
  await matrixRequest(
    "PUT",
    `user/${encodeURIComponent(room.matrixId)}/rooms/${encodeURIComponent(room.roomId)}/account_data/m.marked_unread`,
    { unread },
    room.matrixId
  );
}
