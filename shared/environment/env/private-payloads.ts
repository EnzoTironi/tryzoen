import { z } from "zod";
import { createEnv } from "@t3-oss/env-nextjs";
import { databaseUrlSchema } from "../database-url";
import { Secret } from "../secret";

const required = z
  .string()
  .min(1)
  .refine((value) => value === value.trim());

export const privatePayloadEnvironmentShape = {
  ZOEN_PAYLOAD_ENDPOINT: z
    .url()
    .refine((value) => {
      const url = new URL(value);
      return (
        url.username === "" &&
        url.password === "" &&
        url.search === "" &&
        url.hash === "" &&
        url.pathname === "/" &&
        ((url.protocol === "https:" &&
          /^[a-f0-9]{32}\.r2\.cloudflarestorage\.com$/u.test(url.hostname)) ||
          (url.protocol === "http:" && url.hostname === "127.0.0.1"))
      );
    })
    .optional(),
  ZOEN_PAYLOAD_BUCKET: required.optional(),
  ZOEN_PAYLOAD_PREFIX: required.default("zoen/payloads/v1"),
  ZOEN_PAYLOAD_ACCESS_KEY: required
    .transform((value) => new Secret(value))
    .optional(),
  ZOEN_PAYLOAD_SECRET_KEY: required
    .transform((value) => new Secret(value))
    .optional(),
};

/** The isolated migrator needs payload credentials without loading the web
 * app's auth, model or runtime database environment. */
export function privatePayloadEnvironment() {
  return createEnv({
    server: {
      ...privatePayloadEnvironmentShape,
      DATABASE_URL: databaseUrlSchema.optional(),
      DATABASE_URL_UNPOOLED: databaseUrlSchema.optional(),
    },
    experimental__runtimeEnv: {},
    emptyStringAsUndefined: true,
    onValidationError: () => {
      throw new Error("Invalid private payload environment");
    },
  });
}
