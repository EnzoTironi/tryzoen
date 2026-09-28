import { createHash, randomUUID } from "node:crypto";
import { constants } from "node:fs";
import { open, opendir, rename, rm } from "node:fs/promises";
import { join } from "node:path";
import { v5 as uuidv5 } from "uuid";
import { z } from "zod";
import type { learnedMemoryRelationsSchema } from "@zoen/companion-ui/memory";
import { LearnedMemoryWriteSchema } from "@zoen/companion-ui/memory";
import { privateMemoryDirectory } from "../session-files";
import type { openMemoryEngine } from "./engine";
import {
  deleteNote,
  listNotePaths,
  writeNote,
  readNotePage,
  noteRelations,
} from "./notes";
import { editNoteSource } from "./source-edit";

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

const relationKey = (items: z.infer<typeof learnedMemoryRelationsSchema>) =>
  items
    .map((item) => `${item.kind}:${item.memoryId}`)
    .toSorted()
    .join("|");

async function validateRelations(
  engine: Awaited<ReturnType<typeof openMemoryEngine>>,
  input: Extract<
    z.infer<typeof LearnedMemoryWriteSchema>,
    { action: "relate" }
  >,
  paths: string[]
) {
  if (
    input.relations.some(
      (item) =>
        item.memoryId === input.memoryId ||
        !paths.includes(`notes/${item.memoryId}.md`)
    )
  )
    throw new FileMemoryError("not_found");
  const page = await readNotePage(engine, `notes/${input.memoryId}.md`);
  if (
    relationKey(noteRelations(page.frontmatter)) !==
    relationKey(input.expectedRelations)
  )
    throw new FileMemoryError("conflict");
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
      : input.action === "clear"
        ? undefined
        : input.memoryId;
  if (input.action === "remember" && paths.length >= 200)
    throw new FileMemoryError("limit");
  if (
    input.action !== "remember" &&
    input.action !== "clear" &&
    !paths.includes(`notes/${input.memoryId}.md`)
  )
    throw new FileMemoryError("not_found");
  if (input.action === "relate") await validateRelations(engine, input, paths);
  await reserveReceipt(directory, path, hash);
  switch (input.action) {
    case "clear":
      for (const note of paths) await deleteNote(engine, note.slice(6, -3));
      break;
    case "delete":
      await deleteNote(engine, input.memoryId);
      break;
    case "relate":
      await editNoteSource(engine, input.memoryId, {
        relations: input.relations,
      });
      break;
    case "update":
      await editNoteSource(engine, input.memoryId, { text: input.text });
      break;
    case "remember":
      await writeNote(engine, z.uuid().parse(id), input.text);
      break;
  }
  const result = { ids: input.action === "clear" || !id ? [] : [id] };
  await completeReceipt(directory, path, { digest: hash, result });
  return result;
}
