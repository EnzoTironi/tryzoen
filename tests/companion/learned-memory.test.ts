import { expect, test } from "vitest";
import {
  LearnedClaimReadSchema,
  LearnedClaimVersionSchema,
} from "../../packages/companion-ui/src/learned/schema";
import {
  createLearnedClaimEdit,
  updateLearnedClaimText,
  reviewLearnedClaimEdit,
} from "../../packages/companion-ui/src/learned/draft";

// Client contract/pure-state tests only. These do not qualify database or UI acceptance.
const id = "00000000-0000-4000-8000-000000000001";
const related = "00000000-0000-4000-8000-000000000002";
const scope = { userId: "synthetic-owner", workspaceId: "synthetic-workspace" };
const claim = LearnedClaimVersionSchema.parse({
  revision: "a".repeat(40),
  recordedAt: "2026-10-01T00:00:00.000001Z",
  authorUserId: scope.userId,
  operationId: "published",
  file: {
    version: 1,
    id,
    scope,
    predecessor: null,
    restoredFrom: null,
    state: {
      kind: "active",
      body: {
        text: "Launch in August",
        sources: [
          {
            kind: "file",
            path: "knowledge/launch.md",
            revision: "c".repeat(40),
            excerpt: "Launch in August",
          },
        ],
        validTime: { from: "2026-08-01", until: "2026-09-01" },
        relations: [{ kind: "causes", claimId: related }],
      },
    },
  },
});
const read = LearnedClaimReadSchema.parse({
  enabled: true,
  workspaceEnabled: true,
  automaticEnabled: true,
  preferenceRevision: id,
  snapshot: {
    scope,
    revision: "b".repeat(40),
    recordedAt: "2026-10-01T00:00:00.000002Z",
    claims: [claim],
  },
});
const ids = () => {
  let count = 2;
  return {
    next: () => `00000000-0000-4000-8000-${String(++count).padStart(12, "0")}`,
    count: () => count - 2,
  };
};

test("new claims keep identity and identical submissions reuse operation identity", () => {
  const sequence = ids();
  const newId = sequence.next;
  const original = createLearnedClaimEdit(read, newId);
  const submitted = updateLearnedClaimText(
    original,
    "A deliberate note",
    newId
  );
  const retry = updateLearnedClaimText(submitted, "A deliberate note", newId);
  expect(retry).toBe(submitted);
  expect(sequence.count()).toBe(3);
  expect(submitted.claimId).toBe(original.claimId);
  expect(submitted.expectedRevision).toBe(read.snapshot.revision);
  expect(submitted.body).toEqual({
    text: "A deliberate note",
    sources: [],
    validTime: null,
    relations: [],
  });
  const changed = updateLearnedClaimText(submitted, "A revised draft", newId);
  expect(changed.operationId).not.toBe(submitted.operationId);
  expect(changed.claimId).toBe(submitted.claimId);
  expect(submitted.body.text).toBe("A deliberate note");
});

test("text correction retains exact reviewed evidence, valid time, relationships and head", () => {
  const sequence = ids();
  const newId = sequence.next;
  const original = createLearnedClaimEdit(read, newId, claim);
  const draft = updateLearnedClaimText(original, "Launch in September", newId);
  expect(draft).toMatchObject({
    action: "correct",
    claimId: id,
    expectedRevision: "b".repeat(40),
  });
  expect(draft.body.sources).toEqual(original.body.sources);
  expect(draft.body.validTime).toEqual(original.body.validTime);
  expect(draft.body.relations).toEqual(original.body.relations);
  expect(original.body.text).toBe("Launch in August");
  expect(draft.body.sources).not.toBe(
    claim.file.state.kind === "active"
      ? claim.file.state.body.sources
      : undefined
  );
});

function newer() {
  const nextClaim = LearnedClaimVersionSchema.parse({
    ...claim,
    revision: "d".repeat(40),
    recordedAt: "2026-10-01T00:00:00.000003Z",
    file: {
      ...claim.file,
      predecessor: claim.revision,
      state: {
        kind: "active",
        body: {
          text: "The saved winner",
          sources: [
            {
              kind: "file",
              path: "knowledge/current.md",
              revision: "e".repeat(40),
              excerpt: "The saved winner",
            },
          ],
          validTime: { from: "2026-10-01", until: null },
          relations: [],
        },
      },
    },
  });
  return LearnedClaimReadSchema.parse({
    ...read,
    snapshot: {
      ...read.snapshot,
      revision: nextClaim.revision,
      recordedAt: nextClaim.recordedAt,
      claims: [nextClaim],
    },
  });
}

test("conflict retains the original draft until explicit review preserves newer metadata", () => {
  const sequence = ids();
  const newId = sequence.next;
  const draft = updateLearnedClaimText(
    createLearnedClaimEdit(read, newId, claim),
    "My draft",
    newId
  );
  const before = structuredClone(draft);
  const current = newer();
  const reviewed = reviewLearnedClaimEdit(draft, current, "text", newId);
  expect(draft).toEqual(before);
  expect(reviewed.expectedRevision).toBe(current.snapshot.revision);
  expect(reviewed.operationId).not.toBe(draft.operationId);
  expect(reviewed.body).toEqual({
    text: "My draft",
    sources: [
      {
        kind: "file",
        path: "knowledge/current.md",
        revision: "e".repeat(40),
        excerpt: "The saved winner",
      },
    ],
    validTime: { from: "2026-10-01", until: null },
    relations: [],
  });
  const relationships = reviewLearnedClaimEdit(
    draft,
    current,
    "relations",
    newId
  );
  expect(relationships.body.text).toBe("The saved winner");
  expect(relationships.body.relations).toEqual(draft.body.relations);
  expect(relationships.body.sources).toEqual(reviewed.body.sources);
});

test("review cannot resurrect removed claims or silently create a replacement identity", () => {
  const sequence = ids();
  const newId = sequence.next;
  const draft = createLearnedClaimEdit(read, newId, claim);
  const tombstone = LearnedClaimVersionSchema.parse({
    ...claim,
    revision: "d".repeat(40),
    recordedAt: "2026-10-01T00:00:00.000003Z",
    file: {
      ...claim.file,
      predecessor: claim.revision,
      state: { kind: "tombstone" },
    },
  });
  const current = LearnedClaimReadSchema.parse({
    ...read,
    snapshot: {
      ...read.snapshot,
      revision: tombstone.revision,
      recordedAt: tombstone.recordedAt,
      claims: [tombstone],
    },
  });
  expect(() => reviewLearnedClaimEdit(draft, current, "text", newId)).toThrow(
    "cannot restore"
  );
  expect(() =>
    reviewLearnedClaimEdit(
      { ...draft, action: "assert" },
      current,
      "text",
      newId
    )
  ).toThrow("cannot restore");
  expect(draft.claimId).toBe(id);
  expect(draft.expectedRevision).toBe(read.snapshot.revision);
});

test("an acknowledged identity is corrected only after explicit review, never duplicated", () => {
  const sequence = ids();
  const newId = sequence.next;
  const draft = { ...createLearnedClaimEdit(read, newId), claimId: id };
  const submitted = updateLearnedClaimText(
    draft,
    "My unsent correction",
    newId
  );
  const reviewed = reviewLearnedClaimEdit(submitted, newer(), "text", newId);
  expect(submitted.action).toBe("assert");
  expect(reviewed.action).toBe("correct");
  expect(reviewed.claimId).toBe(id);
});
