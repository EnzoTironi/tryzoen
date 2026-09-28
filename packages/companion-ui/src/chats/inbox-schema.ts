import { z } from "zod";
import { chatPageSchema } from "./schema";
import { roomSchema } from "../rooms/schema";

export const inboxCursorSchema = z.object({
  activityAt: z.number().int().nonnegative(),
  kind: z.enum(["agent", "room"]),
  id: z.string().min(1).max(255),
});
export const inboxQuerySchema = z.object({
  query: z.string().trim().max(200).default(""),
  filter: z.enum(["all", "people", "groups", "bots"]).default("all"),
  archived: z.boolean().default(false),
  cursor: inboxCursorSchema.nullish(),
});
export const inboxItemSchema = z.discriminatedUnion("kind", [
  z.object({
    kind: z.literal("agent"),
    activityAt: z.number().int().nonnegative(),
    chat: chatPageSchema.shape.items.element,
  }),
  z.object({
    kind: z.literal("room"),
    activityAt: z.number().int().nonnegative(),
    room: roomSchema,
    preview: z.string().nullable(),
    unread: z.number().int().nonnegative().nullable(),
    summaryState: z.enum(["ready", "pending", "unavailable"]),
  }),
]);
export const inboxPageSchema = z.object({
  items: z.array(inboxItemSchema).max(30),
  pinned: chatPageSchema.shape.items.max(6),
  nextCursor: inboxCursorSchema.nullable(),
  configured: z.boolean(),
  mayManage: z.boolean(),
  syncPending: z.boolean(),
});
export interface InboxData {
  list: (
    input: z.input<typeof inboxQuerySchema>
  ) => Promise<z.infer<typeof inboxPageSchema>>;
}
