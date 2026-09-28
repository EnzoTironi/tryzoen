import { z } from "zod";

export const learnedMemoryRelationsSchema = z
  .array(
    z
      .object({
        kind: z.enum(["causes", "fixes", "contradicts"]),
        memoryId: z.uuid(),
      })
      .strict()
  )
  .max(20)
  .refine(
    (items) =>
      new Set(items.map((item) => `${item.kind}:${item.memoryId}`)).size ===
      items.length,
    "Each relationship must be unique."
  );

export const LearnedMemoryItemSchema = z.object({
  id: z.uuid(),
  memory: z.string().max(8000),
  createdAt: z.string().nullable(),
  updatedAt: z.string().nullable(),
  relations: learnedMemoryRelationsSchema.default([]),
});
export const learnedMemoryRelationEditSchema = z
  .object({
    memoryId: z.uuid(),
    relations: learnedMemoryRelationsSchema,
    expectedRelations: learnedMemoryRelationsSchema,
  })
  .strict();
const operationId = z.string().min(1).max(256);
const text = z.string().min(1).max(8000);
export const LearnedMemoryWriteSchema = z.discriminatedUnion("action", [
  z.object({ action: z.literal("remember"), operationId, text }).strict(),
  z
    .object({
      action: z.literal("update"),
      operationId,
      text,
      memoryId: z.uuid(),
    })
    .strict(),
  z
    .object({ action: z.literal("delete"), operationId, memoryId: z.uuid() })
    .strict(),
  z.object({ action: z.literal("clear"), operationId }).strict(),
  learnedMemoryRelationEditSchema.extend({
    action: z.literal("relate"),
    operationId,
  }),
]);
export const learnedMemorySnapshotSchema = z.object({
  enabled: z.boolean(),
  workspaceEnabled: z.boolean(),
  needsAttention: z.boolean(),
  results: z.array(LearnedMemoryItemSchema).max(200),
});

export const learnedMemoryHistoryInputSchema = z
  .object({
    query: z.string().trim().min(1).max(8000),
    asOf: z.iso.datetime({ offset: true }),
  })
  .strict();

export const learnedMemoryHistorySchema = z.object({
  asOf: z.iso.datetime({ offset: true }),
  semantics: z.literal("ingestion-time"),
  hits: z
    .array(
      z.object({
        noteId: z.uuid(),
        versionId: z.uuid(),
        title: z.string().max(8000),
        excerpt: z.string().max(16000),
      })
    )
    .max(8),
});
