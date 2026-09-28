import { constants } from "node:fs";
import { open, rename, rm } from "node:fs/promises";
import { dirname, join } from "node:path";
import { randomUUID } from "node:crypto";
import { isDeepStrictEqual } from "node:util";
import { setTimeout as delay } from "node:timers/promises";
import { stringify } from "yaml";
import { z } from "zod";
import type { learnedMemoryRelationsSchema } from "@zoen/companion-ui/memory";
import type { openMemoryEngine } from "./engine";
import { listNoteFiles, noteTool, readNotePage } from "./notes";
import { operationSignal } from "../../operations/async";

async function recentVersions(
  engine: Awaited<ReturnType<typeof openMemoryEngine>>
) {
  return z
    .object({
      hits: z.array(z.object({ id: z.uuid(), path: z.string() })).max(100),
      global_hits: z.array(z.unknown()).max(0).optional(),
    })
    .parse(await noteTool(engine, "memory_recent", { limit: 100 })).hits;
}

async function replaceNoteSource(file: string, source: string) {
  await using current = await open(
    file,
    constants.O_RDONLY | constants.O_NOFOLLOW
  );
  const stat = await current.stat();
  if (!stat.isFile() || stat.size > 64 * 1024 || (stat.mode & 0o077) !== 0)
    throw new Error("Memory source is not private.");
  const temporary = join(dirname(file), `.${randomUUID()}.tmp`);
  try {
    await using pending = await open(temporary, "wx", 0o600);
    await pending.writeFile(source);
    await pending.sync();
    operationSignal().throwIfAborted();
    await rename(temporary, file);
    await using parent = await open(dirname(file), "r");
    await parent.sync();
  } finally {
    await rm(temporary, { force: true });
  }
}

/** Supported Markdown edit → watcher version → Git checkpoint, under the owner lock. */
export async function editNoteSource(
  engine: Awaited<ReturnType<typeof openMemoryEngine>>,
  id: string,
  change: {
    text?: string;
    relations?: z.infer<typeof learnedMemoryRelationsSchema>;
  }
) {
  const path = `notes/${z.uuid().parse(id)}.md`;
  const file = (await listNoteFiles(engine)).get(path);
  if (!file) throw new Error("Memory source is unavailable.");
  const page = await readNotePage(engine, path);
  const body = change.text ?? page.body;
  const frontmatter = { ...page.frontmatter };
  if (change.relations) {
    frontmatter.relations = Object.fromEntries(
      ["causes", "fixes", "contradicts"].map((kind) => [
        kind,
        change.relations
          ?.filter((item) => item.kind === kind)
          .map((item) => `notes/${item.memoryId}.md`) ?? [],
      ])
    );
  }
  if (body === page.body && isDeepStrictEqual(frontmatter, page.frontmatter))
    return;
  frontmatter.generated = {
    ...page.frontmatter.generated,
    at: new Date().toISOString(),
  };
  const source = `---\n${stringify(frontmatter)}---\n${body}`;
  if (Buffer.byteLength(source) > 64 * 1024)
    throw new Error("Memory source is too large.");
  const previous = (await recentVersions(engine)).find(
    (hit) => hit.path === path
  )?.id;
  await replaceNoteSource(file, source);
  // A changed version proves the watcher completed its transactional page/link
  // update. An unchanged ID, timeout, or crash keeps the durable recall fence.
  const deadline = Date.now() + 12_000;
  for (;;) {
    const indexed = (await recentVersions(engine)).find(
      (hit) => hit.path === path
    );
    if (indexed && indexed.id !== previous) break;
    if (Date.now() >= deadline)
      throw new Error("Memory indexing did not finish.");
    await delay(200, undefined, { signal: operationSignal() });
  }
  const verified = await readNotePage(engine, path);
  if (
    verified.body !== body ||
    !isDeepStrictEqual(
      verified.frontmatter.relations ?? {},
      frontmatter.relations ?? {}
    )
  )
    throw new Error("Memory source verification failed.");
  await engine.checkpoint();
}
