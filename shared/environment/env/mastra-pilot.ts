import { createEnv } from "@t3-oss/env-nextjs";
import { z } from "zod";

export const mastraPilotEnvironmentShape = {
  ZOEN_MASTRA_PILOT_ENABLED: z
    .enum(["true", "false"])
    .default("false")
    .transform((value) => value === "true"),
  ZOEN_MASTRA_PILOT_MODEL: z.string().min(1).default("gpt-5.6-luna"),
};
export function mastraPilotEnvironment() {
  return createEnv({
    server: mastraPilotEnvironmentShape,
    experimental__runtimeEnv: {},
    emptyStringAsUndefined: true,
  });
}
