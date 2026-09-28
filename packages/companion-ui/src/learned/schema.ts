import { z } from "zod";

export const LearnedMemoryItemSchema = z.object({
  id: z.uuid(),
  memory: z.string().max(8000),
  createdAt: z.string().nullable(),
  updatedAt: z.string().nullable(),
});
export const LearnedMemoryWriteSchema = z.object({
  action: z.enum(["remember", "update", "delete", "clear"]),
  operationId: z.string().min(1).max(256),
  text: z.string().min(1).max(8000).optional(),
  memoryId: z.uuid().optional(),
});
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
