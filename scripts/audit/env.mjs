/// <reference types="node" />
import { createEnv } from "@t3-oss/env-nextjs";
import { z } from "zod";

export function readAuditEnvironment() {
  // Capture every name before selecting the non-secret CI output metadata.
  const names = Object.keys(process.env);
  const env = createEnv({
    server: { GITHUB_STEP_SUMMARY: z.string().optional() },
    runtimeEnv: { GITHUB_STEP_SUMMARY: process.env.GITHUB_STEP_SUMMARY },
  });
  return { names, summaryPath: env.GITHUB_STEP_SUMMARY };
}
