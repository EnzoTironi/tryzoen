import { z } from "zod";

export const ideaProposalSchema = z.strictObject({
  key: z
    .string()
    .regex(/^[a-z0-9]+(?:-[a-z0-9]+)*$/)
    .max(100)
    .describe(
      "Stable topic key. Reuse it for the same proposal; never rename a dismissed idea to reintroduce it."
    ),
  title: z.string().trim().min(1).max(160),
  description: z.string().trim().min(1).max(2000),
  rationale: z
    .string()
    .trim()
    .min(1)
    .max(1000)
    .describe(
      "Why this is relevant, grounded in information the user actually provided. Never invent account access or evidence."
    ),
  category: z.enum([
    "Productivity",
    "Health and fitness",
    "Shopping",
    "Relationships",
    "Finance",
    "Learning",
    "Other",
  ]),
  emoji: z.string().trim().min(1).max(16),
  prompt: z
    .string()
    .trim()
    .min(1)
    .max(4000)
    .describe(
      "Self-contained task to execute only after the user chooses Let's go. Preserve approval requirements for external actions."
    ),
});

export const ideaStatusSchema = z.enum([
  "suggested",
  "starting",
  "running",
  "waiting",
  "finished",
  "failed",
  "cancelled",
]);
export const ideaFeedbackSchema = z.enum(["more", "dismissed"]);
export const ideaSchema = ideaProposalSchema.extend({
  id: z.uuid(),
  status: ideaStatusSchema,
  feedback: ideaFeedbackSchema.nullable(),
  sessionId: z.string().nullable(),
  createdAt: z.iso.datetime(),
});
export const ideaCursorSchema = z.object({
  createdAt: z.iso.datetime(),
  id: z.uuid(),
});
export const ideaPageSchema = z.object({
  items: z.array(ideaSchema),
  nextCursor: ideaCursorSchema.nullable(),
});
export const ideaFeedbackInputSchema = z.strictObject({
  id: z.uuid(),
  feedback: ideaFeedbackSchema,
});

export const ideaStatusLabels = {
  suggested: "Suggested",
  starting: "Starting",
  running: "Working on it",
  waiting: "Waiting for you",
  finished: "Response ready",
  failed: "Needs attention",
  cancelled: "Stopped",
} satisfies Record<z.infer<typeof ideaStatusSchema>, string>;
