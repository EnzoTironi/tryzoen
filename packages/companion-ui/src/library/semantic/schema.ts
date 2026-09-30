import { z } from "zod";
import { WorkspacePathSchema, GitRevisionSchema } from "../files-schema";

export const SemanticIdentifierSchema = z
  .string()
  .regex(/^[a-z][a-z0-9_]{0,39}$/);
export const SemanticColumnSchema = z.strictObject({
  name: SemanticIdentifierSchema,
  type: z.enum(["text", "numeric", "boolean", "date"]),
});

export const SemanticNumberSchema = z
  .number()
  .refine(
    (value) => !Number.isInteger(value) || Number.isSafeInteger(value),
    "Unsafe integer; use an exact published numeric snapshot instead"
  );
export const SemanticArgumentsSchema = z
  .record(
    SemanticIdentifierSchema,
    z.union([z.string().max(4096), SemanticNumberSchema, z.boolean()])
  )
  .refine((value) => Object.keys(value).length <= 20);

const hash = z.string().regex(/^[a-f0-9]{64}$/);
export const SemanticQueryResultSchema = z.strictObject({
  rows: z.array(z.record(z.string(), z.json())).max(100),
  manifest: z.strictObject({
    id: z.uuid(),
    engine: z.string().min(1).max(100),
    inputSha256: hash,
    sqlSha256: hash,
    startedAt: z.iso.datetime(),
    completedAt: z.iso.datetime(),
    actor: z.string().min(1).max(200),
    workspaceId: z.string().min(1).max(200),
    revision: GitRevisionSchema,
    query: WorkspacePathSchema,
    arguments: SemanticArgumentsSchema,
    sql: z.string().max(65536),
    sources: z
      .array(z.strictObject({ path: WorkspacePathSchema, sha256: hash }))
      .min(1)
      .max(8),
    freshness: z.literal(
      "Published CSV snapshot; live provider freshness is unknown"
    ),
    limits: z.strictObject({
      rows: z.literal(100),
      resultBytes: z.literal(65536),
      deadlineMs: z.literal(15000),
      memoryBytes: z.literal(1610612736),
      memoryController: z.literal("cgroup-v2"),
    }),
  }),
});
