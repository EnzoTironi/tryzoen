import { MatrixEventSchema, MatrixError, matrixConfiguration } from "../client";
import { readRoomMembers } from "../members";
import { projectMatrixMessage, readRoomMessage } from "../messages";
import type { joinMatrixRoom } from "../rooms";
import {
  WorkspaceAccessDenied,
  type WorkspaceActorSchema,
} from "../../workspaces/access";
import { z } from "zod";

/** Project a complete native batch; ambiguous state changes use authorized history recovery. */
export async function readRoomChanges(
  actor: z.infer<typeof WorkspaceActorSchema>,
  room: Awaited<ReturnType<typeof joinMatrixRoom>>,
  raw: unknown[]
) {
  const parsed = z.array(MatrixEventSchema).max(20).safeParse(raw);
  if (!parsed.success) throw new MatrixError({ reason: "unavailable" });
  const events = parsed.data;
  if (events.some((event) => event.room_id && event.room_id !== room.roomId))
    throw new MatrixError({ reason: "unavailable" });
  // Redacting a replacement can expose a previous edit. Only a history read can
  // recover that relationship after the replacement's content has been stripped.
  if (
    events.some(
      (event) =>
        event.type !== "m.room.message" || event.unsigned?.redacted_because
    )
  )
    return null;
  const targets = new Set<string>();
  const added: z.infer<typeof MatrixEventSchema>[] = [];
  for (const event of events) {
    const relation = event.content["m.relates_to"];
    if (relation?.rel_type === "m.replace") {
      if (!relation.event_id) return null;
      targets.add(relation.event_id);
    } else {
      if (!event.content.body) return null;
      added.push(event);
      if (relation?.rel_type === "m.thread") {
        if (!relation.event_id) return null;
        targets.add(relation.event_id);
      }
    }
  }
  // Read exact originals for edits and thread counts, with at most four I/O calls in flight.
  const updated: z.infer<typeof MatrixEventSchema>[] = [];
  const ids = [...targets];
  try {
    for (let offset = 0; offset < ids.length; offset += 4) {
      updated.push(
        ...(await Promise.all(
          ids
            .slice(offset, offset + 4)
            .map((id) => readRoomMessage(room, id, true))
        ))
      );
    }
  } catch (error) {
    // A foreign/invalid relation cannot stall the change feed. The caller still
    // rechecks the viewer's room access before requesting history recovery.
    if (error instanceof WorkspaceAccessDenied || error instanceof MatrixError)
      return null;
    throw error;
  }
  const people = await readRoomMembers(actor, room.id, room.kind);
  const config = await matrixConfiguration();
  const project = (event: z.infer<typeof MatrixEventSchema>) =>
    projectMatrixMessage(
      { ...event, room_id: room.roomId },
      people,
      room.matrixId,
      config.botId
    );
  return { added: added.map(project), updated: updated.map(project) };
}
