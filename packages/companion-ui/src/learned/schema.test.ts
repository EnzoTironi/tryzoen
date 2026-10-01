import { expect, test } from "vitest";
import {
  LearnedClaimBodySchema,
  LearnedClaimReadSchema,
  LearnedClaimSearchInputSchema,
  LearnedClaimSetEnabledInputSchema,
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
