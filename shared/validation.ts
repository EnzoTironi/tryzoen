import { z } from "zod";

/** Narrow an untrusted value using its owning schema, without returning a second shape. */
export function isValid<Schema extends z.ZodType>(
  schema: Schema,
  value: unknown
): value is z.output<Schema> {
  return schema.safeParse(value).success;
}

/** Invalid JSON remains a validation failure, including when using safeParse. */
export function jsonString<Schema extends z.ZodType>(schema: Schema) {
  return z
    .string()
    .transform((value, context) => {
      try {
        return JSON.parse(value) as unknown;
      } catch {
        context.addIssue({ code: "custom", message: "Invalid JSON" });
        return z.NEVER;
      }
    })
    .pipe(schema);
}
