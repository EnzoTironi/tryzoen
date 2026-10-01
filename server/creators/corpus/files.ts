import { constants } from "node:fs";
import { lstat, open, link, opendir, rm } from "node:fs/promises";
import { join } from "node:path";
import { v5 as uuidv5 } from "uuid";
import { z } from "zod";
import { env } from "../../../shared/environment/env";
import { privateMemoryDirectory } from "../../memory/session-files";
import { operationSignal } from "../../operations/async";
import { corpusDigest, corpusManifestSchema } from "./schema";

const filename = "release-manifest.json";
const staging = ".release-manifest.tmp";
const limit = 262144;

function corpusDirectory(namespace: string) {
  const id = z.uuid().parse(namespace);
  if (!env.ZOEN_SESSION_ARCHIVE_DIR)
    throw new Error(
      "Creator knowledge files are not configured on this installation."
    );
  return {
    root: env.ZOEN_SESSION_ARCHIVE_DIR,
    owner: join(env.ZOEN_SESSION_ARCHIVE_DIR, id),
    directory: join(env.ZOEN_SESSION_ARCHIVE_DIR, id, "creator-knowledge"),
  };
}

function approvedBytes(
  namespace: string,
  approved: z.infer<typeof corpusManifestSchema>
) {
  const manifest = corpusManifestSchema.parse(approved);
  const paths = new Set<string>();
  const ends = new Map<string, number>();
  for (const page of manifest.pages) {
    const entry = `${page.kind}:${page.entryId}`;
    if (
      paths.has(page.path) ||
      page.path !== `notes/${uuidv5(`${entry}:${page.start}`, namespace)}.md` ||
      page.start !== (ends.get(entry) ?? 0) ||
      page.end - page.start !== page.body.length ||
      Buffer.from(page.body, "utf8").toString("utf8") !== page.body ||
      corpusDigest(page.body) !== page.digest
    )
      throw new Error("Creator corpus page failed source verification.");
    paths.add(page.path);
    ends.set(entry, page.end);
  }
  const bytes = Buffer.from(JSON.stringify(manifest), "utf8");
  if (bytes.length > limit)
    throw new Error("Creator corpus manifest exceeds its file limit.");
  return bytes;
}

async function privateDirectory(path: string) {
  const info = await lstat(path);
  if (!info.isDirectory() || info.isSymbolicLink() || (info.mode & 0o077) !== 0)
    throw new Error(
      "Creator corpus requires a private directory without symlinks."
    );
}
async function privateFile(path: string) {
  const file = await open(
    path,
    constants.O_RDONLY | constants.O_NOFOLLOW | constants.O_NONBLOCK
  );
  try {
    const info = await file.stat();
    if (!info.isFile() || info.size > limit || (info.mode & 0o077) !== 0)
      throw new Error("Invalid creator corpus manifest file.");
    return file;
  } catch (error) {
    await file.close();
    throw error;
  }
}

async function readBytes(file: Awaited<ReturnType<typeof privateFile>>) {
  const buffer = Buffer.alloc(limit + 1);
  let size = 0;
  while (size < buffer.length) {
    operationSignal().throwIfAborted();
    const { bytesRead } = await file.read(buffer, size, buffer.length - size);
    if (!bytesRead) break;
    size += bytesRead;
  }
  if (size > limit)
    throw new Error("Creator corpus manifest exceeds its file limit.");
  return buffer.subarray(0, size);
}

async function verifyInventory(directory: string, expected: Buffer) {
  for await (const entry of await opendir(directory)) {
    if (entry.name === filename) continue;
    if (entry.name !== staging)
      throw new Error(
        "Creator corpus source inventory does not match its manifest."
      );
    // An interrupted publisher may leave only a private prefix of this exact approval.
    // Staging bytes are never served and remain inside the same erased subtree.
    await using file = await privateFile(join(directory, staging));
    const bytes = await readBytes(file);
    if (
      bytes.length > expected.length ||
      !bytes.equals(expected.subarray(0, bytes.length))
    )
      throw new Error("Creator corpus contains a foreign publication.");
  }
}

/** Content comes from the complete immutable file; the approval only binds its bytes. */
export async function readCorpusManifest(
  namespace: string,
  approved: z.infer<typeof corpusManifestSchema>
) {
  operationSignal().throwIfAborted();
  const expected = approvedBytes(namespace, approved);
  const location = corpusDirectory(namespace);
  for (const path of [location.root, location.owner, location.directory])
    await privateDirectory(path);
  await verifyInventory(location.directory, expected);
  await using file = await privateFile(join(location.directory, filename));
  const bytes = await readBytes(file);
  operationSignal().throwIfAborted();
  if (!bytes.equals(expected))
    throw new Error(
      "Creator corpus manifest does not match the approved release."
    );
  return corpusManifestSchema.parse(JSON.parse(bytes.toString("utf8")));
}

/** Only an authorized uninitialized release publishes; callers own the SQL acknowledgement. */
export async function publishCorpusManifest(
  namespace: string,
  approved: z.infer<typeof corpusManifestSchema>
) {
  operationSignal().throwIfAborted();
  const expected = approvedBytes(namespace, approved);
  const location = corpusDirectory(namespace);
  for (const path of [location.root, location.owner, location.directory])
    await privateMemoryDirectory(path);
  await verifyInventory(location.directory, expected);
  const path = join(location.directory, filename);
  const temporary = join(location.directory, staging);
  try {
    await readCorpusManifest(namespace, approved);
  } catch (error) {
    if (
      !(error instanceof Error) ||
      !("code" in error) ||
      error.code !== "ENOENT"
    )
      throw error;
    // A prefix left before publication is unacknowledged and can be retried exactly.
    await rm(temporary, { force: true });
    try {
      await using file = await open(temporary, "wx", 0o600);
      await file.writeFile(expected);
      await file.sync();
      operationSignal().throwIfAborted();
      try {
        await link(temporary, path);
      } catch (publicationError) {
        if (
          !(publicationError instanceof Error) ||
          !("code" in publicationError) ||
          publicationError.code !== "EEXIST"
        )
          throw publicationError;
      }
    } finally {
      await rm(temporary, { force: true });
    }
  }
  await using file = await privateFile(path);
  await file.sync();
  await using directory = await open(
    location.directory,
    constants.O_RDONLY | constants.O_DIRECTORY | constants.O_NOFOLLOW
  );
  await directory.sync();
  return await readCorpusManifest(namespace, approved);
}
