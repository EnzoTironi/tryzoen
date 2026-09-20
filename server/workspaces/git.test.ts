import { expect, test } from "vitest";
import {
  publishWorkspaceGit,
  readWorkspaceGit,
  WorkspaceGitError,
} from "./git";

test("exports real Git history and restores prior file contents from a fresh bundle", async () => {
  const initial = await publishWorkspaceGit({
    bundle: null,
    parent: null,
    path: "knowledge/plan.md",
    content: "# Original\n",
    message: "Create plan",
  });
  expect(initial.bundle.subarray(0, 16).toString()).toContain("git bundle");
  const updated = await publishWorkspaceGit({
    bundle: initial.bundle,
    parent: initial.revision,
    path: "knowledge/plan.md",
    content: "# Revised\n",
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
    path: "knowledge/plan.md",
    content: null,
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
    path: "proposals/skills/inbox.md",
    content: "---\nrequires: []\n---\n# Inbox\n",
    message: "Propose inbox",
  });
  const published = await publishWorkspaceGit({
    bundle: drafted.bundle,
    parent: drafted.revision,
    path: "skills/inbox.md",
    content: "---\nrequires: []\n---\n# Inbox\n",
    message: "Publish inbox",
    remove: "proposals/skills/inbox.md",
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
      path,
      content: "content",
      message: "Invalid",
    })
  ).then(
    (value) => ({ ok: true as const, value }),
    (error: unknown) => ({ ok: false as const, error })
  );
  expect(!result.ok && result.error).toBeInstanceOf(WorkspaceGitError);
});

test("enforces byte limits and rejects corrupt bundles instead of returning missing files", async () => {
  const oversized = await Promise.try(async () =>
    publishWorkspaceGit({
      bundle: null,
      parent: null,
      path: "knowledge/large.md",
      content: "🌳".repeat(100_000),
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
