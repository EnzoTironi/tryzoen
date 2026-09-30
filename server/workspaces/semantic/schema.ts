import { z } from "zod";
import { GitRevisionSchema } from "@zoen/companion-ui/workspace-files";
import {
  SemanticArgumentsSchema,
  SemanticIdentifierSchema as name,
} from "@zoen/companion-ui/semantic-query";
import { SemanticColumnSchema } from "./snapshot";
export const SemanticQuerySchema = z.strictObject({
  path: z.string().regex(/^knowledge\/queries\/[a-z][a-z0-9_-]{0,39}\.json$/),
  revision: GitRevisionSchema,
  arguments: SemanticArgumentsSchema.default({}),
});
export const SemanticDefinitionSchema = z.strictObject({
  version: z.literal(1),
  model: z
    .string()
    .regex(/^knowledge\/models\/[a-zA-Z0-9][a-zA-Z0-9_./-]{0,180}\.malloy$/)
    .refine((path) => !path.includes("..") && !path.includes("//")),
  query: name,
  parameters: z
    .record(name, z.enum(["string", "number", "boolean"]))
    .refine((value) => Object.keys(value).length <= 20),
  sources: z
    .array(
      z.strictObject({
        name,
        path: z.string().regex(/^knowledge\/data\/[a-z][a-z0-9_-]{0,39}\.csv$/),
        columns: z
          .array(SemanticColumnSchema)
          .min(1)
          .max(30)
          .refine(
            (columns) =>
              new Set(columns.map((column) => column.name)).size ===
              columns.length
          ),
      })
    )
    .min(1)
    .max(6)
    .refine(
      (sources) =>
        new Set(sources.map((source) => source.name)).size === sources.length
    ),
});
