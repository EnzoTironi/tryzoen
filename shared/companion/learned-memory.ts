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
