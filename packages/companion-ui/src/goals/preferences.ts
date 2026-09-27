import { z } from "zod";

export const goalPreferencesSchema = z.object({
  showSubtitles: z.boolean().default(true),
  sortAutomatically: z.boolean().default(true),
});

export const goalPreferenceChangeSchema = z.strictObject({
  key: goalPreferencesSchema.keyof(),
  value: z.boolean(),
});
