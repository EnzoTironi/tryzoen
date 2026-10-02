import { publishClaimFixture } from "../../tests/helpers/learned-claims";
import { expect, test } from "vitest";
import {
  LearnedClaimBodySchema,
  LearnedClaimFileSchema,
  LearnedClaimScopeSchema,
  LearnedClaimSnapshotSchema,
  learnedClaimLimits,
} from "../../packages/companion-ui/src/learned/claim";
import {
  assertClaimRestorePreservesTombstones,
  validateLearnedClaimSnapshot,
} from "./claims";

const scope = { workspaceId: "team-cedar", userId: "alice" };
const id = (value: number) =>
  `00000000-0000-4000-8000-${String(value).padStart(12, "0")}`;
const revision = (value: number) => value.toString(16).padStart(40, "0");
const publication = (value: number) => ({
  revision: revision(value),
  recordedAt: `2026-09-30T12:00:00.${String(value).padStart(6, "0")}Z`,
  authorUserId: scope.userId,
});
const empty = () =>
  LearnedClaimSnapshotSchema.parse({
    scope,
    revision: null,
    recordedAt: null,
    claims: [],
  });
const body = (text = "The Cedar team prefers concise reports") =>
  LearnedClaimBodySchema.parse({
    text,
    sources: [],
    validTime: null,
    relations: [],
  });
const assertChange = (value: number, current = empty(), content = body()) => ({
  action: "assert" as const,
  operationId: `assert-${value}`,
  claimId: id(value),
  expectedRevision: current.revision,
  body: content,
});
function apply(
  current: Parameters<typeof publishClaimFixture>[0]["current"],
  change: Parameters<typeof publishClaimFixture>[0]["change"],
  value: number,
  reversalTarget?: Parameters<typeof publishClaimFixture>[0]["reversalTarget"]
) {
  const result = publishClaimFixture({
    scope,
    current,
    change,
    publication: publication(value),
    reversalTarget,
  });
  if (!result.applied) throw new Error("Expected a fresh mutation");
  return {
    ...result,
    snapshot: LearnedClaimSnapshotSchema.parse({
      scope,
      revision: publication(value).revision,
      recordedAt: publication(value).recordedAt,
      claims: [
        ...current.claims.filter((item) => item.file.id !== change.claimId),
        result.claim,
      ],
    }),
  };
}

// Snapshots have no author property; construct the owning shape without aliases.
function snapshotFrom(
  result: Extract<ReturnType<typeof publishClaimFixture>, { applied: true }>
) {
  return LearnedClaimSnapshotSchema.parse({
    scope,
    revision: result.claim.revision,
    recordedAt: result.claim.recordedAt,
    claims: [result.claim],
  });
}

test.each([" alice", "alice ", "\talice", "alice\n", ""])(
  "scope identifiers reject normalization: %j",
  (userId) => {
    expect(
      LearnedClaimScopeSchema.safeParse({ ...scope, userId }).success
    ).toBe(false);
  }
);

test("scope identifiers preserve exact identity and reject extra authority fields", () => {
  expect(LearnedClaimScopeSchema.parse(scope)).toEqual(scope);
  expect(
    LearnedClaimScopeSchema.parse({ ...scope, userId: "Alice" }).userId
  ).toBe("Alice");
  expect(
    LearnedClaimScopeSchema.safeParse({ ...scope, audience: "everyone" })
      .success
  ).toBe(false);
});

test("valid dates require evidence; invalid dates, duplicate sources and blank claims are rejected", () => {
  const source = {
    kind: "file" as const,
    path: "knowledge/report.md",
    revision: revision(1),
    excerpt: "Active during September",
  };
  expect(
    LearnedClaimBodySchema.safeParse({
      ...body(),
      validTime: { from: "2026-09-01", until: null },
    }).success
  ).toBe(false);
  expect(
    LearnedClaimBodySchema.parse({
      ...body(),
      sources: [source],
      validTime: { from: "2026-09-01", until: null },
    }).validTime
  ).toEqual({ from: "2026-09-01", until: null });
  for (const validTime of [
    { from: "2026-02-30", until: null },
    { from: "2026-10-01", until: "2026-09-01" },
    { from: "2026-09-01", until: "2026-09-01" },
    { from: null, until: null },
  ])
    expect(
      LearnedClaimBodySchema.safeParse({
        ...body(),
        sources: [source],
        validTime,
      }).success
    ).toBe(false);
  expect(
    LearnedClaimBodySchema.safeParse({ ...body(), sources: [source, source] })
      .success
  ).toBe(false);
  expect(
    LearnedClaimBodySchema.safeParse({ ...body(), text: " \n " }).success
  ).toBe(false);
});

