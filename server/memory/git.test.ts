import { randomUUID } from "node:crypto";
import { readFile, writeFile } from "node:fs/promises";
import { withGitBundle, GitBundleError } from "../files/git";
import { expect, test } from "vitest";
import { z } from "zod";
import {
  publishPrivateMemoryGit,
  readPrivateMemoryGit,
  privateMemoryGitLimits,
} from "./git";
import {
  planLearnedClaim,
  bindLearnedClaimPublication,
  validateLearnedClaimSnapshot,
} from "./claims";
import { projectLearnedClaims, searchLearnedClaims } from "./retrieval";

const scope = { workspaceId: "private-team", userId: "alice" };
const publication = (value: number) => ({
  authorUserId: scope.userId,
  recordedAt: `2026-09-30T14:00:00.${String(value).padStart(6, "0")}Z`,
});
const body = (text: string) => ({
  text,
  sources: [],
  relations: [],
  validTime: null,
});

async function firstClaim() {
  const change = {
    action: "assert" as const,
    claimId: randomUUID(),
    operationId: randomUUID(),
    expectedRevision: null,
    body: body("Alice prefers weekly reports"),
  };
  const first = await publishPrivateMemoryGit({
    scope,
    bundle: null,
    head: null,
    change,
    publication: async () => publication(1),
  });
  if (!first.applied || !("claim" in first))
    throw new Error("Expected first publication");
  return { first, change };
}

test("private files and receipts use the real Git SHA; reconstruction preserves facts and authorization scope", async () => {
  const { first, change } = await firstClaim();
  expect(first.receipt.revision).toMatch(/^[a-f0-9]{40}$/u);
  expect(first.claim.file).not.toHaveProperty("revision");
  expect(first.operation).not.toHaveProperty("revision");
  const read = await readPrivateMemoryGit({
    scope,
    bundle: first.bundle,
    head: first.receipt.revision,
  });
  expect(read.snapshot).toEqual(first.snapshot);
  expect(read.operations).toEqual([
    { revision: first.receipt.revision, operation: first.operation },
  ]);
  expect(first.operation).toMatchObject({
    scope,
    parentRevision: null,
    claimId: change.claimId,
    requestHash: first.receipt.requestHash,
  });
  await expect(
    readPrivateMemoryGit({
      scope: { ...scope, userId: "bob" },
      bundle: first.bundle,
      head: first.receipt.revision,
    })
  ).rejects.toThrow("GitBundleError");
  await expect(
    readPrivateMemoryGit({
      scope: { ...scope, workspaceId: "another-team" },
      bundle: first.bundle,
      head: first.receipt.revision,
    })
  ).rejects.toThrow("GitBundleError");
});

test("correction invalidates the old projection while recorded audit preserves the original claim", async () => {
  const { first, change } = await firstClaim();
  const oldProjection = projectLearnedClaims(scope, first.snapshot);
  const second = await publishPrivateMemoryGit({
    scope,
    bundle: first.bundle,
    head: first.receipt.revision,
    change: {
      action: "correct",
      claimId: change.claimId,
      operationId: randomUUID(),
      expectedRevision: first.receipt.revision,
      body: body("Alice prefers monthly reports"),
    },
    publication: async () => publication(2),
  });
  if (!second.applied || !("claim" in second))
    throw new Error("Expected correction");
  expect(second.claim.file.predecessor).toBe(first.receipt.revision);
  expect(() =>
    searchLearnedClaims({
      scope,
      current: second.snapshot,
      projection: oldProjection,
      query: "reports",
    })
  ).toThrow("stale, foreign, or inconsistent");
  const recovered = await readPrivateMemoryGit({
    scope,
    bundle: second.bundle,
    head: second.receipt.revision,
  });
  const projection = projectLearnedClaims(scope, recovered.snapshot);
  expect(
    searchLearnedClaims({
      scope,
      current: recovered.snapshot,
      projection,
      query: "reports",
    }).matches[0]?.claim.file.state
  ).toEqual({ kind: "active", body: body("Alice prefers monthly reports") });
  const historical = await readPrivateMemoryGit({
    scope,
    bundle: second.bundle,
    head: second.receipt.revision,
    revision: first.receipt.revision,
  });
  expect(historical.snapshot).toEqual(first.snapshot);
});

