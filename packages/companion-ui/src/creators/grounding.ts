import { z } from "zod";
const digest = z.string().regex(/^[a-f0-9]{64}$/);
export const creatorCitationSchema = z
  .strictObject({
    id: z.string().regex(/^S[1-8]$/),
    title: z.string().max(120),
    attribution: z.string().max(1000),
    excerpt: z.string().min(1).max(8000),
    excerptDigest: digest,
    pageDigest: digest,
    entryId: z.uuid(),
    start: z.number().int().nonnegative(),
    end: z.number().int().positive(),
    offsetUnit: z.literal("utf16"),
  })
  .refine(
    (value) =>
      value.end > value.start &&
      value.end - value.start === value.excerpt.length,
    "Citation offsets must match its exact excerpt."
  );
export const creatorGroundingSchema = z.strictObject({
  releaseId: z.uuid(),
  manifestDigest: digest,
  retrieval: z.literal("lexical"),
  citations: z.array(creatorCitationSchema).max(8),
});
export const creatorGroundedAnswerSchema = z.strictObject({
  status: z.enum(["supported", "insufficient-evidence"]),
  answer: z.string().trim().min(1).max(8000),
  citations: z.array(creatorCitationSchema.shape.id).max(8),
});
