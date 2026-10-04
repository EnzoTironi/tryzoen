import { createEnv } from "@t3-oss/env-nextjs";
import { isAbsolute } from "node:path";
import { z } from "zod";

const fixturePath = z.string().min(1).refine(isAbsolute).optional();

export const fixtureEnvironment = createEnv({
  server: {
    ZOEN_STORAGE_FIXTURE: fixturePath,
    ZOEN_STORAGE_EVIDENCE: fixturePath,
  },
  experimental__runtimeEnv: {},
  emptyStringAsUndefined: true,
});
