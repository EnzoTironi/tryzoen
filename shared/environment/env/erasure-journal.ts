import { createEnv } from "@t3-oss/env-nextjs";
import { z } from "zod";
import { Secret } from "../secret";

const credential = z
  .string()
  .min(1)
  .transform((value) => new Secret(value));

export const erasureJournalEnvironmentShape = {
  ZOEN_ERASURE_JOURNAL_BUCKET: z
    .string()
    .refine((value) => value.trim().length > 0)
    .optional(),
  ZOEN_ERASURE_JOURNAL_ENDPOINT: z
    .url()
    .default("https://fly.storage.tigris.dev"),
  ZOEN_ERASURE_JOURNAL_ACCESS_KEY: credential.optional(),
  ZOEN_ERASURE_JOURNAL_SECRET_KEY: credential.optional(),
};

export function erasureJournalEnvironment() {
  return createEnv({
    server: erasureJournalEnvironmentShape,
    experimental__runtimeEnv: {},
    emptyStringAsUndefined: true,
    onValidationError: () => {
      throw new Error("Invalid erasure journal environment");
    },
  });
}
