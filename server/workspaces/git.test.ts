import { GitBundleError } from "../files/git";
import { expect, test } from "vitest";
import {
  publishWorkspaceGit,
  readWorkspaceGit,
  readWorkspaceGitSelection,
} from "./git";

test("exports real Git history and restores prior file contents from a fresh bundle", async () => {
  const initial = await publishWorkspaceGit({
    bundle: null,
    parent: null,
    changes: [{ path: "knowledge/plan.md", content: "# Original\n" }],
    message: "Create plan",
  });
  expect(initial.bundle.subarray(0, 16).toString()).toContain("git bundle");
  const updated = await publishWorkspaceGit({
    bundle: initial.bundle,
    parent: initial.revision,
    changes: [{ path: "knowledge/plan.md", content: "# Revised\n" }],
    message: "Revise plan",
  });
  const previous = await readWorkspaceGit(
    updated.bundle,
    initial.revision,
    "knowledge/plan.md"
  );
  const current = await readWorkspaceGit(
    updated.bundle,
    updated.revision,
    "knowledge/plan.md"
  );
  expect(previous.content).toBe("# Original\n");
  expect(current.content).toBe("# Revised\n");
  const deleted = await publishWorkspaceGit({
    bundle: updated.bundle,
    parent: updated.revision,
    changes: [{ path: "knowledge/plan.md", content: null }],
    message: "Remove plan",
  });
  expect(
    (await readWorkspaceGit(deleted.bundle, deleted.revision)).files
  ).toEqual([]);
  expect(
    (await readWorkspaceGit(deleted.bundle, initial.revision)).files
  ).toEqual(["knowledge/plan.md"]);
});

test("adds a published skill and removes its proposal in one revision", async () => {
  const drafted = await publishWorkspaceGit({
    bundle: null,
    parent: null,
    changes: [
      {
        path: "proposals/skills/inbox.md",
        content: "---\nrequires: []\n---\n# Inbox\n",
      },
    ],
    message: "Propose inbox",
  });
  const published = await publishWorkspaceGit({
    bundle: drafted.bundle,
    parent: drafted.revision,
    changes: [
      { path: "skills/inbox.md", content: "---\nrequires: []\n---\n# Inbox\n" },
      { path: "proposals/skills/inbox.md", content: null },
    ],
    message: "Publish inbox",
  });
  expect(
    (await readWorkspaceGit(published.bundle, published.revision)).files
  ).toEqual(["skills/inbox.md"]);
  expect(
    (await readWorkspaceGit(drafted.bundle, drafted.revision)).files
  ).toEqual(["proposals/skills/inbox.md"]);
});

test.each([
  "../secret.md",
  "knowledge/../../secret.md",
  "agent/.git/hooks.md",
  "knowledge/a\nb.md",
  "knowledge/a..b.md",
  "skills/run.ts",
  "proposals/secret.md",
  "proposals/skills/run.ts",
])("rejects unsafe or executable workspace paths: %s", async (path) => {
  const result = await Promise.try(async () =>
    publishWorkspaceGit({
      bundle: null,
      parent: null,
      changes: [{ path, content: "content" }],
      message: "Invalid",
    })
  ).then(
    (value) => ({ ok: true as const, value }),
    (error: unknown) => ({ ok: false as const, error })
  );
  expect(!result.ok && result.error).toBeInstanceOf(GitBundleError);
});

test("enforces byte limits and rejects corrupt bundles instead of returning missing files", async () => {
  const oversized = await Promise.try(async () =>
    publishWorkspaceGit({
      bundle: null,
      parent: null,
      changes: [{ path: "knowledge/large.md", content: "🌳".repeat(100_000) }],
      message: "Too large",
    })
  ).then(
    (value) => ({ ok: true as const, value }),
    (error: unknown) => ({ ok: false as const, error })
  );
  expect(!oversized.ok && oversized.error).toMatchObject({
    reason: "too_large",
  });
  const corrupt = await Promise.try(async () =>
    readWorkspaceGit(Buffer.from("invalid"), "a".repeat(40))
  ).then(
    (value) => ({ ok: true as const, value }),
    (error: unknown) => ({ ok: false as const, error })
  );
  expect(!corrupt.ok && corrupt.error).toMatchObject({
    reason: "unavailable",
  });
});

test("selects existing files from the captured revision without losing deleted history", async () => {
  const first = await publishWorkspaceGit({
    bundle: null,
    parent: null,
    changes: [{ path: "knowledge/old.md", content: "Original" }],
    message: "Create source",
  });
  const current = await publishWorkspaceGit({
    bundle: first.bundle,
    parent: first.revision,
    changes: [
      { path: "knowledge/old.md", content: null },
      { path: "knowledge/new.md", content: "Current" },
    ],
    message: "Move source",
  });
  const paths = [
    "knowledge/old.md",
    "knowledge/new.md",
    "knowledge/missing.md",
  ];
  expect(
    await readWorkspaceGitSelection(current.bundle, first.revision, paths)
  ).toEqual([{ path: "knowledge/old.md", content: "Original" }]);
  expect(
    await readWorkspaceGitSelection(current.bundle, current.revision, paths)
  ).toEqual([{ path: "knowledge/new.md", content: "Current" }]);
  await expect(
    readWorkspaceGitSelection(Buffer.from("invalid"), current.revision, paths)
  ).rejects.toMatchObject({ reason: "unavailable" });
});

test("linked discovery stays at its captured revision after the current source changes", async () => {
  const original = await publishWorkspaceGit({
    bundle: null,
    parent: null,
    changes: [
      { path: "knowledge/index.md", content: "knowledge/fact.md" },
      { path: "knowledge/fact.md", content: "Original fact" },
    ],
    message: "Publish linked knowledge",
  });
  const latest = await publishWorkspaceGit({
    bundle: original.bundle,
    parent: original.revision,
    changes: [{ path: "knowledge/fact.md", content: "Corrected fact" }],
    message: "Correct fact",
  });
  const documents = await readWorkspaceGitSelection(
    latest.bundle,
    original.revision,
    async (read) => {
      const index = await read(["knowledge/index.md"]);
      return [...index, ...(await read([index[0]?.content ?? ""]))];
    }
  );
  expect(documents).toEqual([
    { path: "knowledge/index.md", content: "knowledge/fact.md" },
    { path: "knowledge/fact.md", content: "Original fact" },
  ]);
});