test("a replay is reconstructed from commit metadata after a tombstone and cannot resurrect the old file", async () => {
  const { first, change } = await firstClaim();
  const deleted = await publishPrivateMemoryGit({
    scope,
    bundle: first.bundle,
    head: first.receipt.revision,
    change: {
      action: "tombstone",
      claimId: change.claimId,
      operationId: randomUUID(),
      expectedRevision: first.receipt.revision,
    },
    publication: async () => publication(2),
  });
  if (!deleted.applied || !("claim" in deleted))
    throw new Error("Expected deletion");
  const replay = await publishPrivateMemoryGit({
    scope,
    bundle: deleted.bundle,
    head: deleted.receipt.revision,
    change,
    publication: async () => publication(3),
  });
  expect(replay).toEqual({ applied: false, receipt: first.receipt });
  const read = await readPrivateMemoryGit({
    scope,
    bundle: deleted.bundle,
    head: deleted.receipt.revision,
    historyClaimId: change.claimId,
  });
  expect(read.snapshot.claims[0]?.file.state).toEqual({ kind: "tombstone" });
  expect(read.history).toEqual([deleted.claim, first.claim]);
  await expect(
    publishPrivateMemoryGit({
      scope,
      bundle: deleted.bundle,
      head: deleted.receipt.revision,
      change: { ...change, body: body("Conflicting retry") },
      publication: async () => publication(3),
    })
  ).rejects.toThrow("conflicts with its receipt");
});

test("explicit reversal proves the real historical ancestor and records a new receipt", async () => {
  const { first, change } = await firstClaim();
  const deleted = await publishPrivateMemoryGit({
    scope,
    bundle: first.bundle,
    head: first.receipt.revision,
    change: {
      action: "tombstone",
      claimId: change.claimId,
      operationId: randomUUID(),
      expectedRevision: first.receipt.revision,
    },
    publication: async () => publication(2),
  });
  if (!deleted.applied || !("claim" in deleted))
    throw new Error("Expected tombstone");
  const reversal = {
    action: "reverse" as const,
    claimId: change.claimId,
    operationId: randomUUID(),
    expectedRevision: deleted.receipt.revision,
    targetRevision: first.receipt.revision,
  };
  const restored = await publishPrivateMemoryGit({
    scope,
    bundle: deleted.bundle,
    head: deleted.receipt.revision,
    change: reversal,
    publication: async () => publication(3),
  });
  if (!restored.applied || !("claim" in restored))
    throw new Error("Expected reversal");
  expect(restored.claim.file).toMatchObject({
    predecessor: deleted.receipt.revision,
    restoredFrom: first.receipt.revision,
    state: first.claim.file.state,
  });
  expect(restored.receipt.revision).not.toBe(first.receipt.revision);
  await expect(
    publishPrivateMemoryGit({
      scope,
      bundle: deleted.bundle,
      head: deleted.receipt.revision,
      change: { ...reversal, targetRevision: "a".repeat(40) },
      publication: async () => publication(3),
    })
  ).rejects.toThrow("GitBundleError");
});

test("planning does not require or accept the future SHA and rejects control characters in operation identities", async () => {
  const current = { scope, revision: null, recordedAt: null, claims: [] };
  const change = {
    action: "assert" as const,
    claimId: randomUUID(),
    operationId: randomUUID(),
    expectedRevision: null,
    body: body("Manual private note"),
  };
  const plan = planLearnedClaim({
    scope,
    current,
    change,
    publication: publication(1),
  });
  expect(plan.applied).toBe(true);
  expect(plan).not.toHaveProperty("receipt");
  if (!plan.applied) throw new Error("Expected plan");
  expect(plan.operation).not.toHaveProperty("revision");
  const untrustedPublication = { ...publication(1), revision: "a".repeat(40) };
  expect(() =>
    planLearnedClaim({
      scope,
      current,
      change,
      publication: untrustedPublication,
    })
  ).toThrow(z.ZodError);
  expect(() =>
    planLearnedClaim({
      scope,
      current,
      change: { ...change, operationId: "bad\0operation" },
      publication: publication(1),
    })
  ).toThrow(z.ZodError);
});

