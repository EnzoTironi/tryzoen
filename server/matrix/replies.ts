import { MatrixEventSchema, matrixRequest, MatrixError } from "./client";

/** Keep agent replies and approval cards in the thread that requested them. */
export async function matrixReplyRelation(
  roomId: string,
  eventId: string,
  userId?: string
) {
  const event = MatrixEventSchema.parse(
    await matrixRequest(
      "GET",
      `rooms/${encodeURIComponent(roomId)}/event/${encodeURIComponent(eventId)}`,
      undefined,
      userId
    )
  );
  if (event.event_id !== eventId)
    throw new MatrixError({ reason: "forbidden" });
  const relation = event.content["m.relates_to"];
  return {
    "m.in_reply_to": { event_id: eventId },
    ...(relation?.rel_type === "m.thread" && relation.event_id
      ? {
          rel_type: "m.thread",
          event_id: relation.event_id,
          is_falling_back: true,
        }
      : {}),
  };
}
