import { expect, test } from "vitest";
import {
  LearnedClaimBodySchema,
  LearnedClaimReadSchema,
  LearnedClaimSearchInputSchema,
  LearnedClaimSetEnabledInputSchema,
  LearnedClaimSearchSchema,
  LearnedClaimVersionSchema,
  LearnedClaimChangeResultSchema,
  LearnedClaimHistorySchema,
  PrivateMemoryArchivePreviewSchema,
  normalizeLearnedClaimQuery,
  privateMemoryArchiveDownloads,
} from "./schema";

const id = "00000000-0000-4000-8000-000000000001";

test("native query normalization bounds actual long text and preserves empty input", () => {
  const text = Array.from({ length: 200 }, (_, index) => `term${index}`).join(
    " "
  );
  const query = normalizeLearnedClaimQuery(text);
  expect(query.split(" ")).toHaveLength(32);
  expect(query).toBe(
    Array.from({ length: 32 }, (_, index) => `term${index}`).join(" ")
  );
  expect(LearnedClaimSearchInputSchema.parse({ query }).query).toBe(query);
  expect(normalizeLearnedClaimQuery("ＣＥＤＡＲ Cedar, WEEKLY weekly")).toBe(
    "cedar weekly"
  );
  expect(normalizeLearnedClaimQuery(" ... ")).toBe("");
  expect(normalizeLearnedClaimQuery("a".repeat(8001))).toBe("");
  expect(LearnedClaimSearchInputSchema.safeParse({ query: text }).success).toBe(
    false
  );
});

const scope = { userId: "user", workspaceId: "workspace" };
const revision = "a".repeat(40);
const claim = LearnedClaimVersionSchema.parse({
  revision,
  recordedAt: "2026-10-01T00:00:00.000001Z",
  authorUserId: scope.userId,
  operationId: "publication",
  file: { version: 1, id, scope, predecessor: null, restoredFrom: null,
    state: { kind: "active", body: { text: "Cedar", sources: [], validTime: null, relations: [] } } },
});

test("search rejects contradictory snapshot metadata and a future match", () => {
  const result = {
    enabled: true, workspaceEnabled: true, automaticEnabled: true,
    preferenceRevision: id, revision, recordedAt: claim.recordedAt,
    sourceDigest: "a".repeat(64), matches: [{ claim, score: 1, validity: "unknown" }], hasMore: false,
  };
  expect(LearnedClaimSearchSchema.safeParse(result).success).toBe(true);
  for (const invalid of [
    { ...result, revision: null },
    { ...result, recordedAt: null },
    { ...result, revision: null, recordedAt: null },
    { ...result, recordedAt: "2026-10-01T00:00:00.000000Z" },
  ]) expect(LearnedClaimSearchSchema.safeParse(invalid).success).toBe(false);
  expect(LearnedClaimHistorySchema.safeParse({ revision: null, versions: [claim] }).success).toBe(false);
});

test("applied change payloads bind every publication value to the receipt", () => {
  const receipt = { scope, claimId: id, operationId: claim.operationId,
    requestHash: "a".repeat(64), revision };
  const value = { applied: true, claim, receipt };
  expect(LearnedClaimChangeResultSchema.safeParse(value).success).toBe(true);
  for (const invalid of [
    { ...receipt, claimId: null },
    { ...receipt, claimId: "00000000-0000-4000-8000-000000000002" },
    { ...receipt, scope: { ...scope, userId: "other" } },
    { ...receipt, scope: { ...scope, workspaceId: "other" } },
    { ...receipt, revision: "b".repeat(40) },
    { ...receipt, operationId: "other" },
  ]) expect(LearnedClaimChangeResultSchema.safeParse({ ...value, receipt: invalid }).success).toBe(false);
  expect(LearnedClaimChangeResultSchema.safeParse({
    ...value, claim: { ...claim, authorUserId: "other" },
  }).success).toBe(false);
  // A replay receipt is historical and need not describe a newer current head.
  expect(LearnedClaimChangeResultSchema.safeParse({ applied: false, receipt }).success).toBe(true);
});

test("clear results contain unique bound tombstones", () => {
  const tombstone = LearnedClaimVersionSchema.parse({
    ...claim, file: { ...claim.file, predecessor: "b".repeat(40), state: { kind: "tombstone" } },
  });
  const receipt = { scope, claimId: null, operationId: claim.operationId,
    requestHash: "a".repeat(64), revision };
  const value = { applied: true, cleared: [tombstone], receipt };
  expect(LearnedClaimChangeResultSchema.safeParse(value).success).toBe(true);
  expect(LearnedClaimChangeResultSchema.safeParse({ ...value, cleared: [claim] }).success).toBe(false);
  expect(LearnedClaimChangeResultSchema.safeParse({ ...value, cleared: [tombstone, tombstone] }).success).toBe(false);
  expect(LearnedClaimChangeResultSchema.safeParse({ ...value, receipt: { ...receipt, claimId: id } }).success).toBe(false);
  expect(LearnedClaimChangeResultSchema.safeParse({ ...value,
    cleared: [{ ...tombstone, revision: "c".repeat(40) }],
  }).success).toBe(false);
});

test("canonical bodies preserve evidence, time and claim relationships", () => {
  const body = {
    text: "A deliberate user-authored unsourced preference",
    sources: [],
    validTime: null,
    relations: [{ kind: "causes", claimId: id }],
  };
  expect(LearnedClaimBodySchema.parse(body)).toEqual(body);
  expect(
    LearnedClaimBodySchema.safeParse({
      ...body,
      relations: [{ kind: "causes", memoryId: id }],
    }).success
  ).toBe(false);
  expect(
    LearnedClaimBodySchema.safeParse({
      ...body,
      relations: [...body.relations, ...body.relations],
    }).success
  ).toBe(false);
});

test("personal preference and workspace capability have one effective value", () => {
  const read = {
    enabled: true,
    workspaceEnabled: false,
    automaticEnabled: false,
    preferenceRevision: id,
    snapshot: {
      scope: { userId: "user", workspaceId: "workspace" },
      revision: null,
      recordedAt: null,
      claims: [],
    },
  };
  expect(LearnedClaimReadSchema.parse(read).enabled).toBe(true);
  expect(
    LearnedClaimReadSchema.safeParse({ ...read, automaticEnabled: true })
      .success
  ).toBe(false);
  expect(
    LearnedClaimSetEnabledInputSchema.safeParse({
      enabled: false,
      expectedPreferenceRevision: id,
    }).success
  ).toBe(false);
});

test("archive review distinguishes cited lineage from a complete journal", () => {
  const preview = {
    namespaceId: id,
    scope: { userId: "user", workspaceId: "workspace" },
    revision: null,
    expectedRevision: null,
    archiveDigest: "a".repeat(64),
    claimCount: 0,
    sourceEvents: 0,
    sourceBytes: 0,
    retainedHistory: true,
  };
  expect(
    PrivateMemoryArchivePreviewSchema.parse({
      ...preview,
      version: 2,
      coverage: "claims",
    }).coverage
  ).toBe("claims");
  expect(
    PrivateMemoryArchivePreviewSchema.safeParse({
      ...preview,
      version: 2,
      coverage: "complete-journal",
    }).success
  ).toBe(false);
  expect(
    PrivateMemoryArchivePreviewSchema.parse({
      ...preview,
      version: 3,
      coverage: "complete-journal",
      capturedThrough: null,
    }).coverage
  ).toBe("complete-journal");
  expect(privateMemoryArchiveDownloads.claims.filename).not.toBe(
    privateMemoryArchiveDownloads["complete-journal"].filename
  );
});