test("a valid operation message cannot conceal an unrecorded mutation to another private claim", async () => {
  const { first, change } = await firstClaim();
  const second = await publishPrivateMemoryGit({
    scope,
    bundle: first.bundle,
    head: first.receipt.revision,
    change: {
      action: "assert",
      operationId: randomUUID(),
      claimId: randomUUID(),
      expectedRevision: first.receipt.revision,
      body: body("Another private claim"),
    },
    publication: async () => publication(2),
  });
  if (!second.applied || !("claim" in second))
    throw new Error("Expected second publication");
  const forged = await withGitBundle(
    { bundle: second.bundle, limits: privateMemoryGitLimits },
    async ({ directory, git }) => {
      await git(["read-tree", second.receipt.revision]);
      const file = `${directory}/forged-claim.json`;
      await writeFile(
        file,
        JSON.stringify({
          ...first.claim.file,
          state: { kind: "active", body: body("Unrecorded replacement") },
        }) + "\n"
      );
      const blob = (await git(["hash-object", "-w", "--", file])).trim();
      await git([
        "update-index",
        "--cacheinfo",
        `100644,${blob},claims/${change.claimId}.json`,
      ]);
      const tree = (await git(["write-tree"])).trim();
      const head = (
        await git([
          "commit-tree",
          tree,
          "-p",
          first.receipt.revision,
          "-m",
          JSON.stringify(second.operation),
        ])
      ).trim();
      await git(["update-ref", "refs/heads/main", head]);
      const destination = `${directory}/forged.bundle`;
      await git(["bundle", "create", destination, "--all"]);
      return { head, bundle: await readFile(destination) };
    }
  );
  await expect(readPrivateMemoryGit({ scope, ...forged })).rejects.toThrow(
    GitBundleError
  );
});

test("corrupted operation metadata and false request receipts fail as typed private bundle errors", async () => {
  const { first } = await firstClaim();
  for (const message of [
    "{invalid-json",
    JSON.stringify({ ...first.operation, requestHash: "f".repeat(64) }),
  ]) {
    const forged = await withGitBundle(
      { bundle: first.bundle, limits: privateMemoryGitLimits },
      async ({ directory, git }) => {
        const tree = (
          await git(["rev-parse", `${first.receipt.revision}^{tree}`])
        ).trim();
        const head = (await git(["commit-tree", tree, "-m", message])).trim();
        await git(["update-ref", "refs/heads/main", head]);
        const destination = `${directory}/invalid-receipt.bundle`;
        await git(["bundle", "create", destination, "--all"]);
        return { head, bundle: await readFile(destination) };
      }
    );
    await expect(readPrivateMemoryGit({ scope, ...forged })).rejects.toThrow(
      GitBundleError
    );
  }
});

test("clear uses one actual commit for all tombstones and replay cannot erase a later assertion", async () => {
  const { first, change } = await firstClaim();
  const second = await publishPrivateMemoryGit({
    scope,
    bundle: first.bundle,
    head: first.receipt.revision,
    change: {
      action: "assert",
      claimId: randomUUID(),
      operationId: randomUUID(),
      expectedRevision: first.receipt.revision,
      body: body("Cedar cadence"),
    },
    publication: async () => publication(2),
  });
  if (!second.applied || !("claim" in second))
    throw new Error("Expected second claim");
  const clear = {
    action: "clear" as const,
    operationId: randomUUID(),
    expectedRevision: second.receipt.revision,
  };
  const erased = await publishPrivateMemoryGit({
    scope,
    bundle: second.bundle,
    head: second.receipt.revision,
    change: clear,
    publication: async () => publication(3),
  });
  if (!erased.applied || !("cleared" in erased))
    throw new Error("Expected atomic clear");
  expect(erased.cleared).toHaveLength(2);
  expect(new Set(erased.cleared.map((claim) => claim.revision))).toEqual(
    new Set([erased.receipt.revision])
  );
  expect(erased.receipt.claimId).toBeNull();
  const captured = await readPrivateMemoryGit({
    scope,
    bundle: erased.bundle,
    head: erased.receipt.revision,
    historyClaimId: change.claimId,
  });
  expect(captured.operations).toHaveLength(3);
  expect(captured.snapshot.claims.map((claim) => claim.file.state)).toEqual([
    { kind: "tombstone" },
    { kind: "tombstone" },
  ]);
  expect(captured.history[1]).toEqual(first.claim);
  const later = await publishPrivateMemoryGit({
    scope,
    bundle: erased.bundle,
    head: erased.receipt.revision,
    change: {
      action: "assert",
      claimId: randomUUID(),
      operationId: randomUUID(),
      expectedRevision: erased.receipt.revision,
      body: body("New intentionally remembered fact"),
    },
    publication: async () => publication(4),
  });
  if (!later.applied) throw new Error("Expected later assertion");
  expect(
    await publishPrivateMemoryGit({
      scope,
      bundle: later.bundle,
      head: later.receipt.revision,
      change: clear,
      publication: async () => publication(5),
    })
  ).toEqual({ applied: false, receipt: erased.receipt });
  expect(
    (
      await readPrivateMemoryGit({
        scope,
        bundle: later.bundle,
        head: later.receipt.revision,
      })
    ).snapshot.claims.filter((claim) => claim.file.state.kind === "active")
  ).toHaveLength(1);
});

