import { createHash, randomUUID } from "node:crypto";
import { constants } from "node:fs";
import { open, opendir, rename, rm } from "node:fs/promises";
import { join } from "node:path";
import { v5 as uuidv5 } from "uuid";
import { z } from "zod";
import { LearnedMemoryWriteSchema } from "@shared/companion/learned-memory";
import { privateMemoryDirectory } from "../session-files";
import type { openMemoryEngine } from "./engine";
import { deleteNote, listNotePaths, writeNote } from "./notes";

const receiptSchema = z.object({
  digest: z.string().regex(/^[0-9a-f]{64}$/),
  result: z.object({ ids: z.array(z.uuid()).max(200) }).nullable(),
});
const digest = (value: string) =>
  createHash("sha256").update(value).digest("hex");

export class FileMemoryError extends Error {
  readonly _tag = "FileMemoryError";
  constructor(
    readonly reason:
      | "unconfigured"
      | "unavailable"
      | "conflict"
      | "not_found"
      | "limit"
  ) {
    super("Private memory is unavailable.");
    this.name = "FileMemoryError";
  }
}

async function readReceipt(path: string) {
  try {
    await using file = await open(
      path,
      constants.O_RDONLY | constants.O_NOFOLLOW
    );
    const info = await file.stat();
    if (!info.isFile() || (info.mode & 0o077) !== 0 || info.size > 16 * 1024)
      throw new FileMemoryError("unavailable");
    const content = Buffer.alloc(16 * 1024 + 1);
    const { bytesRead } = await file.read(content);
    if (bytesRead !== info.size) throw new FileMemoryError("unavailable");
    return receiptSchema.parse(
      JSON.parse(content.subarray(0, bytesRead).toString())
    );
  } catch (error) {
    if (error instanceof Error && "code" in error && error.code === "ENOENT")
      return null;
    throw error;
  }
}

async function reserveReceipt(directory: string, path: string, hash: string) {
  let count = 0;
  for await (const entry of await opendir(directory)) {
    if (!entry.isFile() || ++count >= 10_000)
      throw new FileMemoryError("limit");
  }
  await using file = await open(path, "wx", 0o600);
  await file.writeFile(JSON.stringify({ digest: hash, result: null }));
  await file.sync();
  await using parent = await open(directory, "r");
  await parent.sync();
}

async function completeReceipt(
  directory: string,
  path: string,
  receipt: z.infer<typeof receiptSchema>
) {
  const temporary = join(directory, `.${randomUUID()}.tmp`);
  try {
    await using file = await open(temporary, "wx", 0o600);
    await file.writeFile(JSON.stringify(receipt));
    await file.sync();
    await rename(temporary, path);
    await using parent = await open(directory, "r");
    await parent.sync();
  } finally {
    await rm(temporary, { force: true });
  }
}

/** The engine's writer lock must stay held across reservation, mutation and fsync. */
export async function mutateNotes(
  engine: Awaited<ReturnType<typeof openMemoryEngine>>,
  namespace: string,
  raw: z.infer<typeof LearnedMemoryWriteSchema>
) {
  const input = LearnedMemoryWriteSchema.parse(raw);
  const hash = digest(JSON.stringify(input));
  const directory = join(engine.data, "zoen-operations");
  await privateMemoryDirectory(directory);
  const path = join(directory, `${digest(input.operationId)}.json`);
  const previous = await readReceipt(path);
  if (previous) {
    if (previous.digest !== hash || previous.result === null)
      throw new FileMemoryError("conflict");
    return previous.result;
  }
  const paths = await listNotePaths(engine);
  const id =
    input.action === "remember"
      ? uuidv5(input.operationId, z.uuid().parse(namespace))
      : input.memoryId;
  if (input.action === "remember" && paths.length >= 200)
    throw new FileMemoryError("limit");
  if (
    (input.action === "update" || input.action === "delete") &&
    (!id || !paths.includes(`notes/${id}.md`))
  )
    throw new FileMemoryError("not_found");
  if ((input.action === "remember" || input.action === "update") && !input.text)
    throw new FileMemoryError("conflict");
  await reserveReceipt(directory, path, hash);
  if (input.action === "clear") {
    for (const note of paths) await deleteNote(engine, note.slice(6, -3));
  } else if (input.action === "delete" && id) {
    await deleteNote(engine, id);
  } else if (id && input.text) {
    await writeNote(engine, id, input.text);
  }
  const result = { ids: input.action === "clear" || !id ? [] : [id] };
  await completeReceipt(directory, path, { digest: hash, result });
  return result;
}
