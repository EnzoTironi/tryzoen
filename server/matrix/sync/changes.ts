import {
  MatrixEventSchema,
  MatrixError,
  matrixConfiguration,
  matrixRequest,
} from "../client";
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
  const batch = collectRoomChanges(events);
  if (!batch) return null;
  const { added, targets, redactedTargets } = batch;
  // Read exact originals for edits and thread counts, with at most four I/O calls in flight.
  const updated: z.infer<typeof MatrixEventSchema>[] = [];
  const ids = [...targets];
  try {
    for (let offset = 0; offset < ids.length; offset += 4) {
      const fetched = await Promise.all(
        ids
          .slice(offset, offset + 4)
          .map((id) =>
            redactedTargets.has(id)
              ? readRedactedTarget(room, id)
              : readRoomMessage(room, id, true)
          )
      );
      updated.push(...fetched.filter((event) => event !== null));
    }
  } catch (error) {
    // A foreign/invalid relation cannot stall the change feed. The caller still
    // rechecks the viewer's room access before requesting history recovery.
    if (error instanceof WorkspaceAccessDenied || error instanceof MatrixError)
      return null;
    throw error;
  }
  if (!added.length && !updated.length) return { added: [], updated: [] };
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

/** A redaction event alone is not proof the homeserver actually removed its target. */
async function readRedactedTarget(
  room: Awaited<ReturnType<typeof joinMatrixRoom>>,
  id: string
) {
  const event = MatrixEventSchema.parse(
    await matrixRequest(
      "GET",
      `rooms/${encodeURIComponent(room.roomId)}/event/${encodeURIComponent(id)}`,
      undefined,
      room.matrixId
    )
  );
  if (
    event.event_id !== id ||
    event.room_id !== room.roomId ||
    event.state_key !== undefined ||
    !event.unsigned?.redacted_because ||
    !["m.room.message", "m.reaction"].includes(event.type)
  )
    throw new WorkspaceAccessDenied();
  // Reaction counts are invalidated by the same sync, without reopening history.
  return event.type === "m.reaction" ? null : event;
}

/** Classify only supported timeline events before any relationship reads. */
function collectRoomChanges(events: z.infer<typeof MatrixEventSchema>[]) {
  if (
    events.some(
      (event) =>
        !["m.room.message", "m.room.redaction"].includes(event.type) ||
        event.state_key !== undefined ||
        !!event.unsigned?.redacted_because
    )
  )
    return null;
  const targets = new Set<string>();
  const redactedTargets = new Set<string>();
  const added: z.infer<typeof MatrixEventSchema>[] = [];
  for (const event of events) {
    if (event.type === "m.room.redaction") {
      const id = event.content.redacts ?? event.redacts;
      if (!id) return null;
      targets.add(id);
      redactedTargets.add(id);
      continue;
    }
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
  return { added, targets, redactedTargets };
}
