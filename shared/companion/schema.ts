import { z } from "zod";
import { saveWorkstreamSchema } from "../workstreams/schema";
import { scheduledRunOutcomeSchema } from "../schedules/outcome";

export const companionChatsSchema = z.object({
  items: z.array(
    z.object({
      sessionId: z.string(),
      title: z.string(),
      updatedAt: z.iso.datetime(),
    })
  ),
  nextCursor: z
    .object({ updatedAt: z.iso.datetime(), sessionId: z.string() })
    .nullable(),
});
export const companionGoalsSchema = z.array(
  z.object({
    id: z.string(),
    scopeKey: z.string(),
    revision: z.number().int(),
    content: saveWorkstreamSchema.shape.content.nullable(),
    sessionId: z.string().nullable(),
  })
);
export const companionFeedSchema = z.object({
  items: z.array(
    z.object({
      id: z.string(),
      title: z.string(),
      outcome: scheduledRunOutcomeSchema,
      date: z.iso.datetime(),
      sessionId: z.string().nullable(),
    })
  ),
  nextCursor: z.object({ date: z.iso.datetime(), id: z.string() }).nullable(),
});
export const companionFilesSchema = z.object({
  revision: z.string().nullable(),
  content: z.string().nullable().optional(),
  files: z.array(z.string()),
});

export const companionIdentitySchema = z.object({
  revision: companionFilesSchema.shape.revision,
  canEdit: z.boolean(),
  documents: z
    .array(z.object({ path: z.string(), content: z.string() }))
    .max(3),
});
