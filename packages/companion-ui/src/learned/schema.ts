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
  .refine(effectivePreference, "Invalid effective memory preference")
  .refine(
    (value) => (value.revision === null) === (value.recordedAt === null) &&
      (value.revision !== null || (value.matches.length === 0 && !value.hasMore)) &&
      value.matches.every((match) => value.recordedAt !== null && match.claim.recordedAt <= value.recordedAt),
    "Search results must belong to a recorded snapshot"
  );
export const LearnedClaimHistoryInputSchema = z.strictObject({
  claimId: z.uuid(),
});
export const LearnedClaimHistorySchema = z.strictObject({
  revision: GitRevisionSchema.nullable(),
  versions: z.array(LearnedClaimVersionSchema).max(10_000),
}).refine(
  (value) => value.revision !== null || value.versions.length === 0,
  "Claim history requires a published head"
);
const matchesReceipt = (
  claim: z.infer<typeof LearnedClaimVersionSchema>,
  receipt: z.infer<typeof LearnedClaimReceiptSchema>
) => claim.revision === receipt.revision && claim.operationId === receipt.operationId &&
  claim.file.scope.userId === receipt.scope.userId &&
  claim.file.scope.workspaceId === receipt.scope.workspaceId &&
  claim.authorUserId === receipt.scope.userId;

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
]).refine((value) => {
  if (!value.applied) return true;
  if ("claim" in value)
    return value.receipt.claimId === value.claim.file.id && matchesReceipt(value.claim, value.receipt);
  return value.receipt.claimId === null &&
    new Set(value.cleared.map((claim) => claim.file.id)).size === value.cleared.length &&
    value.cleared.every((claim) => claim.file.state.kind === "tombstone" && matchesReceipt(claim, value.receipt));
}, "Applied changes must agree with their publication receipt");
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
