import { z } from "zod";

export const scheduledReportStatusSchema = z.enum([
  "not_ready",
  "not_needed",
  "pending",
  "queued",
  "delivered",
  "suppressed",
  "failed",
  "cancelled",
  "uncertain",
]);
