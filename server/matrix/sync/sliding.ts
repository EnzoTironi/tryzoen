import { randomUUID } from "node:crypto";
import { z } from "zod";
import { MatrixError, matrixRequest } from "../client";

const positionSchema = z.object({
  connection: z.uuid(),
  position: z.string().max(3500),
});
const eventSchema = z.object({
  event_id: z.string(),
  type: z.string(),
  room_id: z.string().optional(),
});
const responseSchema = z.object({
  pos: positionSchema.shape.position,
  rooms: z
    .record(
      z.string(),
      z.object({
        notification_count: z.number().int().nonnegative().optional(),
        highlight_count: z.number().int().nonnegative().optional(),
        required_state: z
          .array(
            z.object({
              type: z.literal("m.room.member"),
              state_key: z.string(),
              content: z.object({ membership: z.string() }),
            })
          )
          .max(1)
          .optional(),
        timeline: z.array(eventSchema).max(1).optional(),
        limited: z.boolean().optional(),
      })
    )
    .default({}),
  extensions: z
    .object({
      account_data: z
        .object({
          rooms: z
            .record(
              z.string(),
              z
                .array(z.object({ type: z.string(), content: z.unknown() }))
                .max(100)
            )
            .default({}),
        })
        .optional(),
    })
    .optional(),
});

/** One bounded native subscription for the visible inbox. No per-room marker requests. */
export async function pollSlidingInbox(
  viewer: string,
  roomIds: string[],
  since: string | null
) {
  let previous: z.infer<typeof positionSchema> | null = null;
  if (since) {
    try {
      previous = positionSchema.parse(JSON.parse(since));
    } catch {
      /* Unusable native positions start a fresh, bounded subscription. */
    }
  }
  let connection = previous?.connection ?? randomUUID();
  const request = () =>
    matrixRequest(
      "POST",
      `sync?device_id=ZOEN_INBOX_BRIDGE_V1&timeout=0${previous ? `&pos=${encodeURIComponent(previous.position)}` : ""}`,
      {
        conn_id: connection,
        room_subscriptions: Object.fromEntries(
          roomIds.map((id) => [
            id,
            { required_state: [["m.room.member", "$ME"]], timeline_limit: 1 },
          ])
        ),
        extensions: {
          account_data: { enabled: true, lists: [], rooms: roomIds },
        },
      },
      viewer,
      {
        version: "unstable/org.matrix.simplified_msc3575",
        maxResponseBytes: 1_048_576,
      }
    );
  let response: unknown;
  try {
    response = await request();
  } catch (error) {
    if (
      !previous ||
      !(error instanceof MatrixError) ||
      error.reason !== "expired-position"
    )
      throw error;
    previous = null;
    connection = randomUUID();
    response = await request();
  }
  const parsed = responseSchema.safeParse(response);
  if (!parsed.success) throw new MatrixError({ reason: "unavailable" });
  const native = parsed.data;
  const accountData = native.extensions?.account_data?.rooms ?? {};
  const ids = [
    ...new Set([...Object.keys(native.rooms), ...Object.keys(accountData)]),
  ];
  if (ids.some((id) => !roomIds.includes(id)))
    throw new MatrixError({ reason: "unavailable" });
  const left = ids.filter((id) =>
    native.rooms[id]?.required_state?.some(
      (event) =>
        event.state_key === viewer && event.content.membership !== "join"
    )
  );
  return {
    next_batch: JSON.stringify({ connection, position: native.pos }),
    rooms: {
      leave: Object.fromEntries(left.map((id) => [id, {}])),
      join: Object.fromEntries(
        ids
          .filter((id) => !left.includes(id))
          .map((id) => {
            const room = native.rooms[id];
            const marker = accountData[id]?.find(
              (event) => event.type === "m.marked_unread"
            );
            return [
              id,
              {
                ...(room?.notification_count !== undefined &&
                room.highlight_count !== undefined
                  ? {
                      unread_notifications: {
                        notification_count: room.notification_count,
                        highlight_count: room.highlight_count,
                      },
                    }
                  : {}),
                account_data: {
                  events: marker
                    ? [marker]
                    : !previous
                      ? [
                          {
                            type: "m.marked_unread",
                            content: { unread: false },
                          },
                        ]
                      : [],
                },
                timeline: {
                  events: room?.timeline ?? [],
                  limited: !previous || room?.limited,
                },
              },
            ];
          })
      ),
    },
  };
}
