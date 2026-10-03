import { createEnv } from "@t3-oss/env-nextjs";
import { z } from "zod";
import { Secret } from "../secret";

const credential = z
  .string()
  .min(1)
  .refine((value) => value === value.trim(), "Expected an unpadded credential")
  .transform((value) => new Secret(value));

export const r2QualificationEnvironmentShape = {
  ZOEN_R2_QUALIFICATION_ACCESS_KEY: credential.optional(),
  ZOEN_R2_QUALIFICATION_SECRET_KEY: credential.optional(),
  ZOEN_R2_QUALIFICATION_SESSION_TOKEN: credential.optional(),
  ZOEN_R2_QUALIFICATION_API_TOKEN: credential.optional(),
};

/** This maintenance command receives no application or database credentials. */
export function r2QualificationEnvironment() {
  return createEnv({
    server: r2QualificationEnvironmentShape,
    experimental__runtimeEnv: {},
    emptyStringAsUndefined: true,
    onValidationError: () => {
      throw new Error("Invalid R2 qualification credential environment");
    },
  });
}