test("clearing an empty private repository creates a durable actual-SHA receipt and remains replayable", async () => {
  const change = {
    action: "clear" as const,
    operationId: randomUUID(),
    expectedRevision: null,
  };
  const first = await publishPrivateMemoryGit({
    scope,
    bundle: null,
    head: null,
    change,
    publication: async () => publication(1),
  });
  if (!first.applied || !("cleared" in first))
    throw new Error("Expected empty clear receipt");
  expect(first.cleared).toEqual([]);
  const captured = await readPrivateMemoryGit({
    scope,
    bundle: first.bundle,
    head: first.receipt.revision,
  });
  expect(captured.snapshot.claims).toEqual([]);
  expect(captured.operations).toHaveLength(1);
  expect(
    await publishPrivateMemoryGit({
      scope,
      bundle: first.bundle,
      head: first.receipt.revision,
      change,
      publication: async () => publication(2),
    })
  ).toEqual({ applied: false, receipt: first.receipt });
});

test("a clear receipt cannot omit an active parent claim or conceal additional file changes", async () => {
  const { first } = await firstClaim();
  const second = await publishPrivateMemoryGit({
    scope,
    bundle: first.bundle,
    head: first.receipt.revision,
    change: {
      action: "assert",
      claimId: randomUUID(),
      operationId: randomUUID(),
      expectedRevision: first.receipt.revision,
      body: body("Another active claim"),
    },
    publication: async () => publication(2),
  });
  if (!second.applied) throw new Error("Expected second claim");
  const cleared = await publishPrivateMemoryGit({
    scope,
    bundle: second.bundle,
    head: second.receipt.revision,
    change: {
      action: "clear",
      operationId: randomUUID(),
      expectedRevision: second.receipt.revision,
    },
    publication: async () => publication(3),
  });
  if (
    !cleared.applied ||
    !("cleared" in cleared) ||
    cleared.operation.claimId !== null
  )
    throw new Error("Expected clear");
  const clearOperation = cleared.operation;
  const forged = await withGitBundle(
    { bundle: cleared.bundle, limits: privateMemoryGitLimits },
    async ({ directory, git }) => {
      const tree = (
        await git(["rev-parse", `${cleared.receipt.revision}^{tree}`])
      ).trim();
      const message = {
        ...clearOperation,
        clearedClaimIds: clearOperation.clearedClaimIds.slice(0, 1),
      };
      const head = (
        await git([
          "commit-tree",
          tree,
          "-p",
          second.receipt.revision,
          "-m",
          JSON.stringify(message),
        ])
      ).trim();
      await git(["update-ref", "refs/heads/main", head]);
      const destination = `${directory}/false-clear.bundle`;
      await git(["bundle", "create", destination, "--all"]);
      return { head, bundle: await readFile(destination) };
    }
  );
  await expect(readPrivateMemoryGit({ scope, ...forged })).rejects.toThrow(
    GitBundleError
  );
});

