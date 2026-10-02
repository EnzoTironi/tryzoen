import {
  GitRevisionSchema,
  WorkspacePathSchema,
  WorkspaceChangesSchema,
} from "@zoen/companion-ui/workspace-files";
import * as fs from "node:fs/promises";
import { z } from "zod";
import { mapAsync } from "../operations/async";
import { GitBundleError, withGitBundle, type GitBundle } from "../files/git";

export const workspaceGitLimits = {
  fileBytes: 262_144,
  bundleBytes: 25_165_824,
  files: 200,
} as const;

export const readWorkspaceGit = async function (
  bundle: Uint8Array,
  revision: string,
  path?: string
) {
  return withGitBundle(
    { bundle, limits: workspaceGitLimits },
    async ({ git }) => {
      const sha = await GitRevisionSchema.parseAsync(revision);
      if (path !== undefined) {
        const files: string[] = [];
        const filename = await WorkspacePathSchema.parseAsync(path);
        return {
          content: await git(["show", `${sha}:${filename}`]),
          files,
        };
      }
      const files = (await git(["ls-tree", "-r", "--name-only", "-z", sha]))
        .split("\0")
        .filter(Boolean);
      return { content: null, files };
    }
  );
};

type WorkspaceGitReader = (
  paths: readonly string[]
) => Promise<{ path: string; content: string }[]>;

/** Resolve linked definitions inside one immutable reconstruction. */
export const readWorkspaceGitSelection = async function (
  bundle: Uint8Array,
  revision: string,
  selection:
    | readonly string[]
    | ((read: WorkspaceGitReader) => ReturnType<WorkspaceGitReader>)
) {
  return withGitBundle(
    { bundle, limits: workspaceGitLimits },
    async ({ git }) => {
      const sha = await GitRevisionSchema.parseAsync(revision);
      const files = new Set(
        (await git(["ls-tree", "-r", "--name-only", "-z", sha]))
          .split("\0")
          .filter(Boolean)
      );
      const read: WorkspaceGitReader = async (paths) => {
        const selected = await z
          .array(WorkspacePathSchema)
          .max(24)
          .parseAsync(paths);
        return mapAsync(
          [...new Set(selected)].filter((path) => files.has(path)),
          async (path) => ({
            path,
            content: await git(["show", `${sha}:${path}`]),
          }),
          4
        );
      };
      return typeof selection === "function"
        ? selection(read)
        : read(selection);
    }
  );
};

export const searchWorkspaceGit = async function (
  bundle: Uint8Array,
  revision: string,
  query: string
) {
  return withGitBundle(
    { bundle, limits: workspaceGitLimits },
    async ({ git }) => {
      const sha = await GitRevisionSchema.parseAsync(revision);
      const term = await z.string().min(1).max(200).parseAsync(query);
      const found = await git(
        [
          "grep",
          "-I",
          "-n",
          "-i",
          "-F",
          "--max-count=3",
          "-e",
          term,
          sha,
          "--",
          "knowledge/",
        ],
        1
      );
      return found
        .split("\n")
        .filter(Boolean)
        .slice(0, 60)
        .map((line) => line.slice(sha.length + 1, sha.length + 801));
    }
  );
};

async function stageWorkspaceChanges(
  { directory, git }: GitBundle,
  changes: z.output<typeof WorkspaceChangesSchema>
) {
  for (const { content } of changes) {
    if (
      content !== null &&
      Buffer.byteLength(content) > workspaceGitLimits.fileBytes
    )
      throw new GitBundleError({ reason: "too_large" });
    if (content?.includes("\0"))
      throw new GitBundleError({ reason: "invalid_file" });
  }
  // Remove first so a batch may replace a file with a directory, or vice versa.
  for (const { path, content } of changes) {
    if (content === null)
      await git(["update-index", "--force-remove", "--", path]);
  }
  for (const { path, content } of changes) {
    if (content === null) continue;
    const file = `${directory}/content`;
    await fs.writeFile(file, content, { mode: 0o600 });
    const blob = (await git(["hash-object", "-w", "--", file])).trim();
    await git([
      "update-index",
      "--add",
      "--cacheinfo",
      `100644,${blob},${path}`,
    ]);
  }
}

export const publishWorkspaceGit = async function (input: {
  readonly bundle: Uint8Array | null;
  readonly parent: string | null;
  readonly changes: z.input<typeof WorkspaceChangesSchema>;
  readonly message: string;
}) {
  return withGitBundle(
    { bundle: input.bundle, limits: workspaceGitLimits },
    async (location) => {
      const { directory, git } = location;
      const changes = await WorkspaceChangesSchema.parseAsync(input.changes);
      const parent =
        input.parent === null
          ? null
          : await GitRevisionSchema.parseAsync(input.parent);
      if (parent) await git(["read-tree", parent]);
      await stageWorkspaceChanges(location, changes);
      const tree = (await git(["write-tree"])).trim();
      const files = (await git(["ls-tree", "-r", "--name-only", "-z", tree]))
        .split("\0")
        .filter(Boolean);
      if (
        files.filter((path) => path.startsWith("proposals/knowledge/")).length >
        24
      )
        throw new GitBundleError({ reason: "too_large" });
      if (files.length > workspaceGitLimits.files)
        throw new GitBundleError({ reason: "too_large" });
      const revision = (
        await git([
          "commit-tree",
          tree,
          ...(parent ? ["-p", parent] : []),
          "-m",
          input.message,
        ])
      ).trim();
      await git(["update-ref", "refs/heads/main", revision]);
      const destination = `${directory}/published.bundle`;
      await git(["bundle", "create", destination, "--all"]);
      const info = await fs.stat(destination);
      if (info.size > workspaceGitLimits.bundleBytes)
        throw new GitBundleError({ reason: "too_large" });
      return {
        revision,
        bundle: Buffer.from(await fs.readFile(destination)),
        files,
      };
    }
  );
};
