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
            timeline: z
              .object({
                events: z
                  .array(z.object({ event_id: z.string(), type: z.string() }))
                  .max(1),
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
export async function pollNativeInbox(
  viewer: string,
  roomIds: string[],
  since: string | null
) {
  const device = "ZOEN_INBOX_BRIDGE_V1";
  if (!since)
    await matrixRequest(
      "PUT",
      `devices/${device}`,
      { display_name: "Zoen server inbox bridge" },
      viewer
    );
  const filter = {
    presence: { types: [] },
    account_data: { types: [] },
    room: {
      rooms: roomIds,
      include_leave: true,
      state: { types: [] },
      account_data: { types: [] },
      ephemeral: { types: [] },
      timeline: {
        limit: 1,
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
    `sync?device_id=${device}&timeout=0&set_presence=offline&filter=${encodeURIComponent(JSON.stringify(filter))}${since ? `&since=${encodeURIComponent(since)}` : ""}`,
    undefined,
    viewer,
    { maxResponseBytes: 1_048_576 }
  );
  const result = nativeSyncSchema.safeParse(response);
  if (!result.success) throw new MatrixError({ reason: "unavailable" });
  const ids = [
    ...Object.keys(result.data.rooms?.join ?? {}),
    ...Object.keys(result.data.rooms?.leave ?? {}),
  ];
  if (ids.length > 31 || ids.some((id) => !roomIds.includes(id)))
    throw new MatrixError({ reason: "unavailable" });
  return result.data;
}
