import { execFile } from "node:child_process";
import * as fs from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { promisify } from "node:util";
import { z } from "zod";
import { env } from "@shared/environment/env";
import { operationSignal, withTimeout, mapAsync } from "../operations/async";

export const workspaceGitLimits = {
  fileBytes: 262_144,
  bundleBytes: 25_165_824,
  files: 200,
} as const;
export const WorkspacePathSchema = z
  .string()
  .regex(
    /^(?:(?:knowledge|skills|agent|proposals\/skills)\/[a-zA-Z0-9][a-zA-Z0-9_./-]{0,180}\.md|(?:plugins|ontology)\/workspace\.json|(?:tools|proposals\/tools)\/[a-z][a-z0-9-]{0,39}\.json)$/
  )
  .regex(/^(?!.*(?:\/\.|\.\.|\/\/)).*$/);
export const GitRevisionSchema = z.string().regex(/^[a-f0-9]{40}$/);

export class WorkspaceGitError extends Error {
  readonly _tag = "WorkspaceGitError";
  declare readonly reason: "invalid_file" | "too_large" | "unavailable";
  constructor(input: {
    readonly reason: "invalid_file" | "too_large" | "unavailable";
  }) {
    super("WorkspaceGitError");
    this.name = "WorkspaceGitError";
    Object.assign(this, input);
  }
}

const runGit = promisify(execFile);
async function git(
  directory: string,
  args: readonly string[],
  allowedExitCode = 0
) {
  try {
    const { stdout } = await runGit(
      "git",
      [
        "-c",
        "core.hooksPath=/dev/null",
        "-c",
        "protocol.allow=never",
        "-c",
        "commit.gpgSign=false",
        "--git-dir",
        directory,
        ...(args[0] === "init" ? [] : ["--work-tree", `${directory}/worktree`]),
        ...args,
      ],
      {
        env: {
          NODE_ENV: "production",
          PATH: env.PATH ?? "",
          GIT_CONFIG_NOSYSTEM: "1",
          GIT_CONFIG_GLOBAL: "/dev/null",
          GIT_AUTHOR_NAME: "Zoen",
          GIT_AUTHOR_EMAIL: "workspace@zoen.invalid",
          GIT_COMMITTER_NAME: "Zoen",
          GIT_COMMITTER_EMAIL: "workspace@zoen.invalid",
        },
        maxBuffer: workspaceGitLimits.fileBytes * 2,
        signal: operationSignal(),
        killSignal: "SIGKILL",
      }
    );
    return stdout;
  } catch (error) {
    if (error instanceof Error && "code" in error) {
      if (
        error.code === allowedExitCode &&
        "stdout" in error &&
        typeof error.stdout === "string"
      )
        return error.stdout;
      if (error.code === "ERR_CHILD_PROCESS_STDIO_MAXBUFFER")
        throw new WorkspaceGitError({ reason: "too_large" });
    }
    throw new WorkspaceGitError({ reason: "unavailable" });
  }
}

async function withBundle<T>(
  bundle: Uint8Array | null,
  run: (location: { directory: string; repository: string }) => Promise<T>,
  timeout = 15_000
) {
  let directory: string | undefined;
  try {
    if (bundle && bundle.length > workspaceGitLimits.bundleBytes)
      throw new WorkspaceGitError({ reason: "too_large" });
    directory = await fs.mkdtemp(join(tmpdir(), "zoen-git-"));
    const location = { directory, repository: join(directory, "repository") };
    return await withTimeout(async () => {
      await git(location.repository, [
        "init",
        "--bare",
        "--initial-branch=main",
        location.repository,
      ]);
      await fs.mkdir(join(location.repository, "worktree"));
      if (bundle) {
        const source = join(location.directory, "source.bundle");
        await fs.writeFile(source, bundle, { mode: 0o600 });
        await git(location.repository, ["bundle", "unbundle", source]);
      }
      return run(location);
    }, timeout);
  } catch (error) {
    if (error instanceof WorkspaceGitError) throw error;
    throw new WorkspaceGitError({
      reason: error instanceof z.ZodError ? "invalid_file" : "unavailable",
    });
  } finally {
    if (directory) await fs.rm(directory, { recursive: true, force: true });
  }
}

