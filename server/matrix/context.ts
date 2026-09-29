import { readRoomMembers } from "./members";
import { z } from "zod";
import { transaction } from "@db/queries";
import {
  roomMediaReadSchema,
  roomContextSchema,
} from "@zoen/companion-ui/rooms";
import {
  type WorkspaceActorSchema,
  WorkspaceAccessDenied,
} from "../workspaces/access";
import { joinMatrixRoom, requireMatrixRoom } from "./rooms";
import {
  matrixRequest,
  matrixConfiguration,
  MatrixEventSchema,
} from "./client";
import { projectMatrixMessage, readRoomMessage } from "./messages";

/** Native bounded context locates old events directly, without walking room history. */
export async function readMatrixContext(
  actor: z.infer<typeof WorkspaceActorSchema>,
  raw: z.infer<typeof roomMediaReadSchema>
) {
  const input = roomMediaReadSchema.parse(raw);
  return transaction(async () => {
    const room = await joinMatrixRoom(actor, input.id);
    const result = z
      .object({
        event: MatrixEventSchema,
        events_before: z.array(MatrixEventSchema).max(20),
        events_after: z.array(MatrixEventSchema).max(20),
      })
      .parse(
        await matrixRequest(
          "GET",
          `rooms/${encodeURIComponent(room.roomId)}/context/${encodeURIComponent(input.messageId)}?limit=40&filter=${encodeURIComponent(JSON.stringify({ types: ["m.room.message"], lazy_load_members: true }))}`,
          undefined,
          room.matrixId,
          { maxResponseBytes: 1048576 }
        )
      );
    if (
      result.event.event_id !== input.messageId ||
      result.event.room_id !== room.roomId ||
      result.event.type !== "m.room.message" ||
      result.event.content["m.relates_to"]?.rel_type === "m.replace"
    )
      throw new WorkspaceAccessDenied();
    const members = await readRoomMembers(actor, input.id, room.kind);
    const config = await matrixConfiguration();
    const project = (event: z.infer<typeof MatrixEventSchema>) =>
      projectMatrixMessage(event, members, room.matrixId, config.botId);
    const target = project(result.event);
    const rootEvent = target.rootId
      ? await readRoomMessage(room, target.rootId, true)
      : null;
    if (rootEvent && rootEvent.room_id !== room.roomId)
      throw new WorkspaceAccessDenied();
    if (
      [...result.events_before, ...result.events_after].some(
        (event) => event.room_id && event.room_id !== room.roomId
      )
    )
      throw new WorkspaceAccessDenied();
    const root = rootEvent ? project(rootEvent) : null;
    await requireMatrixRoom(actor, input.id);
    return roomContextSchema.parse({
      room,
      members,
      target,
      root,
      messages: [
        ...result.events_before.toReversed(),
        result.event,
        ...result.events_after,
      ]
        .filter(
          (event) =>
            event.type === "m.room.message" &&
            event.content["m.relates_to"]?.rel_type !== "m.replace"
        )
        .map(project),
    });
  });
}
