import { z } from "zod";

export const installationModelProviderSchema = z.enum([
  "gateway",
  "openrouter-free",
  "codex-local",
]);

export const browserModelProviderSchema = z.enum([
  "gateway",
  "openrouter",
  "codex-local",
]);

export const codexModelSchema = z.enum(["gpt-5.3-codex-spark", "gpt-5.6-luna"]);

export const browserModelSchema = z.enum([
  "meta/muse-spark-1.3",
  "openai/gpt-5-mini",
  ...codexModelSchema.options,
]);
