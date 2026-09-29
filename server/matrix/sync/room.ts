import {
  roomSyncReadSchema,
  roomSyncPageSchema,
} from "@zoen/companion-ui/rooms";
import type { z } from "zod";
import {
  WorkspaceAccessDenied,
  type WorkspaceActorSchema,
} from "../../workspaces/access";
import { joinMatrixRoom, requireMatrixRoom } from "../rooms";
import { MatrixError } from "../client";
import { openRoomSyncCursor, sealRoomSyncCursor } from "./room-cursor";
import { pollNativeSync } from "./native";
import { readRoomChanges } from "./changes";

export async function readMatrixRoomSync(
  actor: z.infer<typeof WorkspaceActorSchema>,
  raw: z.infer<typeof roomSyncReadSchema>
) {
  const input = roomSyncReadSchema.parse(raw);
  if (!actor.authSessionId || actor.groupBindingId || actor.protocolTaskId)
    throw new WorkspaceAccessDenied();
  const previous = await openRoomSyncCursor(actor, input.cursor);
  const room = await joinMatrixRoom(actor, input.id);
  if (
    previous &&
    (previous.roomId !== room.roomId || previous.epoch !== room.epoch)
  )
    throw new WorkspaceAccessDenied();
  try {
    const native = await pollNativeSync(
      room.matrixId,
      [room.roomId],
      previous?.nextBatch ?? null,
      "room"
    );
    const typingEvent =
      native.rooms?.join?.[room.roomId]?.ephemeral?.events.at(-1);
    const timeline = native.rooms?.join?.[room.roomId]?.timeline;
    const reset =
      !previous ||
      !!timeline?.limited ||
      room.roomId in (native.rooms?.leave ?? {});
    const historyEvents =
      timeline?.events.filter((event) => event.type !== "m.reaction") ?? [];
    const reactionsChanged =
      reset ||
      !!timeline?.events.some((event) =>
        ["m.reaction", "m.room.redaction", "m.room.member"].includes(event.type)
      );
    const changes =
      !reset && historyEvents.length
        ? await readRoomChanges(actor, room, historyEvents)
        : null;
    const current = await requireMatrixRoom(actor, input.id);
    if (current.roomId !== room.roomId || current.epoch !== room.epoch)
      throw new WorkspaceAccessDenied();
    // A healthy incremental sync retains the native set until a replacement (including []).
    // Bind the deadline to the request cursor, so identical request replay cannot renew it.
    const expiresAt = previous ? previous.issuedAt + 30000 : Date.now() + 30000;
    const snapshot =
      typingEvent?.type === "m.typing"
        ? typingEvent.content.user_ids
        : undefined;
    const userIds = (snapshot ?? previous?.userIds ?? []).filter(
      (id) => id !== room.matrixId
    );
    const cursor = await sealRoomSyncCursor({
      purpose: "matrix-room-sync-v1",
      userId: actor.userId,
      sessionId: actor.authSessionId ?? "",
      workspaceId: actor.workspaceId,
      roomId: room.roomId,
      epoch: room.epoch,
      nextBatch: native.next_batch,
      issuedAt: Date.now(),
      userIds: expiresAt > Date.now() ? userIds : [],
      expiresAt,
    });
    return roomSyncPageSchema.parse({
      status: "ready",
      cursor,
      timelineChanged: historyEvents.length > 0,
      reactionsChanged,
      reset,
      changes,
      userIds: previous && expiresAt > Date.now() ? userIds : [],
      expiresAt: previous ? expiresAt : 0,
    });
  } catch (error) {
    if (!(error instanceof MatrixError)) throw error;
    await requireMatrixRoom(actor, input.id);
    return roomSyncPageSchema.parse({
      status: "unavailable",
      cursor: null,
      timelineChanged: false,
      reactionsChanged: false,
      reset: false,
      changes: null,
      userIds: [],
      expiresAt: 0,
    });
  }
}
