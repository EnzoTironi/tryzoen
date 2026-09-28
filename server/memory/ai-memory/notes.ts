import { memoryTool } from "./protocol";
import { lstat, opendir } from "node:fs/promises";
import { join } from "node:path";
import { z } from "zod";
import {
  LearnedMemoryItemSchema,
  learnedMemoryHistoryInputSchema,
  learnedMemoryHistorySchema,
  learnedMemoryRelationsSchema,
} from "@zoen/companion-ui/memory";
import type { openMemoryEngine } from "./engine";
import { operationSignal } from "../../operations/async";

const scope = { workspace: "zoen", project: "learned" };
const notePath = z.string().regex(/^notes\/[0-9a-f-]{36}\.md$/);

function queryTerms(query: string) {
  // Plain user text, never a caller-controlled FTS expression or scope.
  return (
    query
      .normalize("NFKC")
      .match(/[\p{L}\p{N}]+/gu)
      ?.slice(0, 32) ?? []
  )
    .map((term) => `"${term}"`)
    .join(" OR ");
}

/** Only the private learned corpus is opened here. Raw session fallback is excluded. */
export async function noteTool(
  engine: Awaited<ReturnType<typeof openMemoryEngine>>,
  name: string,
  args: Record<string, unknown>
) {
  operationSignal().throwIfAborted();
  return memoryTool(
    engine.client,
    name,
    { ...args, ...scope },
    { signal: operationSignal() }
  );
}

async function scopeDirectories(root: string) {
  const result: string[] = [];
  const info = await lstat(root);
  if (!info.isDirectory() || info.isSymbolicLink())
    throw new Error("Invalid memory directory.");
  for await (const entry of await opendir(root)) {
    if (entry.name.startsWith(".") || entry.name === "_meta.md") continue;
    z.uuid().parse(entry.name);
    if (!entry.isDirectory() || result.length >= 4)
      throw new Error("Unexpected private memory scope.");
    result.push(join(root, entry.name));
  }
  return result;
}

/** Bound discovery on disk; upstream memory_recent caps at 100 and has no cursor. */
export async function listNoteFiles(
  engine: Awaited<ReturnType<typeof openMemoryEngine>>
) {
  const paths = new Map<string, string>();
  for (const workspace of await scopeDirectories(join(engine.data, "wiki"))) {
    for (const project of await scopeDirectories(workspace)) {
      const directory = join(project, "notes");
      const info = await lstat(directory).catch((error: unknown) => {
        if (
          error instanceof Error &&
          "code" in error &&
          error.code === "ENOENT"
        )
          return null;
        throw error;
      });
      if (!info) continue;
      if (!info.isDirectory() || info.isSymbolicLink())
        throw new Error("Invalid learned notes directory.");
      for await (const entry of await opendir(directory)) {
        const path = notePath.parse(`notes/${entry.name}`);
        z.uuid().parse(entry.name.slice(0, -3));
        if (!entry.isFile() || paths.has(path) || paths.size >= 200)
          throw new Error("The learned memory limit was exceeded.");
        const file = await lstat(join(directory, entry.name));
        if (!file.isFile() || file.isSymbolicLink() || file.size > 64 * 1024)
          throw new Error("Invalid learned memory file.");
        paths.set(path, join(directory, entry.name));
      }
    }
  }
  return paths;
}

export async function listNotePaths(
  engine: Awaited<ReturnType<typeof openMemoryEngine>>
) {
  return [...(await listNoteFiles(engine)).keys()].toSorted();
}

export function noteRelations(frontmatter: Record<string, unknown>) {
  const metadata = z
    .object({
      causes: z.array(notePath).optional(),
      fixes: z.array(notePath).optional(),
      contradicts: z.array(notePath).optional(),
    })
    .parse(frontmatter.relations ?? {});
  return learnedMemoryRelationsSchema.parse(
    Object.entries(metadata).flatMap(([kind, targets]) =>
      targets.map((path) => ({ kind, memoryId: path.slice(6, -3) }))
    )
  );
}

export async function readNotePage(
  engine: Awaited<ReturnType<typeof openMemoryEngine>>,
  path: string
) {
  const page = z
    .object({
      path: notePath,
      body: z.string().max(8000),
      served_from: z.never().optional(),
      frontmatter: z
        .object({ generated: z.object({ at: z.string() }).loose().optional() })
        .loose(),
    })
    .parse(
      await noteTool(engine, "memory_read_page", { path: notePath.parse(path) })
    );
  if (page.path !== path)
    throw new Error("Memory returned an unexpected source.");
  return page;
}

