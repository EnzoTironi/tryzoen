import { z } from "zod";
import { Secret } from "../secret";
import { createEnv } from "@t3-oss/env-nextjs";

const endpoint = z.url().refine((value) => {
  const url = new URL(value);
  return (
    !url.username &&
    !url.password &&
    !url.search &&
    !url.hash &&
    url.pathname === "/" &&
    (url.protocol === "https:" ||
      (url.protocol === "http:" &&
        ["localhost", "127.0.0.1", "[::1]"].includes(url.hostname)))
  );
}, "Use HTTPS, or loopback HTTP, with no path or credentials");
export const semanticEnvironmentShape = {
  ZOEN_SEMANTIC_URLS: z
    .string()
    .transform((value) =>
      z
        .array(endpoint)
        .min(1)
        .max(2)
        .parse(value.split(","))
        .map((url) => new URL(url).href)
    )
    .refine((value) => new Set(value).size === value.length)
    .optional(),
  ZOEN_SEMANTIC_TOKEN: z
    .string()
    .regex(/^[A-Za-z0-9_-]{32,128}$/)
    .transform((value) => new Secret(value))
    .optional(),
};

/** The dedicated executor receives no application environment or credentials. */
export function semanticServiceEnvironment() {
  return createEnv({
    server: {
      ZOEN_SEMANTIC_TOKEN:
        semanticEnvironmentShape.ZOEN_SEMANTIC_TOKEN.unwrap(),
      ZOEN_SEMANTIC_PORT: z.coerce
        .number()
        .int()
        .min(1)
        .max(65535)
        .default(18130),
    },
    experimental__runtimeEnv: {},
    emptyStringAsUndefined: true,
  });
}
