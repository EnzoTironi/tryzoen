import { z } from "zod";
import {
  SemanticArgumentsSchema,
  SemanticIdentifierSchema,
  SemanticNumberSchema,
  SemanticColumnSchema,
} from "@zoen/companion-ui/semantic-query";

export const semanticLimits = {
  inputBytes: 1_048_576,
  resultBytes: 65_536,
  rows: 100,
  deadlineMs: 15_000,
  concurrent: 2,
  memoryBytes: 1_610_612_736,
} as const;

const columns = z
  .array(SemanticColumnSchema)
  .min(1)
  .max(30)
  .refine(
    (value) => new Set(value.map((column) => column.name)).size === value.length
  );
const cell = z.union([
  z.string().max(4096),
  SemanticNumberSchema,
  z.boolean(),
  z.null(),
]);
export const SemanticSnapshotSchema = z.strictObject({
  model: z.string().min(1).max(262_144),
  query: SemanticIdentifierSchema,
  arguments: SemanticArgumentsSchema,
  tables: z
    .array(
      z
        .strictObject({
          name: SemanticIdentifierSchema,
          columns,
          rows: z.array(z.array(cell).max(30)).max(2000),
        })
        .refine((value) =>
          value.rows.every((row) => row.length === value.columns.length)
        )
    )
    .min(1)
    .max(6)
    .refine(
      (value) =>
        new Set(value.map((source) => source.name)).size === value.length
    ),
});
export const SemanticResultSchema = z.strictObject({
  sql: z.string(),
  rows: z.array(z.record(z.string(), z.json())).max(semanticLimits.rows),
});
