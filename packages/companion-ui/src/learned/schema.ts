import { z } from "zod";
import {
  GitRevisionSchema,
  WorkspaceRecordedViewSchema,
} from "../library/files-schema";
import {
  LearnedClaimOperationIdSchema,
  LearnedClaimPublicationSchema,
  LearnedClaimRecallSchema,
  LearnedClaimReceiptSchema,
  LearnedClaimSnapshotSchema,
  LearnedClaimVersionSchema,
  learnedClaimLimits,
} from "./claim";
import { learnedClaimQueryTerms } from "./query";

export * from "./body";
export * from "./claim";
export * from "./query";
export * from "./archive";

const preference = {
  enabled: z.boolean(),
  workspaceEnabled: z.boolean(),
  automaticEnabled: z.boolean(),
  preferenceRevision: z.uuid(),
};
const effectivePreference = (value: {
  enabled: boolean;
  workspaceEnabled: boolean;
  automaticEnabled: boolean;
}) => value.automaticEnabled === (value.enabled && value.workspaceEnabled);

export const LearnedClaimReadInputSchema = WorkspaceRecordedViewSchema;
export const LearnedClaimReadSchema = z
  .strictObject({ ...preference, snapshot: LearnedClaimSnapshotSchema })
  .refine(effectivePreference, "Invalid effective memory preference");
export const LearnedClaimSearchInputSchema = z.strictObject({
  query: z
    .string()
    .max(learnedClaimLimits.queryCharacters)
    .refine(
      (text) =>
        learnedClaimQueryTerms(text).length <= learnedClaimLimits.queryTerms,
      "Claim query exceeds its term limit"
    ),
  view: LearnedClaimReadInputSchema.optional(),
  validOn: z.iso.date().optional(),
  limit: z.int().min(1).max(learnedClaimLimits.resultCount).optional(),
});
export const LearnedClaimSearchSchema = z
  .strictObject({
    ...preference,
    revision: GitRevisionSchema.nullable(),
    recordedAt: LearnedClaimPublicationSchema.shape.recordedAt.nullable(),
    sourceDigest: LearnedClaimRecallSchema.shape.sourceDigest,
    matches: LearnedClaimRecallSchema.shape.matches,
    hasMore: z.boolean(),
  })
  .refine(effectivePreference, "Invalid effective memory preference");
export const LearnedClaimHistoryInputSchema = z.strictObject({
  claimId: z.uuid(),
});
export const LearnedClaimHistorySchema = z.strictObject({
  revision: GitRevisionSchema.nullable(),
  versions: z.array(LearnedClaimVersionSchema).max(10_000),
});
export const LearnedClaimChangeResultSchema = z.union([
  z.strictObject({
    applied: z.literal(false),
    receipt: LearnedClaimReceiptSchema,
  }),
  z.strictObject({
    applied: z.literal(true),
    receipt: LearnedClaimReceiptSchema,
    claim: LearnedClaimVersionSchema,
  }),
  z.strictObject({
    applied: z.literal(true),
    receipt: LearnedClaimReceiptSchema,
    cleared: z.array(LearnedClaimVersionSchema).max(learnedClaimLimits.claims),
  }),
]);
export const LearnedClaimSetEnabledInputSchema = z.strictObject({
  operationId: LearnedClaimOperationIdSchema,
  expectedPreferenceRevision: z.uuid(),
  enabled: z.boolean(),
});
export const LearnedClaimPreferenceReceiptSchema = z.strictObject({
  operationId: LearnedClaimOperationIdSchema,
  requestHash: z.string().regex(/^[a-f0-9]{64}$/),
  preferenceRevision: z.uuid(),
  enabled: z.boolean(),
});
export const LearnedClaimSetEnabledResultSchema = z.strictObject({
  applied: z.boolean(),
  receipt: LearnedClaimPreferenceReceiptSchema,
});
export const LearnedClaimIndexRepairSchema = z.strictObject({
  revision: GitRevisionSchema.nullable(),
  operations: z.int().nonnegative().max(10_000),
});
