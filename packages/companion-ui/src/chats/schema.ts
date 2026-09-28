import { z } from "zod";

const sessionId = z.string().min(1).max(200);
export const chatTitleSchema = z.string().trim().min(1).max(240);
const cursorSchema = z.object({
  pinned: z.boolean(),
  updatedAt: z.iso.datetime(),
  sessionId,
});
export const chatQuerySchema = z.object({
  query: z.string().trim().max(200).default(""),
  archived: z.boolean().default(false),
  cursor: cursorSchema.nullish(),
});
export const chatPageSchema = z.object({
  items: z
    .array(
      z.object({
        sessionId,
        title: z.string(),
        updatedAt: z.iso.datetime(),
        pinned: z.boolean(),
        archived: z.boolean(),
      })
    )
    .max(30),
  nextCursor: cursorSchema.nullable(),
});
export const chatChangeSchema = z.object({
  sessionId,
  change: z.union([
    z.strictObject({ title: chatTitleSchema }),
    z.strictObject({ pinned: z.boolean() }),
    z.strictObject({ archived: z.boolean() }),
  ]),
});
export interface ChatData {
  list: (
    input: z.input<typeof chatQuerySchema>
  ) => Promise<z.infer<typeof chatPageSchema>>;
  change: (input: z.infer<typeof chatChangeSchema>) => Promise<void>;
}