test("session evidence retains exact coordinates and digest without accepting authority labels", () => {
  const source = {
    kind: "session" as const,
    sessionId: "eve-session",
    eventId: "settled:event",
    sha256: "a".repeat(64),
    excerpt: "The user explicitly asked to remember this",
  };
  expect(
    LearnedClaimBodySchema.parse({ ...body(), sources: [source] }).sources
  ).toEqual([source]);
  expect(
    LearnedClaimBodySchema.safeParse({
      ...body(),
      sources: [{ ...source, revision: revision(1) }],
    }).success
  ).toBe(false);
  expect(
    LearnedClaimBodySchema.safeParse({
      ...body(),
      sources: [{ ...source, userId: "bob" }],
    }).success
  ).toBe(false);
  expect(
    LearnedClaimBodySchema.safeParse({
      ...body(),
      sources: [{ ...source, sha256: "invalid" }],
    }).success
  ).toBe(false);
});

test("assertion produces a serializable file plus immutable publication metadata without mutating input", () => {
  const current = empty();
  const change = assertChange(1);
  const before = structuredClone({ current, change });
  const result = publishClaimFixture({
    scope,
    current,
    change,
    publication: publication(1),
  });
  expect(result.applied).toBe(true);
  if (!result.applied) throw new Error("Expected claim");
  expect(result.claim.file).toEqual({
    version: 1,
    id: id(1),
    scope,
    predecessor: null,
    restoredFrom: null,
    state: { kind: "active", body: body() },
  });
  expect(
    LearnedClaimFileSchema.parse(JSON.parse(JSON.stringify(result.claim.file)))
  ).toEqual(result.claim.file);
  expect(result.claim.file).not.toHaveProperty("revision");
  expect(result.receipt).toMatchObject({
    scope,
    claimId: id(1),
    operationId: change.operationId,
    revision: revision(1),
  });
  expect({ current, change }).toEqual(before);
});

test("correction replaces the complete evidence-bearing body and keeps the original version available", () => {
  const original = publishClaimFixture({
    scope,
    current: empty(),
    change: assertChange(1, empty(), {
      ...body("Cedar reports are weekly"),
      sources: [
        {
          kind: "file",
          path: "knowledge/report.md",
          revision: revision(1),
          excerpt: "Weekly during September",
        },
      ],
      validTime: { from: "2026-09-01", until: "2026-10-01" },
    }),
    publication: publication(1),
  });
  if (!original.applied) throw new Error("Expected claim");
  const corrected = publishClaimFixture({
    scope,
    current: snapshotFrom(original),
    change: {
      action: "correct",
      operationId: "correct-1",
      claimId: id(1),
      expectedRevision: revision(1),
      body: body("Cedar reports are monthly"),
    },
    publication: publication(2),
  });
  if (!corrected.applied) throw new Error("Expected correction");
  expect(corrected.claim.file.predecessor).toBe(revision(1));
  expect(corrected.claim.file.state).toEqual({
    kind: "active",
    body: body("Cedar reports are monthly"),
  });
  expect(
    original.claim.file.state.kind === "active" &&
      original.claim.file.state.body.text
  ).toBe("Cedar reports are weekly");
});

test("stale writes and non-advancing recorded times fail, including sub-millisecond order", () => {
  const first = publishClaimFixture({
    scope,
    current: empty(),
    change: assertChange(1),
    publication: publication(1),
  });
  if (!first.applied) throw new Error("Expected claim");
  const current = snapshotFrom(first);
  const change = {
    action: "correct" as const,
    operationId: "correct-1",
    claimId: id(1),
    expectedRevision: revision(1),
    body: body("New report"),
  };
  expect(() =>
    publishClaimFixture({
      scope,
      current,
      change: { ...change, expectedRevision: null },
      publication: publication(2),
    })
  ).toThrow("revision conflict");
  expect(() =>
    publishClaimFixture({
      scope,
      current,
      change,
      publication: { ...publication(2), recordedAt: publication(1).recordedAt },
    })
  ).toThrow("advance recorded history");
  expect(() =>
    publishClaimFixture({
      scope,
      current,
      change,
      publication: { ...publication(2), recordedAt: publication(0).recordedAt },
    })
  ).toThrow("advance recorded history");
  expect(() =>
    publishClaimFixture({
      scope,
      current,
      change,
      publication: publication(1),
    })
  ).toThrow("advance recorded history");
  expect(
    publishClaimFixture({
      scope,
      current,
      change,
      publication: publication(2),
    }).applied
  ).toBe(true);
});

