import { expect, test } from "vitest";
import {
  LearnedClaimBodySchema,
  LearnedClaimSnapshotSchema,
  learnedClaimLimits,
} from "../../packages/companion-ui/src/learned/claim";
import {
  projectLearnedClaims,
  readLearnedClaimAudit,
  searchLearnedClaims,
} from "./retrieval";

const scope = { workspaceId: "team-cedar", userId: "alice" };
const id = (value: number) =>
  `00000000-0000-4000-8000-${String(value).padStart(12, "0")}`;
const revision = (value: number) => value.toString(16).padStart(40, "0");
const time = (value: number) =>
  `2026-09-30T12:00:00.${String(value).padStart(6, "0")}Z`;
function claim(
  value: number,
  text: string,
  overrides: Partial<ReturnType<typeof LearnedClaimBodySchema.parse>> = {}
) {
  return {
    revision: revision(1),
    recordedAt: time(1),
    authorUserId: scope.userId,
    operationId: `assert-${value}`,
    file: {
      version: 1 as const,
      id: id(value),
      scope,
      predecessor: null,
      restoredFrom: null,
      state: {
        kind: "active" as const,
        body: LearnedClaimBodySchema.parse({
          text,
          sources: [],
          validTime: null,
          relations: [],
          ...overrides,
        }),
      },
    },
  };
}
const snapshot = (claims: ReturnType<typeof claim>[], value = 1) =>
  LearnedClaimSnapshotSchema.parse({
    scope,
    revision: revision(value),
    recordedAt: time(value),
    claims,
  });
function search(
  current: ReturnType<typeof LearnedClaimSnapshotSchema.parse>,
  query: string,
  extra: Partial<
    Pick<Parameters<typeof searchLearnedClaims>[0], "limit" | "validOn">
  > = {}
) {
  return searchLearnedClaims({
    scope,
    current,
    projection: projectLearnedClaims(scope, current),
    query,
    ...extra,
  });
}

test("rebuilding a projection is deterministic across file enumeration and leaves inputs intact", () => {
  const current = snapshot([
    claim(3, "Cedar budgets and reports"),
    claim(1, "Cedar reports"),
    claim(2, "Budget review"),
  ]);
  const before = structuredClone(current);
  const first = projectLearnedClaims(scope, current);
  const rebuilt = projectLearnedClaims(scope, {
    ...current,
    claims: current.claims.toReversed(),
  });
  expect(rebuilt).toEqual(first);
  expect(current).toEqual(before);
  expect(
    search(current, "cedar budget reports").matches.map((match) => [
      match.claim.file.id,
      match.score,
    ])
  ).toEqual([
    [id(1), 2],
    [id(3), 2],
    [id(2), 1],
  ]);
  expect(first.entries.every((entry) => !Object.hasOwn(entry, "body"))).toBe(
    true
  );
});

test("normalization is deterministic and ties use stable IDs rather than enumeration or locale", () => {
  const current = snapshot([
    claim(2, "ＦＩＮＡＮＣＥ Cedar"),
    claim(1, "finance cedar"),
    claim(3, "finances"),
  ]);
  expect(
    search(current, "FINANCE finance, ＣＥＤＡＲ").matches.map((match) => [
      match.claim.file.id,
      match.score,
    ])
  ).toEqual([
    [id(1), 2],
    [id(2), 2],
  ]);
  const projection = projectLearnedClaims(scope, current);
  expect(
    searchLearnedClaims({
      scope,
      current,
      projection: {
        entries: projection.entries,
        sourceDigest: projection.sourceDigest,
        revision: projection.revision,
        scope: projection.scope,
        version: projection.version,
      },
      query: "finance",
    }).matches
  ).toHaveLength(2);
});

