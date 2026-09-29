import { z } from "zod";

export const activityKindSchema = z.enum([
  "turn.completed",
  "turn.failed",
  "turn.cancelled",
  "session.failed",
  "approval.candidate",
  "approval.settled",
]);
export const activityCursorSchema = z.object({
  at: z.iso.datetime({ precision: 6 }),
  id: z.string().min(1).max(512),
});
export const activityQuerySchema = z.object({
  approvals: z.boolean().default(false),
  cursor: activityCursorSchema.nullish(),
});
export const activityItemSchema = z.object({
  id: z.string(),
  sessionId: z.string(),
  title: z.string(),
  kind: activityKindSchema,
  at: z.iso.datetime({ precision: 6 }),
});
export const activityPageSchema = z.object({
  items: z.array(activityItemSchema).max(30),
  nextCursor: activityCursorSchema.nullable(),
});
export interface ActivityData {
  activity: (
    input: z.input<typeof activityQuerySchema>,
    signal?: AbortSignal
  ) => Promise<z.infer<typeof activityPageSchema>>;
}
