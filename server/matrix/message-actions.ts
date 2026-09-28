import { transaction } from "@db/queries";
import { roomDeleteSchema } from "@zoen/companion-ui/rooms";
import type { z } from "zod";
import {
  WorkspaceAccessDenied,
  type WorkspaceActorSchema,
} from "../workspaces/access";
import { matrixRequest } from "./client";
import { readRoomMessage } from "./messages";
import { joinMatrixRoom, requireMatrixRoom } from "./rooms";

/** Native redaction, not a promise to erase downloaded files or recipient copies. */
export async function deleteMatrixMessage(
  actor: z.output<typeof WorkspaceActorSchema>,
  raw: z.infer<typeof roomDeleteSchema>
) {
  const input = roomDeleteSchema.parse(raw);
  return transaction(async () => {
    const room = await joinMatrixRoom(actor, input.id);
    // Allow the tombstone so a successful request with a lost response can retry.
    const message = await readRoomMessage(room, input.messageId, true);
    if (
      message.sender !== room.matrixId ||
      (message.room_id && message.room_id !== room.roomId)
    )
      throw new WorkspaceAccessDenied();
    await requireMatrixRoom(actor, input.id);
    await matrixRequest(
      "PUT",
      `rooms/${encodeURIComponent(room.roomId)}/redact/${encodeURIComponent(input.messageId)}/${input.operationId}`,
      {},
      room.matrixId
    );
  });
}
