import { z } from "zod";
import { MatrixError, matrixRequest } from "../client";
import { pollSlidingInbox } from "./sliding";

const nativeSyncSchema = z.object({
  next_batch: z.string().max(4096),
  presence: z
    .object({
      events: z
        .array(
          z.object({
            type: z.literal("m.presence"),
            sender: z.string().max(255),
            content: z.object({
              presence: z.enum(["online", "unavailable", "offline"]),
            }),
          })
        )
        .max(100),
    })
    .optional(),
  rooms: z
    .object({
      join: z
        .record(
          z.string(),
          z.object({
            account_data: z
              .object({
                events: z
                  .array(
                    z.object({
                      type: z.literal("m.marked_unread"),
                      content: z.object({ unread: z.boolean() }),
                    })
                  )
                  .max(1),
              })
              .optional(),
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
  mode: "inbox" | "room",
  presenceSenders: string[] = []
) {
  const focused = mode === "room";
  const limit = focused ? 1 : 31;
  if (roomIds.length > limit) throw new MatrixError({ reason: "unavailable" });
  if (presenceSenders.length > 100 || (!focused && presenceSenders.length))
    throw new MatrixError({ reason: "unavailable" });
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
  if (!focused)
    return parseNativeSync(
      await pollSlidingInbox(viewer, roomIds, since),
      roomIds,
      mode,
      []
    );
  const filter = {
    event_fields: [
      "event_id",
      "type",
      "sender",
      "origin_server_ts",
      "content",
      "unsigned",
      "room_id",
      "state_key",
      "redacts",
    ],
    presence: presenceSenders.length
      ? { types: ["m.presence"], senders: presenceSenders, limit: 100 }
      : { types: [] },
    account_data: { types: [] },
    room: {
      rooms: roomIds,
      include_leave: true,
      state: { types: [] },
      account_data: { types: [] },
      ephemeral: { types: ["m.typing"] },
      timeline: {
        limit: 20,
        types: [
          "m.room.message",
          "m.room.redaction",
          "m.reaction",
          "m.room.member",
          "m.room.name",
          "m.room.pinned_events",
        ],
      },
    },
  };
  const response = await matrixRequest(
    "GET",
    `sync?device_id=${device}&timeout=${since ? 10000 : 0}&set_presence=offline&filter=${encodeURIComponent(JSON.stringify(filter))}${since ? `&since=${encodeURIComponent(since)}` : ""}`,
    undefined,
    viewer,
    { maxResponseBytes: 2_097_152 }
  );
  return parseNativeSync(response, roomIds, mode, presenceSenders);
}

/** Keep native output validation together, including ephemeral data minimization. */
function parseNativeSync(
  response: unknown,
  roomIds: string[],
  mode: "inbox" | "room",
  presenceSenders: string[]
) {
  const result = nativeSyncSchema.safeParse(response);
  if (!result.success) throw new MatrixError({ reason: "unavailable" });
  if (
    result.data.presence?.events.some(
      (event) => !presenceSenders.includes(event.sender)
    )
  )
    throw new MatrixError({ reason: "unavailable" });
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
