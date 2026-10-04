import { execFile } from "node:child_process";
import * as fs from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { promisify } from "node:util";
import { z } from "zod";
import { nativeProcessEnvironment } from "@shared/environment/env/native-process";
import {
  operationSignal,
  withTimeout,
  TimeoutError,
} from "../operations/async";

export class GitBundleError extends Error {
  readonly _tag = "GitBundleError";
  constructor(
    readonly input: { reason: "invalid_file" | "too_large" | "unavailable" }
  ) {
    super("GitBundleError");
    this.name = "GitBundleError";
  }
  get reason() {
    return this.input.reason;
  }
}

export interface GitBundle {
  directory: string;
  repository: string;
  git: (args: readonly string[], allowedExitCode?: number) => Promise<string>;
}
const executeGit = promisify(execFile);
const env = nativeProcessEnvironment();

/** Temporary native Git reconstruction only. Owners choose strict paths, scopes,
 * publication policy and budgets; this boundary grants no data authorization. */
export async function withGitBundle<Result>(
  input: {
    bundle: Uint8Array | null;
    limits: { bundleBytes: number; fileBytes: number; outputBytes?: number };
    timeoutMs?: number;
  },
  run: (bundle: GitBundle) => Promise<Result>
) {
  let directory: string | undefined;
  try {
    if (input.bundle && input.bundle.byteLength > input.limits.bundleBytes)
      throw new GitBundleError({ reason: "too_large" });
    directory = await fs.mkdtemp(join(tmpdir(), "zoen-git-")).catch(() => {
      throw new GitBundleError({ reason: "unavailable" });
    });
    const location = { directory, repository: join(directory, "repository") };
    const git: GitBundle["git"] = async (args, allowedExitCode = 0) => {
      try {
        const { stdout } = await executeGit(
          "git",
          [
            "-c",
            "core.hooksPath=/dev/null",
            "-c",
            "protocol.allow=never",
            "-c",
            "commit.gpgSign=false",
            "--git-dir",
            location.repository,
            ...(args[0] === "init"
              ? []
              : ["--work-tree", `${location.repository}/worktree`]),
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
            maxBuffer: input.limits.outputBytes ?? input.limits.fileBytes * 2,
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
            throw new GitBundleError({ reason: "too_large" });
        }
        throw new GitBundleError({ reason: "unavailable" });
      }
    };
    return await withTimeout(async () => {
      try {
        await git([
          "init",
          "--bare",
          "--initial-branch=main",
          location.repository,
        ]);
        await fs.mkdir(join(location.repository, "worktree"));
        if (input.bundle) {
          const source = join(location.directory, "source.bundle");
          await fs.writeFile(source, input.bundle, { mode: 0o600 });
          await git(["bundle", "unbundle", source]);
        }
      } catch (error) {
        if (error instanceof GitBundleError) throw error;
        throw new GitBundleError({ reason: "unavailable" });
      }
      return run({ ...location, git });
    }, input.timeoutMs ?? 15_000);
  } catch (error) {
    if (error instanceof GitBundleError) throw error;
    if (error instanceof z.ZodError)
      throw new GitBundleError({ reason: "invalid_file" });
    if (error instanceof TimeoutError)
      throw new GitBundleError({ reason: "unavailable" });
    throw error;
  } finally {
    if (directory) await fs.rm(directory, { recursive: true, force: true });
  }
}
