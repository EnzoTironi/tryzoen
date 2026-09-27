import { z } from "zod";
import { scheduledConversationChannelSchema } from "./conversation";
import { scheduledReportStatusSchema } from "./report-status";
export const reminderSchema = z.object({
  id: z.string(),
  revision: z.number().int(),
  mayManage: z.boolean(),
  prompt: z.string(),
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
