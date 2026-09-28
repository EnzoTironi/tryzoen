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
            ephemeral: z
              .object({
                events: z
                  .array(
                    z.object({
                      type: z.literal("m.typing"),
                      content: z.object({
                        user_ids: z.array(z.string().max(255)).max(100),
                      }),
                    })
                  )
                  .max(1),
              })
              .optional(),
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
export async function pollNativeSync(
  viewer: string,
  roomIds: string[],
  since: string | null,
  mode: "inbox" | "typing"
) {
  const typing = mode === "typing";
  const limit = typing ? 1 : 31;
  if (roomIds.length > limit) throw new MatrixError({ reason: "unavailable" });
  const device = typing ? "ZOEN_TYPING_BRIDGE_V1" : "ZOEN_INBOX_BRIDGE_V1";
  if (!since)
    await matrixRequest(
      "PUT",
      `devices/${device}`,
      {
        display_name: typing
          ? "Zoen typing bridge"
          : "Zoen server inbox bridge",
      },
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
      ephemeral: { types: typing ? ["m.typing"] : [] },
      timeline: {
        limit: 1,
        types: typing
          ? []
          : [
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
    `sync?device_id=${device}&timeout=${typing && since ? 10000 : 0}&set_presence=offline&filter=${encodeURIComponent(JSON.stringify(filter))}${since ? `&since=${encodeURIComponent(since)}` : ""}`,
    undefined,
    viewer,
    { maxResponseBytes: typing ? 65536 : 1_048_576 }
  );
  const result = nativeSyncSchema.safeParse(response);
  if (!result.success) throw new MatrixError({ reason: "unavailable" });
  const ids = [
    ...Object.keys(result.data.rooms?.join ?? {}),
    ...Object.keys(result.data.rooms?.leave ?? {}),
  ];
  if (ids.length > limit || ids.some((id) => !roomIds.includes(id)))
    throw new MatrixError({ reason: "unavailable" });
  return result.data;
}
