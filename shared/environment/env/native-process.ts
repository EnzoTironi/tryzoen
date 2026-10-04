import { createEnv } from "@t3-oss/env-nextjs";
import { z } from "zod";

export const nativeProcessEnvironmentShape = { PATH: z.string().optional() };

export function nativeProcessEnvironment() {
  return createEnv({
    server: nativeProcessEnvironmentShape,
    experimental__runtimeEnv: {},
  });
}
