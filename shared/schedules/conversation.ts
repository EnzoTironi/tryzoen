import { z } from "zod";

export const scheduledConversationChannelSchema = z.enum([
  "eve",
  "linq",
  "telegram",
  "kapso",
]);