test("retained recovery evidence spans more than fifty corrections and survives clear without truncating source history", async () => {
  const claimId = randomUUID();
  let head: string | null = null;
  let bundle: Uint8Array | null = null;
  const revisions: string[] = [];
  const sources = Array.from({ length: 55 }, (_, index) => ({
    kind: "session" as const,
    sessionId: "synthetic-retained-history",
    eventId: `synthetic-source-${index}`,
    sha256: index.toString(16).padStart(64, "0"),
    excerpt: `Retained source ${index}`,
  }));
  for (const [index, source] of sources.entries()) {
    const published = await publishPrivateMemoryGit({
      scope,
      bundle,
      head,
      change: {
        action: index === 0 ? "assert" : "correct",
        claimId,
        operationId: randomUUID(),
        expectedRevision: head,
        body: { ...body(`Revision ${index}`), sources: [source] },
      },
      publication: async () => publication(index + 1),
    });
    if (!published.applied || !("claim" in published))
      throw new Error("Expected a real historical publication");
    head = published.receipt.revision;
    bundle = published.bundle;
    revisions.push(head);
  }
  const cleared = await publishPrivateMemoryGit({
    scope,
    bundle,
    head,
    change: {
      action: "clear",
      operationId: randomUUID(),
      expectedRevision: head,
    },
    publication: async () => publication(56),
  });
  if (!cleared.applied) throw new Error("Expected real clear publication");
  const captured = await readPrivateMemoryGit({
    scope,
    head: cleared.receipt.revision,
    bundle: cleared.bundle,
    historyClaimId: claimId,
    includeRetainedSources: true,
  });
  expect(captured.snapshot.claims[0]?.file.state).toEqual({
    kind: "tombstone",
  });
  expect(captured.operations).toHaveLength(56);
  expect(captured.history).toHaveLength(56);
  expect(captured.history.map((version) => version.revision)).toEqual([
    cleared.receipt.revision,
    ...revisions.toReversed(),
  ]);
  expect(captured.history[0]?.file.state).toEqual({ kind: "tombstone" });
  expect(captured.history.at(-1)?.file.state).toEqual({
    kind: "active",
    body: { ...body("Revision 0"), sources: [sources[0]] },
  });
  expect(captured.retainedSources).toHaveLength(55);
  expect(captured.retainedSources).toEqual(sources.toReversed());
  expect(captured.retainedSources).toContainEqual(sources[0]);
  // This pure Git reader does not authenticate the fictional citations.
  await expect(
    readPrivateMemoryGit({
      scope: { ...scope, userId: "another-owner" },
      head: cleared.receipt.revision,
      bundle: cleared.bundle,
      includeRetainedSources: true,
    })
  ).rejects.toThrow("GitBundleError");
}, 40_000);

test("recovery evidence deduplicates exact citations without loading it into ordinary reads", async () => {
  const source = {
    kind: "session" as const,
    sessionId: "synthetic-deduplicated-history",
    eventId: "synthetic-deduplicated-source",
    sha256: "a".repeat(64),
    excerpt: "One retained source",
  };
  const claimId = randomUUID();
  const first = await publishPrivateMemoryGit({
    scope,
    bundle: null,
    head: null,
    change: {
      action: "assert",
      claimId,
      operationId: randomUUID(),
      expectedRevision: null,
      body: { ...body("Original"), sources: [source] },
    },
    publication: async () => publication(1),
  });
  if (!first.applied) throw new Error("Expected first source publication");
  const changed = await publishPrivateMemoryGit({
    scope,
    bundle: first.bundle,
    head: first.receipt.revision,
    change: {
      action: "correct",
      claimId,
      operationId: randomUUID(),
      expectedRevision: first.receipt.revision,
      body: { ...body("Corrected"), sources: [source] },
    },
    publication: async () => publication(2),
  });
  if (!changed.applied) throw new Error("Expected correction");
  const input = {
    scope,
    head: changed.receipt.revision,
    bundle: changed.bundle,
  };
  expect((await readPrivateMemoryGit(input)).retainedSources).toEqual([]);
  expect(
    (await readPrivateMemoryGit({ ...input, includeRetainedSources: true }))
      .retainedSources
  ).toEqual([source]);
});

