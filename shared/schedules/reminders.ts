import { z } from "zod";
import { scheduledConversationChannelSchema } from "./conversation";
import { scheduledReportStatusSchema } from "./report-status";
import { scheduleTimingSchema } from "./timing";
import { scheduledRunOutcomeSchema } from "./outcome";
export const reminderSchema = z.object({
  id: z.string(),
  revision: z.number().int(),
  mayManage: z.boolean(),
  prompt: z.string(),
  timing: scheduleTimingSchema,
  status: z.enum(["active", "paused", "completed"]),
  nextRunAt: z.nullable(z.coerce.date()),
  conversationChannel: scheduledConversationChannelSchema,
  originalSessionId: z.nullable(z.string()),
  latestRunStatus: z.nullable(
    z.enum([
      "queued",
      "running",
      "waiting_for_input",
      "completed",
      "dead_letter",
    ])
  ),
  latestReportStatus: z.nullable(scheduledReportStatusSchema),
  latestScheduledFor: z.nullable(z.coerce.date()),
});

export const remindersPageSchema = z.object({
  reminders: z.array(reminderSchema),
  hasMore: z.boolean(),
});

export const reminderStatusSchema = z.object({
  id: z.uuid(),
  revision: z.number().int().min(0),
  status: z.enum(["active", "paused"]),
});

export const reminderHistoryInputSchema = z.object({
  id: z.uuid(),
  cursor: z.object({ scheduledFor: z.iso.datetime(), id: z.uuid() }).optional(),
});
export const reminderHistorySchema = z.object({
  items: z.array(
    z.object({
      id: z.uuid(),
      scheduledFor: z.coerce.date(),
      status: reminderSchema.shape.latestRunStatus.unwrap(),
      reportStatus: scheduledReportStatusSchema,
      outcome: scheduledRunOutcomeSchema.nullable(),
    })
  ),
  nextCursor: reminderHistoryInputSchema.shape.cursor.unwrap().nullable(),
});
