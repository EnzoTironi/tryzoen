import { z } from "zod";
import { MatrixError, matrixRequest } from "../client";

const nativeSyncSchema = z.object({
  next_batch: z.string().max(4096),
  rooms: z
    .object({
      join: z
        .record(
          z.string(),
          z.object({
            unread_notifications: z
              .object({
                notification_count: z.number().int().nonnegative(),
                highlight_count: z.number().int().nonnegative(),
              })
              .optional(),
            ephemeral: z
              .object({
                events: z
                  .array(
                    z.discriminatedUnion("type", [
                      z.object({
                        type: z.literal("m.typing"),
                        content: z.object({
                          user_ids: z.array(z.string().max(255)).max(100),
                        }),
                      }),
                      z.object({ type: z.literal("m.receipt") }),
                    ])
                  )
                  .max(1),
              })
              .optional(),
            timeline: z
              .object({
                events: z
                  .array(
                    z.looseObject({
                      event_id: z.string(),
                      type: z.string(),
                      room_id: z.string().optional(),
                    })
                  )
                  .max(20),
                limited: z.boolean().optional(),
              })
              .optional(),
          })
        )
        .optional(),
      leave: z.record(z.string(), z.unknown()).optional(),
    })
    .optional(),
});
/** Dedicated server bridge device: never a personal/E2EE device or an exposed access token. */
export async function pollNativeSync(
  viewer: string,
  roomIds: string[],
  since: string | null,
  mode: "inbox" | "room"
) {
  const focused = mode === "room";
  const limit = focused ? 1 : 31;
  if (roomIds.length > limit) throw new MatrixError({ reason: "unavailable" });
  const device = focused ? "ZOEN_ROOM_BRIDGE_V1" : "ZOEN_INBOX_BRIDGE_V1";
  if (!since)
    await matrixRequest(
      "PUT",
      `devices/${device}`,
      {
        display_name: focused ? "Zoen room bridge" : "Zoen server inbox bridge",
      },
      viewer
    );
  const filter = {
    event_fields: focused
      ? [
          "event_id",
          "type",
          "sender",
          "origin_server_ts",
          "content",
          "unsigned",
          "room_id",
          "state_key",
          "redacts",
        ]
      : ["event_id", "type"],
    presence: { types: [] },
    account_data: { types: [] },
    room: {
      rooms: roomIds,
      include_leave: true,
      state: { types: [] },
      account_data: { types: [] },
      ephemeral: { types: focused ? ["m.typing"] : ["m.receipt"] },
      timeline: {
        limit: focused ? 20 : 1,
        types: [
          "m.room.message",
          "m.room.redaction",
          "m.reaction",
          "m.room.member",
        ],
      },
    },
  };
  const response = await matrixRequest(
    "GET",
    `sync?device_id=${device}&timeout=${focused && since ? 10000 : 0}&set_presence=offline&filter=${encodeURIComponent(JSON.stringify(filter))}${since ? `&since=${encodeURIComponent(since)}` : ""}`,
    undefined,
    viewer,
    { maxResponseBytes: focused ? 2_097_152 : 1_048_576 }
  );
  return parseNativeSync(response, roomIds, mode);
}

/** Keep native output validation together, including ephemeral data minimization. */
function parseNativeSync(
  response: unknown,
  roomIds: string[],
  mode: "inbox" | "room"
) {
  const result = nativeSyncSchema.safeParse(response);
  if (!result.success) throw new MatrixError({ reason: "unavailable" });
  const ids = [
    ...Object.keys(result.data.rooms?.join ?? {}),
    ...Object.keys(result.data.rooms?.leave ?? {}),
  ];
  if (ids.length > roomIds.length || ids.some((id) => !roomIds.includes(id)))
    throw new MatrixError({ reason: "unavailable" });
  if (
    Object.entries(result.data.rooms?.join ?? {}).some(
      ([roomId, room]) =>
        (room.timeline?.events.length ?? 0) > (mode === "room" ? 20 : 1) ||
        !!room.timeline?.events.some(
          (event) => event.room_id !== undefined && event.room_id !== roomId
        ) ||
        room.ephemeral?.events.some(
          (event) => event.type !== (mode === "room" ? "m.typing" : "m.receipt")
        )
    )
  )
    throw new MatrixError({ reason: "unavailable" });
  return result.data;
}