test("replay returns only its receipt after a later tombstone and changed input cannot reuse it", () => {
  const change = assertChange(1);
  const first = publishClaimFixture({
    scope,
    current: empty(),
    change,
    publication: publication(1),
  });
  if (!first.applied) throw new Error("Expected claim");
  const deleted = publishClaimFixture({
    scope,
    current: snapshotFrom(first),
    change: {
      action: "tombstone",
      operationId: "forget-1",
      claimId: id(1),
      expectedRevision: revision(1),
    },
    publication: publication(2),
  });
  if (!deleted.applied) throw new Error("Expected tombstone");
  const current = snapshotFrom(deleted);
  const replay = publishClaimFixture({
    scope,
    current,
    change,
    publication: publication(3),
    previousReceipt: first.receipt,
  });
  expect(replay).toEqual({ applied: false, receipt: first.receipt });
  expect(replay).not.toHaveProperty("claim");
  expect(current.claims[0]?.file.state).toEqual({ kind: "tombstone" });
  expect(() =>
    publishClaimFixture({
      scope,
      current,
      change: { ...change, body: body("Different content") },
      publication: publication(3),
      previousReceipt: first.receipt,
    })
  ).toThrow("conflicts with its receipt");
  expect(() =>
    publishClaimFixture({
      scope,
      current,
      change: { ...change, operationId: "other-operation" },
      publication: publication(3),
      previousReceipt: first.receipt,
    })
  ).toThrow("conflicts with its receipt");
  expect(() =>
    publishClaimFixture({
      scope,
      current,
      change: { ...change, expectedRevision: revision(2) },
      publication: publication(3),
    })
  ).toThrow("identity already exists");
});

test("foreign scopes, authors and replay receipts are rejected even when claim IDs match", () => {
  const first = publishClaimFixture({
    scope,
    current: empty(),
    change: assertChange(1),
    publication: publication(1),
  });
  if (!first.applied) throw new Error("Expected claim");
  const current = snapshotFrom(first);
  for (const foreign of [
    { ...scope, userId: "bob" },
    { ...scope, workspaceId: "other-team" },
  ]) {
    expect(() => validateLearnedClaimSnapshot(foreign, current)).toThrow(
      "scope mismatch"
    );
    expect(() =>
      publishClaimFixture({
        scope,
        current,
        change: assertChange(1),
        publication: publication(2),
        previousReceipt: { ...first.receipt, scope: foreign },
      })
    ).toThrow("conflicts with its receipt");
  }
  expect(() =>
    publishClaimFixture({
      scope,
      current: empty(),
      change: assertChange(1),
      publication: { ...publication(1), authorUserId: "bob" },
    })
  ).toThrow("does not own");
  expect(
    LearnedClaimSnapshotSchema.safeParse({
      ...current,
      claims: [
        {
          ...first.claim,
          file: { ...first.claim.file, scope: { ...scope, userId: "bob" } },
        },
      ],
    }).success
  ).toBe(false);
  expect(
    LearnedClaimSnapshotSchema.safeParse({
      ...current,
      claims: [first.claim, first.claim],
    }).success
  ).toBe(false);
  expect(
    LearnedClaimSnapshotSchema.safeParse({
      ...current,
      recordedAt: publication(0).recordedAt,
    }).success
  ).toBe(false);
});

