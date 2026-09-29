import { createHash } from "node:crypto";
import { constants } from "node:fs";
import { lstat, open, opendir } from "node:fs/promises";
import { join } from "node:path";
import { zipSync } from "fflate";
import { readBody } from "../../http/body";
import { operationSignal } from "../../operations/async";
import type { openMemoryEngine } from "./engine";

/** Native online SQLite snapshot plus wiki/Git/config; no engine authority leaves this process. */
export async function nativeMemoryBackup(
  address: URL,
  headers: Record<string, string>
) {
  const response = await fetch(new URL("/admin/backup", address), {
    method: "POST",
    headers,
    redirect: "error",
    signal: AbortSignal.any([operationSignal(), AbortSignal.timeout(30_000)]),
  });
  if (
    !response.ok ||
    response.headers.get("content-type") !== "application/gzip"
  ) {
    await response.body?.cancel();
    throw new Error("Memory backup failed.");
  }
  const archive = await readBody(response.body, 48 * 1024 * 1024);
  if (archive.length < 20 || archive[0] !== 0x1f || archive[1] !== 0x8b)
    throw new Error("Memory backup is incomplete.");
  return archive;
}

async function operationReceipts(data: string) {
  const directory = join(data, "zoen-operations");
  const info = await lstat(directory).catch((error: unknown) => {
    if (error instanceof Error && "code" in error && error.code === "ENOENT")
      return null;
    throw error;
  });
  if (!info) return {};
  if (!info.isDirectory() || info.isSymbolicLink() || (info.mode & 0o077) !== 0)
    throw new Error("Memory receipts are not private.");
  const files: Record<string, Uint8Array> = {};
  let bytes = 0;
  let count = 0;
  for await (const entry of await opendir(directory)) {
    operationSignal().throwIfAborted();
    if (
      !entry.isFile() ||
      !/^[0-9a-f]{64}\.json$/.test(entry.name) ||
      ++count > 10_000
    )
      throw new Error("Memory receipts are incomplete.");
    await using file = await open(
      join(directory, entry.name),
      constants.O_RDONLY | constants.O_NOFOLLOW
    );
    const stat = await file.stat();
    if (!stat.isFile() || (stat.mode & 0o077) !== 0 || stat.size > 16 * 1024)
      throw new Error("Memory receipt is invalid.");
    const buffer = Buffer.alloc(16 * 1024 + 1);
    const { bytesRead } = await file.read(buffer);
    bytes += bytesRead;
    if (bytesRead !== stat.size || bytes > 16 * 1024 * 1024)
      throw new Error("Memory receipts exceed the backup limit.");
    files[`zoen-operations/${entry.name}`] = Buffer.from(
      buffer.subarray(0, bytesRead)
    );
  }
  return files;
}

/** Caller fences the owner's namespace against writes and erasure for the entire snapshot. */
export async function learnedMemoryBackup(
  engine: Awaited<ReturnType<typeof openMemoryEngine>>,
  namespace: string
) {
  await engine.checkpoint();
  const files = {
    "akita.tar.gz": await engine.backup(),
    ...(await operationReceipts(engine.data)),
  };
  const manifest = {
    format: "zoen-learned-memory",
    version: 1,
    engine: "ai-memory 2.4.1",
    namespace,
    createdAt: new Date().toISOString(),
    corpus: "learned-memory",
    excludes: [
      "raw-sessions",
      "session-memory",
      "personal-profile",
      "workspace-files",
      "account-database",
    ],
    files: Object.fromEntries(
      Object.entries(files).map(([name, content]) => [
        name,
        {
          bytes: content.byteLength,
          sha256: createHash("sha256").update(content).digest("hex"),
        },
      ])
    ),
  };
  operationSignal().throwIfAborted();
  // Native data is already compressed. Store it without blocking on recompression.
  const archive = zipSync(
    {
      ...files,
      "manifest.json": Buffer.from(JSON.stringify(manifest, null, 2)),
    },
    { level: 0 }
  );
  return Buffer.from(archive.buffer, archive.byteOffset, archive.byteLength);
}
