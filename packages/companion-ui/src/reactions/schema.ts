import { z } from "zod";
import emoji from "unicode-emoji-json/data-ordered-emoji.json" with { type: "json" };

const supportedEmoji = new Set<string>(emoji);
const identifier = z.string().min(1).max(200);
export const messageReactionSchema = z.object({
  messageId: identifier,
  emoji: z
    .string()
    .max(32)
    .refine((value) => supportedEmoji.has(value), {
      message: "Choose an emoji from the picker.",
    })
    .nullable(),
});
export const reactionReadSchema = z.object({
  sessionId: identifier,
  messageIds: z.array(identifier).min(1).max(50),
});
export const reactionWriteSchema = messageReactionSchema.extend({
  sessionId: identifier,
});
export const reactionPageSchema = z.array(messageReactionSchema).max(50);

export interface ReactionData {
  read: (
    input: z.infer<typeof reactionReadSchema>
  ) => Promise<z.infer<typeof reactionPageSchema>>;
  set: (
    input: z.infer<typeof reactionWriteSchema>
  ) => Promise<z.infer<typeof messageReactionSchema>>;
}