test("tombstones contain no active body; explicit reversal creates a new revision without rewriting history", () => {
  const first = publishClaimFixture({
    scope,
    current: empty(),
    change: assertChange(1),
    publication: publication(1),
  });
  if (!first.applied) throw new Error("Expected claim");
  const deleted = publishClaimFixture({
    scope,
    current: snapshotFrom(first),
    change: {
      action: "tombstone",
      operationId: "forget-1",
      claimId: id(1),
      expectedRevision: revision(1),
    },
    publication: publication(2),
  });
  if (!deleted.applied) throw new Error("Expected tombstone");
  expect(deleted.claim.file.state).toEqual({ kind: "tombstone" });
  const change = {
    action: "reverse" as const,
    operationId: "undo-forget",
    claimId: id(1),
    expectedRevision: revision(2),
    targetRevision: revision(1),
  };
  const reversed = publishClaimFixture({
    scope,
    current: snapshotFrom(deleted),
    change,
    publication: publication(3),
    reversalTarget: first.claim,
  });
  if (!reversed.applied) throw new Error("Expected reversal");
  expect(reversed.claim.file).toMatchObject({
    predecessor: revision(2),
    restoredFrom: revision(1),
    state: first.claim.file.state,
  });
  expect(reversed.claim.revision).toBe(revision(3));
  expect(deleted.claim.file.state).toEqual({ kind: "tombstone" });
  expect(() =>
    publishClaimFixture({
      scope,
      current: snapshotFrom(deleted),
      change,
      publication: publication(3),
    })
  ).toThrow("authorized historical target");
  expect(() =>
    publishClaimFixture({
      scope,
      current: snapshotFrom(deleted),
      change,
      publication: publication(3),
      reversalTarget: deleted.claim,
    })
  ).toThrow("Invalid claim reversal target");
  expect(() =>
    publishClaimFixture({
      scope,
      current: snapshotFrom(deleted),
      change,
      publication: publication(3),
      reversalTarget: {
        ...first.claim,
        file: { ...first.claim.file, scope: { ...scope, userId: "bob" } },
      },
    })
  ).toThrow("Invalid claim reversal target");
});

test("relations require scoped targets and retain an existing dangling link during body correction", () => {
  const destination = apply(empty(), assertChange(2), 1);
  const linkedBody = {
    ...body(),
    relations: [{ kind: "contradicts" as const, claimId: id(2) }],
  };
  const linked = apply(
    destination.snapshot,
    assertChange(1, destination.snapshot, linkedBody),
    2
  );
  const removed = apply(
    linked.snapshot,
    {
      action: "tombstone",
      operationId: "forget-target",
      claimId: id(2),
      expectedRevision: revision(2),
    },
    3
  );
  const corrected = apply(
    removed.snapshot,
    {
      action: "correct",
      operationId: "correct-linked",
      claimId: id(1),
      expectedRevision: revision(3),
      body: { ...linkedBody, text: "Corrected report" },
    },
    4
  );
  expect(corrected.claim.file.state).toEqual({
    kind: "active",
    body: { ...linkedBody, text: "Corrected report" },
  });
  expect(
    corrected.snapshot.claims.find((claim) => claim.file.id === id(2))?.file
      .state
  ).toEqual({ kind: "tombstone" });
  expect(() =>
    apply(removed.snapshot, assertChange(3, removed.snapshot, linkedBody), 4)
  ).toThrow("active scoped target or a retained link");
  expect(() =>
    apply(
      removed.snapshot,
      {
        action: "correct",
        operationId: "different-link",
        claimId: id(1),
        expectedRevision: revision(3),
        body: {
          ...linkedBody,
          relations: [{ kind: "causes", claimId: id(2) }],
        },
      },
      4
    )
  ).toThrow("active scoped target or a retained link");
  expect(() =>
    apply(
      linked.snapshot,
      assertChange(3, linked.snapshot, {
        ...body(),
        relations: [{ kind: "causes", claimId: id(3) }],
      }),
      3
    )
  ).toThrow("active scoped target or a retained link");
  expect(() =>
    apply(
      linked.snapshot,
      assertChange(3, linked.snapshot, {
        ...body(),
        relations: [{ kind: "causes", claimId: id(999) }],
      }),
      3
    )
  ).toThrow("active scoped target or a retained link");
});

test("restore cannot resurrect, omit or replace a newer tombstone but keeps audit snapshots intact", () => {
  const first = publishClaimFixture({
    scope,
    current: empty(),
    change: assertChange(1),
    publication: publication(1),
  });
  if (!first.applied) throw new Error("Expected claim");
  const original = snapshotFrom(first);
  const deleted = publishClaimFixture({
    scope,
    current: original,
    change: {
      action: "tombstone",
      operationId: "forget-1",
      claimId: id(1),
      expectedRevision: revision(1),
    },
    publication: publication(2),
  });
  if (!deleted.applied) throw new Error("Expected tombstone");
  const current = snapshotFrom(deleted);
  expect(() => {
    assertClaimRestorePreservesTombstones({
      scope,
      current,
      restored: original,
    });
  }).toThrow("preserve the current claim tombstone");
  expect(() => {
    assertClaimRestorePreservesTombstones({
      scope,
      current,
      restored: empty(),
    });
  }).toThrow("preserve the current claim tombstone");
  expect(() => {
    assertClaimRestorePreservesTombstones({
      scope,
      current,
      restored: current,
    });
  }).not.toThrow();
  expect(original.claims[0]?.file.state.kind).toBe("active");
});

