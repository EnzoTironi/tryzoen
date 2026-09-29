import { createHash } from "node:crypto";
import { z } from "zod";
import {
  roomSearchQuerySchema,
  roomSearchPageSchema,
} from "@zoen/companion-ui/rooms";
import {
  type WorkspaceActorSchema,
  WorkspaceAccessDenied,
} from "../workspaces/access";
import { mapAsync } from "../operations/async";
import {
  MatrixEventSchema,
  MatrixError,
  matrixConfiguration,
  matrixRequest,
} from "./client";
import { joinMatrixRoom, requireMatrixRoom } from "./rooms";
import { readRoomMembers } from "./members";
import { readRoomMessage, projectMatrixMessage } from "./messages";
import { openSearchCursor, sealSearchCursor } from "./search/cursor";

const nativePageSchema = z.object({
  search_categories: z.object({
    room_events: z.object({
      results: z.array(z.object({ result: MatrixEventSchema })).max(20),
      next_batch: z.string().min(1).max(4096).optional(),
    }),
  }),
});

/** Search remains native; hydrate only current revisions, never return old indexed bodies. */
export async function searchMatrixMessages(
  actor: z.infer<typeof WorkspaceActorSchema>,
  raw: z.infer<typeof roomSearchQuerySchema>
) {
  const input = roomSearchQuerySchema.parse(raw);
  const room = await joinMatrixRoom(actor, input.id);
  const members = await readRoomMembers(actor, input.id, room.kind);
  if (input.senderId && !members.some((member) => member.id === input.senderId))
    throw new WorkspaceAccessDenied();
  const config = await matrixConfiguration();
  const scope = createHash("sha256")
    .update(
      JSON.stringify([
        actor.userId,
        actor.authSessionId,
        actor.workspaceId,
        config.serverName,
        room.id,
        room.roomId,
        room.epoch,
        input.query,
        input.senderId ?? null,
      ])
    )
    .digest("hex");
  const since = await openSearchCursor(scope, input.cursor);
  const page = nativePageSchema.parse(
    await matrixRequest(
      "POST",
      `search${since ? `?next_batch=${encodeURIComponent(since)}` : ""}`,
      {
        search_categories: {
          room_events: {
            search_term: input.query,
            keys: ["content.body"],
            order_by: "recent",
            filter: {
              rooms: [room.roomId],
              types: ["m.room.message"],
              limit: 20,
              ...(input.senderId ? { senders: [input.senderId] } : {}),
            },
            include_state: false,
            event_context: {
              before_limit: 0,
              after_limit: 0,
              include_profile: false,
            },
          },
        },
      },
      room.matrixId,
      { maxResponseBytes: 1048576 }
    )
  ).search_categories.room_events;
  if (page.results.some((hit) => hit.result.room_id !== room.roomId))
    throw new WorkspaceAccessDenied();
  const items = await mapAsync(
    page.results,
    ({ result }) =>
      hydrateSearchHit(room, result, members, config.botId, input.senderId),
    4
  );
  const access = await requireMatrixRoom(actor, input.id);
  if (access.epoch !== room.epoch || access.roomId !== room.roomId)
    throw new WorkspaceAccessDenied();
  return roomSearchPageSchema.parse({
    items: Array.from(
      new Map(
        items.filter((item) => item !== null).map((item) => [item.id, item])
      ).values()
    ),
    nextCursor:
      page.next_batch && page.next_batch !== since
        ? await sealSearchCursor(scope, page.next_batch)
        : null,
  });
}

async function hydrateSearchHit(
  room: Awaited<ReturnType<typeof joinMatrixRoom>>,
  hit: z.infer<typeof MatrixEventSchema>,
  members: Awaited<ReturnType<typeof readRoomMembers>>,
  botId: string,
  senderId: string | undefined
) {
  const relation = hit.content["m.relates_to"];
  const originalId =
    relation?.rel_type === "m.replace" ? relation.event_id : hit.event_id;
  if (!originalId) return null;
  try {
    const current = await readRoomMessage(room, originalId, true);
    if (current.room_id !== room.roomId) throw new WorkspaceAccessDenied();
    const message = projectMatrixMessage(
      current,
      members,
      room.matrixId,
      botId
    );
    if (
      message.redacted ||
      (message.editId ?? message.id) !== hit.event_id ||
      (senderId && message.senderId !== senderId)
    )
      return null;
    return message;
  } catch (error) {
    if (error instanceof MatrixError && error.reason === "not-found")
      return null;
    throw error;
  }
}
