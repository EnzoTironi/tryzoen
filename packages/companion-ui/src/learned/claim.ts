import { z } from "zod";
import { GitRevisionSchema } from "../library/files-schema";
import {
  OntologyClaimSchema,
  OntologySourceSchema,
} from "../library/ontology/schema";
import { LearnedClaimTextSchema, LearnedClaimRelationsSchema } from "./body";

/** Per supplied snapshot, not a retention policy. Exceeding a bound must fail;
 * callers must never discard tombstones or audit history to fit these limits. */
export const learnedClaimLimits = {
  claims: 200,
  fileBytes: 65_536,
  snapshotBytes: 8_388_608,
  queryCharacters: 8000,
  queryTerms: 32,
  resultCount: 8,
  resultBytes: 65_536,
} as const;

const identifier = z
  .string()
  .min(1)
  .max(200)
  .refine(
    (value) => value === value.trim(),
    "Expected an exact trimmed identifier"
  );
export const LearnedClaimOperationIdSchema = z
  .string()
  .min(1)
  .max(256)
  .refine((value) => {
    for (const character of value) {
      const code = character.charCodeAt(0);
      if (code < 32 || code === 127) return false;
    }
    return true;
  }, "Operation identifiers cannot contain control characters");
const operationId = LearnedClaimOperationIdSchema;
export const LearnedClaimScopeSchema = z.strictObject({
  workspaceId: identifier,
  userId: identifier,
});

/** References resolve inside the enclosing private scope. Shape validation is
 * not evidence verification; the publisher must authorize and verify sources. */
export const LearnedClaimSessionSourceSchema = z.strictObject({
  kind: z.literal("session"),
  sessionId: z.string().min(1).max(256),
  eventId: z.string().min(1).max(256),
  sha256: z.string().regex(/^[a-f0-9]{64}$/),
  excerpt: OntologySourceSchema.shape.excerpt,
});
export const LearnedClaimSourceSchema = z.discriminatedUnion("kind", [
  OntologySourceSchema.extend({ kind: z.literal("file") }),
  LearnedClaimSessionSourceSchema,
]);
export const LearnedClaimBodySchema = z
  .strictObject({
    text: LearnedClaimTextSchema,
    sources: z
      .array(LearnedClaimSourceSchema)
      .max(10)
      .refine(
        (items) =>
          new Set(items.map((item) => JSON.stringify(item))).size ===
          items.length,
        "Each source must be unique"
      ),
    validTime: OntologyClaimSchema.shape.validTime,
    relations: LearnedClaimRelationsSchema,
  })
  .refine(
    (body) => body.validTime === null || body.sources.length > 0,
    "World-valid dates require cited evidence"
  );

/** This is the file payload. Its own Git revision belongs to the publication
 * envelope, so serializing a file never requires its own Git hash. */
export const LearnedClaimFileSchema = z
  .strictObject({
    version: z.literal(1),
    id: z.uuid(),
    scope: LearnedClaimScopeSchema,
    predecessor: GitRevisionSchema.nullable(),
    restoredFrom: GitRevisionSchema.nullable(),
    state: z.discriminatedUnion("kind", [
      z.strictObject({
        kind: z.literal("active"),
        body: LearnedClaimBodySchema,
      }),
      z.strictObject({ kind: z.literal("tombstone") }),
    ]),
  })
  .refine(
    (file) =>
      file.predecessor !== null ||
      (file.state.kind === "active" && file.restoredFrom === null),
    "Tombstones and reversals require a predecessor"
  );

/** Canonical UTC microseconds preserve the publisher's sub-millisecond order.
 * Reconstruct this envelope from Git metadata or an immutable file manifest.
 * SQL may index publication receipts, but must not own the only copy of history.
 * These values must be supplied by the publisher, never by a model or client. */
export const LearnedClaimPublicationSchema = z.strictObject({
  revision: GitRevisionSchema,
  recordedAt: z.iso.datetime({ precision: 6 }),
  authorUserId: identifier,
});
/** Revision-free metadata belongs to the immutable Git commit; it is sufficient
 * to rebuild receipt indexes without serializing a publication's own SHA. */
