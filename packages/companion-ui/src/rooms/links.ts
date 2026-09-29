import type { z } from "zod";
import { roomMediaReadSchema, roomSchema } from "./schema";

/** A locator, never a capability: the destination still authorizes every read. */
export const roomMessageLocationSchema = roomMediaReadSchema.extend({
  workspaceId: roomSchema.shape.workspaceId,
});

export function roomMessageUrl(
  origin: string,
  input: z.infer<typeof roomMessageLocationSchema>
) {
  const location = roomMessageLocationSchema.parse(input);
  const url = new URL("/companion", origin);
  if (
    url.username ||
    url.password ||
    !(
      url.protocol === "https:" ||
      (url.protocol === "http:" &&
        ["localhost", "127.0.0.1", "[::1]"].includes(url.hostname))
    )
  )
    throw new Error("Message links require a trusted application origin.");
  url.search = new URLSearchParams({
    room: location.id,
    message: location.messageId,
    space: location.workspaceId,
  }).toString();
  return url.href;
}

export function parseRoomMessageLocation(
  params: Pick<URLSearchParams, "get" | "getAll">
) {
  if (
    ["room", "message", "space"].some((key) => params.getAll(key).length !== 1)
  )
    return undefined;
  const parsed = roomMessageLocationSchema.safeParse({
    id: params.get("room"),
    messageId: params.get("message"),
    workspaceId: params.get("space"),
  });
  return parsed.success ? parsed.data : undefined;
}
