import { z } from "zod";
import { GitRevisionSchema } from "../library/files-schema";
import { LearnedClaimScopeSchema } from "./claim";

/** Refusal budgets for one archive, not retention or capacity qualification. */
export const privateMemoryArchiveLimits = {
  manifestBytes: 2_097_152,
  bundleBytes: 25_165_824,
  sourceFileBytes: 8_388_608,
  sourceBytes: 134_217_728,
  events: 10_000,
  wireBytes: 161_480_720,
} as const;
export const PrivateMemoryArchiveCoverageSchema = z.enum([
  "claims",
  "complete-journal",
]);
export const privateMemoryArchiveDownloads = {
  claims: {
    filename: "zoen-private-memory-v2.zoen-memory",
    contentType: "application/vnd.zoen.private-memory+octet-stream",
  },
  "complete-journal": {
    filename: "zoen-private-memory-corpus-v3.zoen-memory",
    contentType: "application/vnd.zoen.private-memory+octet-stream",
  },
} as const;
const preview = {
  namespaceId: z.uuid(),
  scope: LearnedClaimScopeSchema,
  revision: GitRevisionSchema.nullable(),
  expectedRevision: GitRevisionSchema.nullable(),
  archiveDigest: z.string().regex(/^[a-f0-9]{64}$/),
  claimCount: z.int().nonnegative().max(200),
  sourceEvents: z.int().nonnegative().max(privateMemoryArchiveLimits.events),
  sourceBytes: z
    .int()
    .nonnegative()
    .max(privateMemoryArchiveLimits.sourceBytes),
  retainedHistory: z.literal(true),
};
export const PrivateMemoryArchivePreviewSchema = z.discriminatedUnion(
  "version",
  [
    z.strictObject({
      ...preview,
      version: z.literal(2),
      coverage: z.literal("claims"),
    }),
    z.strictObject({
      ...preview,
      version: z.literal(3),
      coverage: z.literal("complete-journal"),
      capturedThrough: z
        .int()
        .positive()
        .max(Number.MAX_SAFE_INTEGER)
        .nullable(),
    }),
  ]
);
export const PrivateMemoryArchiveApplySchema = z.strictObject({
  expectedRevision: GitRevisionSchema.nullable(),
  archiveDigest: z.string().regex(/^[a-f0-9]{64}$/),
});
export const PrivateMemoryArchiveRestoreResultSchema = z.strictObject({
  applied: z.boolean(),
  revision: GitRevisionSchema.nullable(),
});
