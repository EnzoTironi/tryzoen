import { z } from "zod";
import { userProfileSchema } from "../user-profile/schema";

export const storedNoteSchema = z.object({
  content: z.string().max(4000),
  version: z.uuid(),
  updatedAt: z.string(),
});

export const personalMemorySnapshotSchema = z.object({
  scope: z.literal("stored-personal-memory"),
  generatedAt: z.string(),
  profile: userProfileSchema,
  notes: z.object({
    status: z.enum(["located", "unresolved"]),
    documents: z.array(storedNoteSchema),
  }),
  coverage: z.object({
    included: z.tuple([
      z.literal("structured-profile"),
      z.literal("bound-profile-notes"),
    ]),
    excluded: z.tuple([
      z.literal("conversation-history"),
      z.literal("artifacts"),
      z.literal("connected-accounts"),
      z.literal("schedules"),
      z.literal("unbound-memory-documents"),
    ]),
  }),
});

export type PersonalMemorySnapshot = z.output<
  typeof personalMemorySnapshotSchema
>;

export const personalNoteUpdateSchema = z
  .object({
    expectedVersion: storedNoteSchema.shape.version,
    content: storedNoteSchema.shape.content,
  })
  .strict();
