import { z } from "zod";

export const LearnedClaimTextSchema = z
  .string()
  .min(1)
  .max(8000)
  .refine((value) => value.trim().length > 0, "A claim requires text");

export const LearnedClaimRelationSchema = z.strictObject({
  kind: z.enum(["causes", "fixes", "contradicts"]),
  claimId: z.uuid(),
});

export const LearnedClaimRelationsSchema = z
  .array(LearnedClaimRelationSchema)
  .max(20)
  .refine(
    (items) =>
      new Set(items.map((item) => `${item.kind}:${item.claimId}`)).size ===
      items.length,
    "Each relationship must be unique"
  );