test("correction replaces current retrieval and rejects older or corrupted projections", () => {
  const old = snapshot([claim(1, "Cedar reports are weekly")]);
  const projection = projectLearnedClaims(scope, old);
  const previous = old.claims[0];
  if (previous?.file.state.kind !== "active")
    throw new Error("Missing fixture");
  const current = LearnedClaimSnapshotSchema.parse({
    scope,
    revision: revision(2),
    recordedAt: time(2),
    claims: [
      {
        ...previous,
        revision: revision(2),
        recordedAt: time(2),
        operationId: "correct-report",
        file: {
          ...previous.file,
          predecessor: revision(1),
          state: {
            kind: "active",
            body: {
              ...previous.file.state.body,
              text: "Cedar reports are monthly",
            },
          },
        },
      },
    ],
  });
  expect(() =>
    searchLearnedClaims({ scope, current, projection, query: "weekly" })
  ).toThrow("stale, foreign, or inconsistent");
  expect(search(current, "weekly").matches).toEqual([]);
  expect(search(current, "monthly").matches[0]?.claim.file.state).toMatchObject(
    { body: { text: "Cedar reports are monthly" } }
  );
  const fresh = projectLearnedClaims(scope, current);
  const tampered = { ...fresh, entries: [{ id: id(1), terms: ["weekly"] }] };
  expect(() =>
    searchLearnedClaims({
      scope,
      current,
      projection: tampered,
      query: "weekly",
    })
  ).toThrow("inconsistent");
  expect(() =>
    searchLearnedClaims({
      scope,
      current,
      projection: { ...fresh, sourceDigest: "0".repeat(64) },
      query: "monthly",
    })
  ).toThrow("inconsistent");
});

test("foreign users and workspaces cannot read current or audit data, including empty queries", () => {
  const current = snapshot([claim(1, "Private Cedar report")]);
  const projection = projectLearnedClaims(scope, current);
  for (const foreign of [
    { ...scope, userId: "bob" },
    { ...scope, workspaceId: "other-team" },
  ]) {
    expect(() => projectLearnedClaims(foreign, current)).toThrow(
      "scope mismatch"
    );
    expect(() =>
      searchLearnedClaims({ scope: foreign, current, projection, query: "" })
    ).toThrow("scope mismatch");
    expect(() =>
      readLearnedClaimAudit({
        scope: foreign,
        recorded: current,
        claimId: id(1),
      })
    ).toThrow("scope mismatch");
    expect(() =>
      searchLearnedClaims({
        scope,
        current,
        projection: { ...projection, scope: foreign },
        query: "private",
      })
    ).toThrow("foreign");
  }
});

test("tombstones exclude standard recall while explicit recorded audit preserves correction and deletion history", () => {
  const original = snapshot([claim(1, "Cedar reports are weekly")]);
  const previous = original.claims[0];
  if (!previous) throw new Error("Missing fixture");
  const current = LearnedClaimSnapshotSchema.parse({
    scope,
    revision: revision(2),
    recordedAt: time(2),
    claims: [
      {
        ...previous,
        revision: revision(2),
        recordedAt: time(2),
        operationId: "forget-report",
        file: {
          ...previous.file,
          predecessor: revision(1),
          state: { kind: "tombstone" },
        },
      },
    ],
  });
  const projection = projectLearnedClaims(scope, current);
  expect(projection.entries).toEqual([]);
  expect(search(current, "Cedar weekly").matches).toEqual([]);
  expect(projection.sourceDigest).not.toBe(
    projectLearnedClaims(scope, original).sourceDigest
  );
  expect(
    readLearnedClaimAudit({ scope, recorded: original, claimId: id(1) }).claim
      ?.file.state
  ).toMatchObject({
    kind: "active",
    body: { text: "Cedar reports are weekly" },
  });
  expect(
    readLearnedClaimAudit({ scope, recorded: current, claimId: id(1) }).claim
      ?.file.state
  ).toEqual({ kind: "tombstone" });
  expect(
    readLearnedClaimAudit({ scope, recorded: current, claimId: id(999) }).claim
  ).toBeNull();
  expect(() =>
    searchLearnedClaims({
      scope,
      current,
      projection: projectLearnedClaims(scope, original),
      query: "weekly",
    })
  ).toThrow("stale");
});