test("a later correction cannot conceal an unrecorded historical claim mutation inside recovery bundles", async () => {
  const { first, change } = await firstClaim();
  const second = await publishPrivateMemoryGit({
    scope,
    bundle: first.bundle,
    head: first.receipt.revision,
    change: {
      action: "assert",
      operationId: randomUUID(),
      claimId: randomUUID(),
      expectedRevision: first.receipt.revision,
      body: body("Second recorded claim"),
    },
    publication: async () => publication(2),
  });
  if (!second.applied || !("claim" in second))
    throw new Error("Expected second recorded publication");
  const forged = await withGitBundle(
    { bundle: second.bundle, limits: privateMemoryGitLimits },
    async ({ directory, git }) => {
      await git(["read-tree", second.receipt.revision]);
      const path = `${directory}/hidden.json`;
      await writeFile(
        path,
        JSON.stringify({
          ...first.claim.file,
          state: {
            kind: "active",
            body: {
              ...body("Hidden unrecorded historical claim"),
              sources: [
                {
                  kind: "file",
                  path: "knowledge/unrecorded.md",
                  revision: "f".repeat(40),
                  excerpt: "Unrecorded source which must never be exported",
                },
              ],
            },
          },
        }) + "\n"
      );
      const hiddenBlob = (await git(["hash-object", "-w", "--", path])).trim();
      await git([
        "update-index",
        "--cacheinfo",
        `100644,${hiddenBlob},claims/${change.claimId}.json`,
      ]);
      const hiddenTree = (await git(["write-tree"])).trim();
      const hiddenHead = (
        await git([
          "commit-tree",
          hiddenTree,
          "-p",
          first.receipt.revision,
          "-m",
          JSON.stringify(second.operation),
        ])
      ).trim();
      const restoration = planLearnedClaim({
        scope,
        current: { ...second.snapshot, revision: hiddenHead },
        change: {
          action: "correct",
          operationId: randomUUID(),
          claimId: change.claimId,
          expectedRevision: hiddenHead,
          body: body("First claim restored through a recorded correction"),
        },
        publication: publication(3),
      });
      if (!restoration.applied) throw new Error("Expected correction plan");
      await git(["read-tree", hiddenHead]);
      await writeFile(path, JSON.stringify(restoration.file) + "\n");
      const repairedBlob = (
        await git(["hash-object", "-w", "--", path])
      ).trim();
      await git([
        "update-index",
        "--cacheinfo",
        `100644,${repairedBlob},claims/${change.claimId}.json`,
      ]);
      const repairedTree = (await git(["write-tree"])).trim();
      const head = (
        await git([
          "commit-tree",
          repairedTree,
          "-p",
          hiddenHead,
          "-m",
          JSON.stringify(restoration.operation),
        ])
      ).trim();
      await git(["update-ref", "refs/heads/main", head]);
      const bundlePath = `${directory}/hidden-history.bundle`;
      await git(["bundle", "create", bundlePath, "--all"]);
      return { head, bundle: await readFile(bundlePath) };
    }
  );
  await expect(
    readPrivateMemoryGit({ scope, ...forged, includeRetainedSources: true })
  ).rejects.toThrow(GitBundleError);
  await expect(readPrivateMemoryGit({ scope, ...forged })).rejects.toThrow(
    GitBundleError
  );
});

test("a later recorded reversal cannot hide an active payload forged into an older clear commit", async () => {
  const { first, change } = await firstClaim();
  const cleared = await publishPrivateMemoryGit({
    scope,
    head: first.receipt.revision,
    bundle: first.bundle,
    change: {
      action: "clear",
      operationId: randomUUID(),
      expectedRevision: first.receipt.revision,
    },
    publication: async () => publication(2),
  });
  if (!cleared.applied) throw new Error("Expected canonical clear");
  const forged = await withGitBundle(
    { bundle: cleared.bundle, limits: privateMemoryGitLimits },
    async ({ directory, git }) => {
      await git(["read-tree", cleared.receipt.revision]);
      const path = `${directory}/hidden-clear.json`;
      await writeFile(
        path,
        JSON.stringify({
          ...first.claim.file,
          predecessor: first.receipt.revision,
          state: {
            kind: "active",
            body: {
              ...body("Clear must not retain an unrecorded active payload"),
              sources: [
                {
                  kind: "file",
                  path: "knowledge/hidden-clear.md",
                  revision: "f".repeat(40),
                  excerpt: "Unrecorded historical clear source",
                },
              ],
            },
          },
        }) + "\n"
      );
      const blob = (await git(["hash-object", "-w", "--", path])).trim();
      await git([
        "update-index",
        "--cacheinfo",
        `100644,${blob},claims/${change.claimId}.json`,
      ]);
      const tree = (await git(["write-tree"])).trim();
      const hiddenClear = (
        await git([
          "commit-tree",
          tree,
          "-p",
          first.receipt.revision,
          "-m",
          JSON.stringify(cleared.operation),
        ])
      ).trim();
      const reversal = planLearnedClaim({
        scope,
        current: { ...cleared.snapshot, revision: hiddenClear },
        change: {
          action: "reverse",
          claimId: change.claimId,
          operationId: randomUUID(),
          expectedRevision: hiddenClear,
          targetRevision: first.receipt.revision,
        },
        publication: publication(3),
        reversalTarget: first.claim,
      });
      if (!reversal.applied) throw new Error("Expected recorded reversal");
      await git(["read-tree", hiddenClear]);
      await writeFile(path, JSON.stringify(reversal.file) + "\n");
      const repaired = (await git(["hash-object", "-w", "--", path])).trim();
      await git([
        "update-index",
        "--cacheinfo",
        `100644,${repaired},claims/${change.claimId}.json`,
      ]);
      const repairedTree = (await git(["write-tree"])).trim();
      const head = (
        await git([
          "commit-tree",
          repairedTree,
          "-p",
          hiddenClear,
          "-m",
          JSON.stringify(reversal.operation),
        ])
      ).trim();
      await git(["update-ref", "refs/heads/main", head]);
      const bundle = `${directory}/hidden-clear.bundle`;
      await git(["bundle", "create", bundle, "--all"]);
      return { head, bundle: await readFile(bundle) };
    }
  );
  await expect(
    readPrivateMemoryGit({ scope, ...forged, includeRetainedSources: true })
  ).rejects.toThrow(GitBundleError);
  await expect(readPrivateMemoryGit({ scope, ...forged })).rejects.toThrow(
    GitBundleError
  );
});

