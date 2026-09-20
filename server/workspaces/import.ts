import { execFile } from "node:child_process";
import { mkdtemp, writeFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { promisify } from "node:util";
import { createHash } from "node:crypto";
import { env } from "@shared/environment/env";
import { operationSignal } from "../operations/async";
import { workspaceGitLimits } from "./git";

export const workspaceImportBytes = 10 * 1024 * 1024;
const supportedExtensions = new Set([
  "md",
  "txt",
  "csv",
  "pdf",
  "doc",
  "docx",
  "odt",
  "rtf",
  "epub",
  "ppt",
  "pptx",
  "xlsx",
  "xls",
  "ods",
  "odp",
]);

export class WorkspaceImportError extends Error {
  readonly _tag = "WorkspaceImportError";
  declare readonly reason:
    | "too_large"
    | "unsupported"
    | "needs_ocr"
    | "invalid_document";
  constructor(input: {
    readonly reason:
      | "too_large"
      | "unsupported"
      | "needs_ocr"
      | "invalid_document";
  }) {
    super("WorkspaceImportError");
    this.name = "WorkspaceImportError";
    Object.assign(this, input);
  }
}

const runConverter = promisify(execFile);
export async function convertWorkspaceDocument(
  filename: string,
  bytes: Uint8Array
) {
  if (bytes.length === 0 || bytes.length > workspaceImportBytes)
    throw new WorkspaceImportError({ reason: "too_large" });
  const extension = filename.split(".").at(-1)?.toLowerCase() ?? "";
  if (!supportedExtensions.has(extension))
    throw new WorkspaceImportError({ reason: "unsupported" });
  const sha256 = createHash("sha256").update(bytes).digest("hex");
  let directory: string | undefined;
  try {
    if (extension === "md" || extension === "txt") {
      if (bytes.length > workspaceGitLimits.fileBytes)
        throw new WorkspaceImportError({ reason: "too_large" });
      const content = new TextDecoder("utf-8", { fatal: true }).decode(bytes);
      if (content.includes("\0"))
        throw new WorkspaceImportError({ reason: "invalid_document" });
      return { content, sha256 };
    }
    directory = await mkdtemp(join(tmpdir(), "zoen-import-"));
    const file = join(directory, `document.${extension}`);
    await writeFile(file, bytes, { mode: 0o600 });
    const { stdout: content } = await runConverter(
      process.execPath,
      [
        "--max-old-space-size=128",
        "--input-type=commonjs",
        "--eval",
        // Resolve inside Node: Turbopack turns require.resolve into a module ID.
        "process.argv.splice(1, 0, 'anydoc'); require('@firecrawl/anydoc/cli.js');",
        file,
        "--ocr",
        "reject",
      ],
      {
        env: { NODE_ENV: "production", PATH: env.PATH ?? "" },
        timeout: 20_000,
        killSignal: "SIGKILL",
        maxBuffer: workspaceGitLimits.fileBytes,
        signal: operationSignal(),
      }
    );
    if (!content.length)
      throw new WorkspaceImportError({ reason: "invalid_document" });
    return { content, sha256 };
  } catch (error) {
    if (error instanceof WorkspaceImportError) throw error;
    const code = error instanceof Error && "code" in error ? error.code : null;
    throw new WorkspaceImportError({
      reason:
        code === 3
          ? "needs_ocr"
          : code === "ERR_CHILD_PROCESS_STDIO_MAXBUFFER"
            ? "too_large"
            : "invalid_document",
    });
  } finally {
    if (directory) await rm(directory, { recursive: true, force: true });
  }
}