test("world-valid filtering remains independent of recorded time, with exclusive ends and unknown dates visible", () => {
  const source = {
    kind: "file" as const,
    path: "knowledge/report.md",
    revision: revision(1),
    excerpt: "September reporting period",
  };
  const current = snapshot([
    claim(1, "Cedar September report", {
      sources: [source],
      validTime: { from: "2026-09-01", until: "2026-10-01" },
    }),
    claim(2, "Cedar report dates unknown"),
    claim(3, "Cedar report through August", {
      sources: [source],
      validTime: { from: null, until: "2026-09-01" },
    }),
    claim(4, "Cedar report from October", {
      sources: [source],
      validTime: { from: "2026-10-01", until: null },
    }),
  ]);
  expect(
    search(current, "Cedar", { validOn: "2026-09-01" }).matches.map((match) => [
      match.claim.file.id,
      match.validity,
    ])
  ).toEqual([
    [id(1), "in-range"],
    [id(2), "unknown"],
  ]);
  expect(
    search(current, "Cedar", { validOn: "2026-10-01" }).matches.map(
      (match) => match.claim.file.id
    )
  ).toEqual([id(2), id(4)]);
  expect(
    search(current, "Cedar", { validOn: "2026-08-31" }).matches.map(
      (match) => match.claim.file.id
    )
  ).toEqual([id(2), id(3)]);
  expect(search(current, "September").matches[0]?.validity).toBe(
    "not-filtered"
  );
  expect(
    readLearnedClaimAudit({ scope, recorded: current, claimId: id(1) }).claim
      ?.recordedAt
  ).toBe(time(1));
  expect(() => search(current, "Cedar", { validOn: "2026-02-30" })).toThrow(
    "Invalid ISO date"
  );
});

test("bounded reads disclose remaining matches and do not silently drop excess query terms", () => {
  const current = snapshot(
    Array.from({ length: 12 }, (_, index) => claim(index + 1, "Cedar report"))
  );
  const result = search(current, "Cedar");
  expect(result.matches).toHaveLength(learnedClaimLimits.resultCount);
  expect(result.hasMore).toBe(true);
  expect(
    search(current, "Cedar", { limit: 2 }).matches.map(
      (match) => match.claim.file.id
    )
  ).toEqual([id(1), id(2)]);
  expect(search(current, "... : () AND ").matches).toEqual([]);
  expect(search(current, "").matches).toEqual([]);
  expect(() =>
    search(
      current,
      Array.from({ length: 33 }, (_, index) => `term${index}`).join(" ")
    )
  ).toThrow("term limit");
  expect(() => search(current, "a".repeat(8001))).toThrow("Too big");
  expect(() => search(current, "Cedar", { limit: 9 })).toThrow("Too big");
  expect(() => search(current, "Cedar", { limit: 0 })).toThrow("Too small");
});

test("result byte limits fail before returning a partial fact and can be satisfied by narrowing the read", () => {
  const text = "Cedar " + "界".repeat(7000);
  const current = snapshot(
    Array.from({ length: 8 }, (_, index) => claim(index + 1, text))
  );
  expect(() => search(current, "Cedar")).toThrow(
    "results exceed their byte limit"
  );
  const result = search(current, "Cedar", { limit: 1 });
  expect(result.matches[0]?.claim.file.state).toMatchObject({ body: { text } });
  expect(result.hasMore).toBe(true);
});

test("an empty authoritative root yields an empty reproducible projection", () => {
  const current = LearnedClaimSnapshotSchema.parse({
    scope,
    revision: null,
    recordedAt: null,
    claims: [],
  });
  expect(projectLearnedClaims(scope, current)).toEqual(
    projectLearnedClaims(scope, structuredClone(current))
  );
  expect(search(current, "Cedar")).toEqual({
    revision: null,
    matches: [],
    hasMore: false,
  });
  expect(
    readLearnedClaimAudit({ scope, recorded: current, claimId: id(1) }).claim
  ).toBeNull();
});