const operationMetadata = LearnedClaimPublicationSchema.omit({
  revision: true,
}).extend({
  version: z.literal(1),
  scope: LearnedClaimScopeSchema,
  parentRevision: GitRevisionSchema.nullable(),
  operationId,
  requestHash: z.string().regex(/^[a-f0-9]{64}$/),
});
export const LearnedClaimOperationSchema = z.union([
  operationMetadata.extend({ claimId: z.uuid() }).strict(),
  operationMetadata
    .extend({
      claimId: z.null(),
      clearedClaimIds: z
        .array(z.uuid())
        .max(learnedClaimLimits.claims)
        .refine(
          (ids) =>
            new Set(ids).size === ids.length &&
            ids.every(
              (id, index) => index === 0 || (ids[index - 1] ?? "") < id
            ),
          "Cleared claim identities must be unique and sorted"
        ),
    })
    .strict(),
]);
export const LearnedClaimVersionSchema = LearnedClaimPublicationSchema.extend({
  file: LearnedClaimFileSchema,
  operationId,
}).refine(
  (claim) =>
    claim.file.predecessor !== claim.revision &&
    claim.file.restoredFrom !== claim.revision,
  "Claim lineage cannot reference its own publication"
);
export const LearnedClaimSnapshotSchema = z
  .strictObject({
    scope: LearnedClaimScopeSchema,
    revision: GitRevisionSchema.nullable(),
    recordedAt: LearnedClaimPublicationSchema.shape.recordedAt.nullable(),
    claims: z.array(LearnedClaimVersionSchema).max(learnedClaimLimits.claims),
  })
  .superRefine((snapshot, context) => {
    const ids = new Set<string>();
    if (
      (snapshot.revision === null) !== (snapshot.recordedAt === null) ||
      (snapshot.revision === null && snapshot.claims.length > 0)
    )
      context.addIssue({ code: "custom", message: "Invalid empty snapshot" });
    for (const claim of snapshot.claims) {
      if (
        ids.has(claim.file.id) ||
        claim.file.scope.userId !== snapshot.scope.userId ||
        claim.file.scope.workspaceId !== snapshot.scope.workspaceId ||
        claim.authorUserId !== snapshot.scope.userId ||
        snapshot.recordedAt === null ||
        claim.recordedAt > snapshot.recordedAt
      )
        context.addIssue({
          code: "custom",
          message: "Invalid scoped claim snapshot",
        });
      ids.add(claim.file.id);
    }
  });

const change = {
  operationId,
  claimId: z.uuid(),
  expectedRevision: GitRevisionSchema.nullable(),
};
export const LearnedClaimChangeSchema = z.discriminatedUnion("action", [
  z.strictObject({
    action: z.literal("clear"),
    operationId,
    expectedRevision: GitRevisionSchema.nullable(),
  }),
  z.strictObject({
    ...change,
    action: z.literal("assert"),
    body: LearnedClaimBodySchema,
  }),
  z.strictObject({
    ...change,
    action: z.literal("correct"),
    body: LearnedClaimBodySchema,
  }),
  z.strictObject({ ...change, action: z.literal("tombstone") }),
  z.strictObject({
    ...change,
    action: z.literal("reverse"),
    targetRevision: GitRevisionSchema,
  }),
]);
export const LearnedClaimReceiptSchema = z.strictObject({
  scope: LearnedClaimScopeSchema,
  claimId: z.uuid().nullable(),
  operationId,
  requestHash: z.string().regex(/^[a-f0-9]{64}$/),
  revision: GitRevisionSchema,
});

/** Durable recall is derived from the current authorized file snapshot. A receipt
 * cannot confer access or outlive a correction, permission change or source loss. */
export const LearnedClaimRecallSchema = z
  .strictObject({
    enabled: z.boolean(),
    workspaceEnabled: z.boolean(),
    automaticEnabled: z.boolean(),
    preferenceRevision: z.uuid(),
    revision: GitRevisionSchema.nullable(),
    sourceDigest: z.string().regex(/^[a-f0-9]{64}$/),
    queryHash: z.string().regex(/^[a-f0-9]{64}$/),
    matches: z
      .array(
        z.strictObject({
          claim: LearnedClaimVersionSchema,
          score: z.int().positive(),
          validity: z.enum(["unknown", "in-range", "not-filtered"]),
        })
      )
      .max(learnedClaimLimits.resultCount),
    hasMore: z.boolean(),
  })
  .refine(
    (recall) =>
      recall.automaticEnabled === (recall.enabled && recall.workspaceEnabled),
  "Automatic memory requires personal preference and workspace capability"
).refine(
  (recall) => (recall.revision !== null || (recall.matches.length === 0 && !recall.hasMore)) &&
    (recall.automaticEnabled || (recall.matches.length === 0 && !recall.hasMore)),
  "Recall matches require a published snapshot"
);
