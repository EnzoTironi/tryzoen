import { z } from "zod";

const reactionTypeSchema = z.enum([
  "thumbs_up",
  "thumbs_down",
  "heart",
  "laugh",
  "exclamation",
  "question",
]);

export const reactToMessageOutputSchema = z.strictObject({
  operation: z.enum(["add", "remove"]).default("add"),
  type: reactionTypeSchema,
});
export const addReactionToMessageOutputSchema = z.strictObject({
  operation: z.literal("add").default("add"),
  type: reactionTypeSchema,
});

const reactionText = {
  exclamation: "‼️",
  heart: "❤️",
  laugh: "😂",
  question: "❓",
  thumbs_down: "👎",
  thumbs_up: "👍",
} as const satisfies Record<z.output<typeof reactionTypeSchema>, string>;
export function reactionTextFor(type: z.output<typeof reactionTypeSchema>) {
  return reactionText[type];
}
export const reactToMessageToolResultSchema = z.object({
  kind: z.literal("tool-result"),
  output: reactToMessageOutputSchema,
  toolName: z.literal("react_to_message"),
});
