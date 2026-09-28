import { z } from "zod";

export const feedPostInputSchema = z.strictObject({
  key: z
    .string()
    .trim()
    .min(1)
    .max(160)
    .describe(
      "Stable publication key. Reuse it on retries; use a distinct date for each scheduled edition."
    ),
  title: z.string().trim().min(1).max(180),
  content: z
    .string()
    .trim()
    .min(1)
    .max(20000)
    .describe(
      "Finished Markdown post. Distinguish verified facts from interpretation. Never claim access to sources you have not read."
    ),
  rationale: z
    .string()
    .trim()
    .min(1)
    .max(2000)
    .describe(
      "Why this post is relevant to the user, grounded in their request or authorized context."
    ),
  sources: z
    .array(
      z.strictObject({
        title: z.string().trim().min(1).max(180),
        url: z
          .url()
          .max(2048)
          .refine(
            (url) => new URL(url).protocol === "https:",
            "Sources must use HTTPS"
          ),
      })
    )
    .max(12),
});
export const feedPostSchema = feedPostInputSchema.omit({ key: true }).extend({
  id: z.uuid(),
  createdAt: z.iso.datetime(),
  liked: z.boolean(),
});
export const feedCursorSchema = z.object({
  createdAt: z.iso.datetime(),
  id: z.uuid(),
});
export const feedPageSchema = z.object({
  items: z.array(feedPostSchema),
  nextCursor: feedCursorSchema.nullable(),
});

export const feedInstructionsSchema = z.object({
  content: z.string().max(20000),
  revision: z.number().int().nonnegative(),
});
