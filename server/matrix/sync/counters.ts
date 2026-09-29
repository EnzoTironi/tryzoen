import { z } from "zod";
import { MatrixError, matrixRequest } from "../client";

export const unreadCountsSchema = z.object({
  notification_count: z.number().int().nonnegative(),
  highlight_count: z.number().int().nonnegative(),
});
const counterPageSchema = z.object({
  next_batch: z.string().max(900),
  rooms: z
    .object({
      join: z
        .record(
          z.string(),
          z.object({
            unread_notifications: unreadCountsSchema.optional(),
          })
        )
        .default({}),
      leave: z.record(z.string(), z.unknown()).default({}),
    })
    .default({ join: {}, leave: {} }),
});

/** Synapse Sliding Sync returns dummy counters; v3 owns real push-rule/receipt counts. */
export async function pollInboxCounters(
  viewer: string,
  roomIds: string[],
  since?: string
) {
  const filter = {
    event_fields: ["event_id", "type"],
    presence: { types: [] },
    account_data: { types: [] },
    room: {
      rooms: roomIds,
      include_leave: true,
      state: { types: [] },
      account_data: { types: [] },
      ephemeral: { types: ["m.receipt"] },
      // An event keeps a room in the incremental response when its count changes.
      timeline: { limit: 1, types: ["m.room.message", "m.room.redaction"] },
    },
  };
  const response = await matrixRequest(
    "GET",
    `sync?device_id=ZOEN_INBOX_BRIDGE_V1&timeout=0&set_presence=offline&filter=${encodeURIComponent(JSON.stringify(filter))}${since ? `&since=${encodeURIComponent(since)}` : ""}`,
    undefined,
    viewer,
    { maxResponseBytes: 1_048_576 }
  );
  const parsed = counterPageSchema.safeParse(response);
  if (!parsed.success) throw new MatrixError({ reason: "unavailable" });
  const rooms = parsed.data.rooms;
  if (
    [...Object.keys(rooms.join), ...Object.keys(rooms.leave)].some(
      (id) => !roomIds.includes(id)
    )
  )
    throw new MatrixError({ reason: "unavailable" });
  return parsed.data;
}