test("complete history fails at its UTF-8 byte budget instead of returning a partial prefix", async () => {
  const claimId = randomUUID();
  const fixture = await withGitBundle(
    { bundle: null, limits: privateMemoryGitLimits },
    async ({ directory, git }) => {
      let current = validateLearnedClaimSnapshot(scope, {
        scope,
        revision: null,
        recordedAt: null,
        claims: [],
      });
      let historyBytes = 2;
      const sources = Array.from({ length: 10 }, (_, index) => ({
        kind: "session" as const,
        sessionId: "synthetic-large-history",
        eventId: `synthetic-event-${index}`,
        sha256: "a".repeat(64),
        excerpt: "é".repeat(2000),
      }));
      // Construct valid native commits once rather than repeatedly importing
      // a growing bundle. Each file fits; the complete historical response does not.
      for (let index = 0; index < 150; index++) {
        const plan = planLearnedClaim({
          scope,
          current,
          change: {
            action: index === 0 ? "assert" : "correct",
            claimId,
            operationId: randomUUID(),
            expectedRevision: current.revision,
            body: { ...body(`Version ${index} ${"é".repeat(7800)}`), sources },
          },
          publication: publication(index + 1),
        });
        if (!plan.applied) throw new Error("Expected a new historical version");
        const encoded = JSON.stringify(plan.file) + "\n";
        expect(Buffer.byteLength(encoded)).toBeLessThanOrEqual(
          privateMemoryGitLimits.fileBytes
        );
        const path = `${directory}/claim.json`;
        await writeFile(path, encoded, { mode: 0o600 });
        const blob = (await git(["hash-object", "-w", "--", path])).trim();
        await git([
          "update-index",
          "--add",
          "--cacheinfo",
          `100644,${blob},claims/${claimId}.json`,
        ]);
        const tree = (await git(["write-tree"])).trim();
        const revision = (
          await git([
            "commit-tree",
            tree,
            ...(current.revision ? ["-p", current.revision] : []),
            "-m",
            JSON.stringify(plan.operation),
          ])
        ).trim();
        const bound = bindLearnedClaimPublication({ plan, current, revision });
        current = bound.snapshot;
        historyBytes +=
          Buffer.byteLength(JSON.stringify(bound.claim)) + (index ? 1 : 0);
      }
      const head = current.revision;
      if (!head) throw new Error("Missing native Git history");
      expect(historyBytes).toBeGreaterThan(privateMemoryGitLimits.outputBytes);
      await git(["update-ref", "refs/heads/main", head]);
      const path = `${directory}/large-history.bundle`;
      await git(["bundle", "create", path, "--all"]);
      return { head, bundle: await readFile(path) };
    }
  );
  const ordinary = await readPrivateMemoryGit({ scope, ...fixture });
  expect(ordinary.operations).toHaveLength(150);
  expect(ordinary.history).toEqual([]);
  expect(ordinary.snapshot.claims).toHaveLength(1);
  await expect(
    readPrivateMemoryGit({ scope, ...fixture, historyClaimId: claimId })
  ).rejects.toMatchObject({ reason: "too_large" });
}, 20_000);