test("capacity includes tombstones and does not silently drop history to admit another identity", () => {
  const first = publishClaimFixture({
    scope,
    current: empty(),
    change: assertChange(1),
    publication: publication(1),
  });
  if (!first.applied) throw new Error("Expected claim");
  const current = LearnedClaimSnapshotSchema.parse({
    scope,
    revision: revision(1),
    recordedAt: publication(1).recordedAt,
    claims: Array.from({ length: learnedClaimLimits.claims }, (_, index) => ({
      ...first.claim,
      file: {
        ...first.claim.file,
        id: id(index + 1),
        predecessor: revision(0),
        state: { kind: "tombstone" },
      },
    })),
  });
  expect(() =>
    publishClaimFixture({
      scope,
      current,
      change: assertChange(201, current),
      publication: publication(2),
    })
  ).toThrow("capacity exceeded");
  expect(current.claims).toHaveLength(200);
  expect(
    LearnedClaimSnapshotSchema.safeParse({
      ...current,
      claims: [
        ...current.claims,
        { ...first.claim, file: { ...first.claim.file, id: id(201) } },
      ],
    }).success
  ).toBe(false);
});

test("UTF-8 file and total snapshot byte bounds reject excess without truncation", () => {
  const first = publishClaimFixture({
    scope,
    current: empty(),
    change: assertChange(1),
    publication: publication(1),
  });
  if (!first.applied) throw new Error("Expected claim");
  const largeBody = {
    ...body("界".repeat(8000)),
    sources: Array.from({ length: 10 }, (_, index) => ({
      kind: "file" as const,
      path: `knowledge/source-${index}.md`,
      revision: revision(1),
      excerpt: "界".repeat(2000),
    })),
  };
  expect(LearnedClaimBodySchema.safeParse(largeBody).success).toBe(true);
  expect(() =>
    publishClaimFixture({
      scope,
      current: empty(),
      change: assertChange(1, empty(), largeBody),
      publication: publication(1),
    })
  ).toThrow("file exceeds its byte limit");
  const boundedBody = { ...largeBody, sources: largeBody.sources.slice(0, 4) };
  const current = LearnedClaimSnapshotSchema.parse({
    scope,
    revision: revision(1),
    recordedAt: publication(1).recordedAt,
    claims: Array.from({ length: 200 }, (_, index) => ({
      ...first.claim,
      file: {
        ...first.claim.file,
        id: id(index + 1),
        state: { kind: "active", body: boundedBody },
      },
    })),
  });
  expect(() => validateLearnedClaimSnapshot(scope, current)).toThrow(
    "snapshot exceeds its byte limit"
  );
});

test("claim lineage rejects orphan tombstones, orphan reversals and self-referencing versions", () => {
  const first = publishClaimFixture({
    scope,
    current: empty(),
    change: assertChange(1),
    publication: publication(1),
  });
  if (!first.applied) throw new Error("Expected claim");
  expect(
    LearnedClaimFileSchema.safeParse({
      ...first.claim.file,
      state: { kind: "tombstone" },
    }).success
  ).toBe(false);
  expect(
    LearnedClaimFileSchema.safeParse({
      ...first.claim.file,
      restoredFrom: revision(0),
    }).success
  ).toBe(false);
  expect(
    LearnedClaimSnapshotSchema.safeParse({
      ...snapshotFrom(first),
      claims: [
        {
          ...first.claim,
          file: { ...first.claim.file, predecessor: revision(1) },
        },
      ],
    }).success
  ).toBe(false);
  expect(
    LearnedClaimSnapshotSchema.safeParse({
      ...snapshotFrom(first),
      claims: [
        {
          ...first.claim,
          file: {
            ...first.claim.file,
            predecessor: revision(0),
            restoredFrom: revision(1),
          },
        },
      ],
    }).success
  ).toBe(false);
});