export async function readNotes(
  engine: Awaited<ReturnType<typeof openMemoryEngine>>,
  query?: string
) {
  const paths = await listNotePaths(engine);
  if (paths.length === 0) return { results: [] };
  let selected = paths;
  if (query?.trim()) {
    const terms = queryTerms(query);
    if (!terms) return { results: [] };
    const matches = z
      .object({
        hits: z.array(z.object({ path: notePath })).max(8),
        raw_hits: z.array(z.unknown()).max(0).optional(),
        global_hits: z.array(z.unknown()).max(0).optional(),
      })
      .parse(
        await noteTool(engine, "memory_query", {
          query: terms,
          limit: 8,
        })
      );
    selected = matches.hits.map((hit) => hit.path);
    if (selected.some((path) => !paths.includes(path)))
      throw new Error("Memory index has no authoritative source file.");
  }
  const results: z.infer<typeof LearnedMemoryItemSchema>[] = [];
  for (const path of selected) {
    const page = await readNotePage(engine, path);
    results.push(
      LearnedMemoryItemSchema.parse({
        id: path.slice(6, -3),
        memory: page.body,
        createdAt: null,
        updatedAt: page.frontmatter.generated?.at ?? null,
        relations: noteRelations(page.frontmatter),
      })
    );
  }
  return { results };
}

/** Audit excerpts are tied to upstream version IDs, never hydrated from today's file. */
export async function readNoteHistory(
  engine: Awaited<ReturnType<typeof openMemoryEngine>>,
  raw: z.infer<typeof learnedMemoryHistoryInputSchema>
) {
  const input = learnedMemoryHistoryInputSchema.parse(raw);
  const paths = await listNotePaths(engine);
  const query = queryTerms(input.query);
  if (!query || paths.length === 0)
    return learnedMemoryHistorySchema.parse({
      asOf: input.asOf,
      semantics: "ingestion-time",
      hits: [],
    });
  const result = z
    .object({
      hits: z
        .array(
          z.object({
            id: z.uuid(),
            path: notePath,
            title: z.string().max(8000),
            snippet: z.string().max(16000),
          })
        )
        .max(8),
      raw_hits: z.array(z.unknown()).max(0).optional(),
      global_hits: z.array(z.unknown()).max(0).optional(),
      global_scope_hits: z.array(z.unknown()).max(0).optional(),
      streams_active: z.tuple([z.literal("entity"), z.literal("fts")]),
    })
    .parse(
      await noteTool(engine, "memory_query", {
        query,
        as_of: input.asOf,
        limit: 8,
        explain: true,
      })
    );
  if (result.hits.some((hit) => !paths.includes(hit.path)))
    throw new Error("Historical memory has no authoritative source file.");
  return learnedMemoryHistorySchema.parse({
    asOf: input.asOf,
    semantics: "ingestion-time",
    hits: result.hits.map((hit) => ({
      noteId: hit.path.slice(6, -3),
      versionId: hit.id,
      title: hit.title,
      // Strip only upstream highlighting; render all remaining content as text.
      excerpt: hit.snippet.replaceAll(/<\/?mark>/g, ""),
    })),
  });
}

export async function writeNote(
  engine: Awaited<ReturnType<typeof openMemoryEngine>>,
  id: string,
  text: string
) {
  const path = `notes/${z.uuid().parse(id)}.md`;
  const body = z.string().min(1).max(8000).parse(text);
  const result = z
    .object({
      path: notePath,
      page_id: z.uuid(),
      checkpoint: z.string().regex(/^[0-9a-f]{40}$/),
    })
    .parse(
      await noteTool(engine, "memory_write_page", {
        path,
        body,
        tier: "semantic",
      })
    );
  if (result.path !== path)
    throw new Error("Memory wrote an unexpected source.");
  const verified = z
    .object({
      path: notePath,
      body: z.literal(body),
      served_from: z.never().optional(),
    })
    .parse(await noteTool(engine, "memory_read_page", { path }));
  if (verified.path !== path)
    throw new Error("Memory did not verify its source.");
}

export async function deleteNote(
  engine: Awaited<ReturnType<typeof openMemoryEngine>>,
  id: string
) {
  const path = `notes/${z.uuid().parse(id)}.md`;
  const result = z
    .object({
      path: notePath,
      deleted: z.literal(true),
      checkpoint: z.string().regex(/^[0-9a-f]{40}$/),
    })
    .parse(await noteTool(engine, "memory_delete_page", { path }));
  if (result.path !== path || (await listNotePaths(engine)).includes(path))
    throw new Error("Memory deletion was not verified.");
}
