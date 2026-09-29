import { roomTypingWriteSchema } from "@zoen/companion-ui/rooms";
import type { z } from "zod";
import {
  WorkspaceAccessDenied,
  type WorkspaceActorSchema,
} from "../workspaces/access";
import { joinMatrixRoom, requireMatrixRoom } from "./rooms";
import { matrixRequest } from "./client";

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
