import { query, transaction } from "@db/queries";
import { sql } from "drizzle-orm";
import type { z } from "zod";
import {
  roomReadPositionSchema,
  roomUnreadSchema,
  readReceiptPreferenceSchema,
} from "@zoen/companion-ui/rooms";
import type { WorkspaceActorSchema } from "../workspaces/access";
import { WorkspaceAccessDenied } from "../workspaces/access";
import { joinMatrixRoom, requireMatrixRoom } from "./rooms";
import { readRoomMessage } from "./messages";
import { MatrixError, matrixRequest } from "./client";
import { ensureMatrixIdentity } from "./identities";

const preferencePath = (id: string) =>
  `user/${encodeURIComponent(id)}/account_data/io.zoen.read_receipts`;

async function readPreference(matrixId: string) {
  try {
    return readReceiptPreferenceSchema.parse(
      await matrixRequest(
        "GET",
        preferencePath(matrixId),
        undefined,
        matrixId,
        {
          maxResponseBytes: 1024,
        }
      )
    );
  } catch (error) {
    if (error instanceof MatrixError && error.reason === "not-found")
      return { enabled: false };
    throw error;
  }
}

function requireHuman(actor: z.infer<typeof WorkspaceActorSchema>) {
  if (!actor.authSessionId || actor.groupBindingId || actor.protocolTaskId)
    throw new WorkspaceAccessDenied();
}

/** This account-wide lock orders opt-out against publication from every device. */
async function lockPreference(userId: string) {
  await query(
    sql`SELECT pg_advisory_xact_lock(hashtextextended(${`matrix-read-receipts:${userId}`}, 0))`
  );
}

export async function readReadReceiptPreference(
  actor: z.infer<typeof WorkspaceActorSchema>,
  roomId: string
) {
  requireHuman(actor);
  await requireMatrixRoom(actor, roomId);
  const result = await readPreference(await ensureMatrixIdentity(actor));
  await requireMatrixRoom(actor, roomId);
  return result;
}

export async function setReadReceiptPreference(
  actor: z.infer<typeof WorkspaceActorSchema>,
  roomId: string,
  enabled: boolean
) {
  requireHuman(actor);
  return transaction(async () => {
    await lockPreference(actor.userId);
    await requireMatrixRoom(actor, roomId);
    const matrixId = await ensureMatrixIdentity(actor);
    await requireMatrixRoom(actor, roomId);
    const preference = { enabled };
    await matrixRequest("PUT", preferencePath(matrixId), preference, matrixId);
    return preference;
  });
}

/** Only an actually visible event advances reading. Public receipts require account opt-in. */
export async function markMatrixRoomRead(
  actor: z.infer<typeof WorkspaceActorSchema>,
  raw: z.infer<typeof roomReadPositionSchema>
) {
  const input = roomReadPositionSchema.parse(raw);
  requireHuman(actor);
  return transaction(async () => {
    await lockPreference(actor.userId);
    await query(
      sql`SELECT pg_advisory_xact_lock(hashtextextended(${`matrix-read:${actor.userId}:${input.id}`}, 0))`
    );
    const room = await joinMatrixRoom(actor, input.id);
    const preference = await readPreference(room.matrixId);
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
      `rooms/${encodeURIComponent(room.roomId)}/receipt/${preference.enabled ? "m.read" : "m.read.private"}/${encodeURIComponent(input.messageId)}`,
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