export const readWorkspaceGit = async function (
  bundle: Uint8Array,
  revision: string,
  path?: string
) {
  return withBundle(bundle, async ({ repository }) => {
    const sha = await GitRevisionSchema.parseAsync(revision);
    if (path !== undefined) {
      const files: string[] = [];
      const filename = await WorkspacePathSchema.parseAsync(path);
      return {
        content: await git(repository, ["show", `${sha}:${filename}`]),
        files,
      };
    }
    const files = (
      await git(repository, ["ls-tree", "-r", "--name-only", "-z", sha])
    )
      .split("\0")
      .filter(Boolean);
    return { content: null, files };
  });
};

export const readWorkspaceGitSelection = async function (
  bundle: Uint8Array,
  revision: string,
  paths: readonly string[]
) {
  return withBundle(bundle, async ({ repository }) => {
    const sha = await GitRevisionSchema.parseAsync(revision);
    const selected = await z
      .array(WorkspacePathSchema)
      .max(24)
      .parseAsync(paths);
    return await mapAsync(
      selected,
      async function (path) {
        return {
          path,
          content: await git(repository, ["show", `${sha}:${path}`]),
        };
      },
      4
    );
  });
};

export const searchWorkspaceGit = async function (
  bundle: Uint8Array,
  revision: string,
  query: string
) {
  return withBundle(bundle, async ({ repository }) => {
    const sha = await GitRevisionSchema.parseAsync(revision);
    const term = await z.string().min(1).max(200).parseAsync(query);
    const found = await git(
      repository,
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
  });
};

export const publishWorkspaceGit = async function (input: {
  readonly bundle: Uint8Array | null;
  readonly parent: string | null;
  readonly path: string;
  readonly content: string | null;
  readonly message: string;
  readonly remove?: string;
}) {
  return withBundle(input.bundle, async ({ directory, repository }) => {
    const path = await WorkspacePathSchema.parseAsync(input.path);
    const removed =
      input.remove === undefined
        ? null
        : await WorkspacePathSchema.parseAsync(input.remove);
    if (removed === path)
      throw new WorkspaceGitError({ reason: "invalid_file" });
    const parent =
      input.parent === null
        ? null
        : await GitRevisionSchema.parseAsync(input.parent);
    if (
      input.content !== null &&
      Buffer.byteLength(input.content) > workspaceGitLimits.fileBytes
    )
      throw new WorkspaceGitError({ reason: "too_large" });
    if (input.content?.includes("\0"))
      throw new WorkspaceGitError({ reason: "invalid_file" });
    if (parent) await git(repository, ["read-tree", parent]);
    if (input.content === null)
      await git(repository, ["update-index", "--force-remove", "--", path]);
    else {
      const file = `${directory}/content`;
      await fs.writeFile(file, input.content, { mode: 0o600 });
      const blob = (
        await git(repository, ["hash-object", "-w", "--", file])
      ).trim();
      await git(repository, [
        "update-index",
        "--add",
        "--cacheinfo",
        `100644,${blob},${path}`,
      ]);
    }
    if (removed)
      await git(repository, ["update-index", "--force-remove", "--", removed]);
    const tree = (await git(repository, ["write-tree"])).trim();
    const files = (
      await git(repository, ["ls-tree", "-r", "--name-only", "-z", tree])
    )
      .split("\0")
      .filter(Boolean);
    if (files.length > workspaceGitLimits.files)
      throw new WorkspaceGitError({ reason: "too_large" });
    const revision = (
      await git(repository, [
        "commit-tree",
        tree,
        ...(parent ? ["-p", parent] : []),
        "-m",
        input.message,
      ])
    ).trim();
    await git(repository, ["update-ref", "refs/heads/main", revision]);
    const destination = `${directory}/published.bundle`;
    await git(repository, ["bundle", "create", destination, "--all"]);
    const info = await fs.stat(destination);
    if (info.size > workspaceGitLimits.bundleBytes)
      throw new WorkspaceGitError({ reason: "too_large" });
    return {
      revision,
      bundle: Buffer.from(await fs.readFile(destination)),
      files,
    };
  });
};
