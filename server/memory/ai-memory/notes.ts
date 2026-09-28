import { lstat, opendir } from "node:fs/promises";
import { join } from "node:path";
import { z } from "zod";
import { LearnedMemoryItemSchema } from "@shared/companion/learned-memory";
import type { openMemoryEngine } from "./engine";
import { operationSignal } from "../../operations/async";

const scope = { workspace: "zoen", project: "learned" };
const notePath = z.string().regex(/^notes\/[0-9a-f-]{36}\.md$/);

/** Only the private learned corpus is opened here. Raw session fallback is excluded. */
async function noteTool(
  engine: Awaited<ReturnType<typeof openMemoryEngine>>,
  name: string,
  args: Record<string, unknown>
) {
  operationSignal().throwIfAborted();
  const result = await engine.client.callTool(
    { name, arguments: { ...args, ...scope } },
    undefined,
    { timeout: 20_000, signal: operationSignal() }
  );
  if (result.isError) throw new Error("The private memory operation failed.");
  const content = z
    .array(
      z.object({ type: z.literal("text"), text: z.string().max(64 * 1024) })
    )
    .max(1)
    .parse(result.content);
  return z
    .record(z.string(), z.unknown())
    .parse(JSON.parse(content.map((part) => part.text).join("")));
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
export async function listNotePaths(
  engine: Awaited<ReturnType<typeof openMemoryEngine>>
) {
  const paths = new Set<string>();
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
        paths.add(path);
      }
    }
  }
  return [...paths].toSorted();
}

export async function readNotes(
  engine: Awaited<ReturnType<typeof openMemoryEngine>>,
  query?: string
) {
  const paths = await listNotePaths(engine);
  if (paths.length === 0) return { results: [] };
  let selected = paths;
  if (query?.trim()) {
    // Plain user text, never a caller-controlled FTS expression or scope.
    const terms =
      query
        .normalize("NFKC")
        .match(/[\p{L}\p{N}]+/gu)
        ?.slice(0, 32) ?? [];
    if (terms.length === 0) return { results: [] };
    const matches = z
      .object({
        hits: z.array(z.object({ path: notePath })).max(8),
        raw_hits: z.array(z.unknown()).max(0).optional(),
        global_hits: z.array(z.unknown()).max(0).optional(),
      })
      .parse(
        await noteTool(engine, "memory_query", {
          query: terms.map((term) => `"${term}"`).join(" OR "),
          limit: 8,
        })
      );
    selected = matches.hits.map((hit) => hit.path);
    if (selected.some((path) => !paths.includes(path)))
      throw new Error("Memory index has no authoritative source file.");
  }
  const results: z.infer<typeof LearnedMemoryItemSchema>[] = [];
  for (const path of selected) {
    const page = z
      .object({
        path: notePath,
        body: z.string().max(8000),
        served_from: z.never().optional(),
        frontmatter: z
          .object({ generated: z.object({ at: z.string() }).optional() })
          .loose(),
      })
      .parse(await noteTool(engine, "memory_read_page", { path }));
    if (page.path !== path)
      throw new Error("Memory returned an unexpected source.");
    results.push(
      LearnedMemoryItemSchema.parse({
        id: path.slice(6, -3),
        memory: page.body,
        createdAt: null,
        updatedAt: page.frontmatter.generated?.at ?? null,
      })
    );
  }
  return { results };
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
