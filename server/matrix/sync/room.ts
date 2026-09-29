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
import { readRoomMembers } from "../members";
import { updateMatrixPresence } from "../presence";

export async function readMatrixRoomSync(
  actor: z.infer<typeof WorkspaceActorSchema>,
  raw: z.infer<typeof roomSyncReadSchema>
) {
  const input = roomSyncReadSchema.parse(raw);
  if (!actor.authSessionId || actor.groupBindingId || actor.protocolTaskId)
    throw new WorkspaceAccessDenied();
  const previous = await openRoomSyncCursor(actor, input.cursor);
  try {
    const room = await joinMatrixRoom(actor, input.id);
    if (
      previous &&
      (previous.roomId !== room.roomId || previous.epoch !== room.epoch)
    )
      throw new WorkspaceAccessDenied();
    let presencePublishedAt = previous?.presencePublishedAt ?? 0;
    if (Date.now() - presencePublishedAt >= 10000) {
      await updateMatrixPresence(actor, input.id);
      presencePublishedAt = Date.now();
    }
    const members = await readRoomMembers(actor, input.id, room.kind);
    const presenceSenders = members
      .filter((person) => !person.bot && !person.mine)
      .map((person) => person.id);
    const native = await pollNativeSync(
      room.matrixId,
      [room.roomId],
      previous?.nextBatch ?? null,
      "room",
      presenceSenders
    );
    const typingEvent =
      native.rooms?.join?.[room.roomId]?.ephemeral?.events.at(-1);
    const timeline = native.rooms?.join?.[room.roomId]?.timeline;
    const reset =
      !previous ||
      !!timeline?.limited ||
      room.roomId in (native.rooms?.leave ?? {});
    const historyEvents =
      timeline?.events.filter(
        (event) => !["m.reaction", "m.room.pinned_events"].includes(event.type)
      ) ?? [];
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
    // Membership can change while the homeserver is holding the long-poll.
    const authorized = new Set(
      (await readRoomMembers(actor, input.id, current.kind)).map(
        (person) => person.id
      )
    );
    const presence = (native.presence?.events ?? [])
      .filter((event) => authorized.has(event.sender))
      .map((event) => ({ id: event.sender, state: event.content.presence }));
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
      purpose: "matrix-room-sync-v2",
      userId: actor.userId,
      sessionId: actor.authSessionId ?? "",
      workspaceId: actor.workspaceId,
      roomId: room.roomId,
      epoch: room.epoch,
      nextBatch: native.next_batch,
      issuedAt: Date.now(),
      userIds: expiresAt > Date.now() ? userIds : [],
      expiresAt,
      presencePublishedAt,
    });
    return roomSyncPageSchema.parse({
      status: "ready",
      cursor,
      timelineChanged: historyEvents.length > 0,
      reactionsChanged,
      pinsChanged:
        reset ||
        !!timeline?.events.some((event) =>
          ["m.room.pinned_events", "m.room.redaction"].includes(event.type)
        ),
      reset,
      changes,
      userIds: previous && expiresAt > Date.now() ? userIds : [],
      presence: expiresAt > Date.now() ? presence : [],
      expiresAt,
    });
  } catch (error) {
    // A stale cursor still retries. Only a fresh authorization failure ends access.
    const denied = await requireMatrixRoom(actor, input.id).then(
      () => false,
      (currentError: unknown) => {
        if (currentError instanceof WorkspaceAccessDenied) return true;
        throw currentError;
      }
    );
    if (!denied && !(error instanceof MatrixError)) throw error;
    return roomSyncPageSchema.parse({
      status: denied ? "denied" : "unavailable",
      cursor: null,
      timelineChanged: false,
      reactionsChanged: false,
      pinsChanged: false,
      reset: false,
      changes: null,
      userIds: [],
      presence: [],
      expiresAt: 0,
    });
  }
}
