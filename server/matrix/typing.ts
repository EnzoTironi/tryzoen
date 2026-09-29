import {
  roomTypingWriteSchema,
  roomTypingReadSchema,
  roomTypingPageSchema,
} from "@zoen/companion-ui/rooms";
import type { z } from "zod";
import {
  WorkspaceAccessDenied,
  type WorkspaceActorSchema,
} from "../workspaces/access";
import { joinMatrixRoom, requireMatrixRoom } from "./rooms";
import { MatrixError, matrixRequest } from "./client";
import { openTypingCursor, sealTypingCursor } from "./typing/cursor";
import { pollNativeSync } from "./sync/native";

export async function setMatrixTyping(
  actor: z.infer<typeof WorkspaceActorSchema>,
  raw: z.infer<typeof roomTypingWriteSchema>
) {
  const input = roomTypingWriteSchema.parse(raw);
  if (!actor.authSessionId || actor.groupBindingId || actor.protocolTaskId)
    throw new WorkspaceAccessDenied();
  const room = await joinMatrixRoom(actor, input.id);
  await matrixRequest(
    "PUT",
    `rooms/${encodeURIComponent(room.roomId)}/typing/${encodeURIComponent(room.matrixId)}`,
    { typing: input.typing, ...(input.typing ? { timeout: 20000 } : {}) },
    room.matrixId
  );
  await requireMatrixRoom(actor, input.id);
}
export async function readMatrixTyping(
  actor: z.infer<typeof WorkspaceActorSchema>,
  raw: z.infer<typeof roomTypingReadSchema>
) {
  const input = roomTypingReadSchema.parse(raw);
  if (!actor.authSessionId || actor.groupBindingId || actor.protocolTaskId)
    throw new WorkspaceAccessDenied();
  const previous = await openTypingCursor(actor, input.cursor);
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
      "typing"
    );
    const current = await requireMatrixRoom(actor, input.id);
    if (current.roomId !== room.roomId || current.epoch !== room.epoch)
      throw new WorkspaceAccessDenied();
    const event = native.rooms?.join?.[room.roomId]?.ephemeral?.events.at(-1);
    // A healthy incremental sync retains the native set until a replacement (including []).
    // Bind the deadline to the request cursor, so identical request replay cannot renew it.
    const expiresAt = previous ? previous.issuedAt + 30000 : Date.now() + 30000;
    const snapshot =
      event?.type === "m.typing" ? event.content.user_ids : undefined;
    const userIds = (snapshot ?? previous?.userIds ?? []).filter(
      (id) => id !== room.matrixId
    );
    const cursor = await sealTypingCursor({
      purpose: "matrix-room-typing-v1",
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
    return roomTypingPageSchema.parse({
      status: "ready",
      cursor,
      userIds: previous && expiresAt > Date.now() ? userIds : [],
      expiresAt: previous ? expiresAt : 0,
    });
  } catch (error) {
    if (!(error instanceof MatrixError)) throw error;
    await requireMatrixRoom(actor, input.id);
    return roomTypingPageSchema.parse({
      status: "unavailable",
      cursor: null,
      userIds: [],
      expiresAt: 0,
    });
  }
}
