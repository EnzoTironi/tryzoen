import { z } from "zod";
import { randomUUID } from "node:crypto";
import {
  glob,
  mkdtemp,
  readFile,
  rm,
  symlink,
  writeFile,
} from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { setTimeout as delay } from "node:timers/promises";
import { afterAll, expect, test } from "vitest";
import { openMemoryEngine } from "../../server/memory/ai-memory/engine";
import {
  readNotes,
  readNoteHistory,
} from "../../server/memory/ai-memory/notes";
import {
  mutateNotes,
  FileMemoryError,
} from "../../server/memory/ai-memory/mutations";

const binary = process.env.ZOEN_AI_MEMORY_BINARY;
if (!binary)
  throw new Error(
    "Set ZOEN_AI_MEMORY_BINARY to the qualified 2.4.1 executable."
  );
const root = await mkdtemp(join(tmpdir(), "zoen-learned-notes-"));
afterAll(() => rm(root, { recursive: true, force: true }));

test("saves exact Markdown, corrects current recall, and persists idempotent mutations across restart", async () => {
  const namespace = randomUUID();
  const remember = {
    action: "remember" as const,
    operationId: randomUUID(),
    text: "# Book club\nWe meet at Cedarbay.",
  };
  let saved: string | undefined;
  let asOf: string;
  {
    await using engine = await openMemoryEngine(
      binary,
      root,
      namespace,
      "learned-memory",
      { requireExisting: false }
    );
    expect(await readNotes(engine)).toEqual({ results: [] });
    saved = (await mutateNotes(engine, namespace, remember)).ids[0];
    asOf = new Date().toISOString();
    await delay(20);
    expect(saved).toBeTruthy();
    expect((await readNotes(engine, 'Cedarbay" OR (')).results[0]?.memory).toBe(
      remember.text
    );
    await mutateNotes(engine, namespace, {
      action: "update",
      operationId: randomUUID(),
      memoryId: z.uuid().parse(saved),
      text: "# Book club\nWe meet at Ambertrail.",
    });
    expect((await readNotes(engine, "Cedarbay")).results).toEqual([]);
    expect((await readNotes(engine, "Ambertrail")).results[0]?.id).toBe(saved);
    const history = await engine.client.callTool({
      name: "memory_query",
      arguments: {
        workspace: "zoen",
        project: "learned",
        query: "Cedarbay",
        as_of: asOf,
      },
    });
    expect(JSON.stringify(history.content)).toContain("Cedarbay");
    const audit = await readNoteHistory(engine, {
      query: 'Cedarbay" OR (',
      asOf,
    });
    expect(audit.semantics).toBe("ingestion-time");
    expect(audit.hits).toHaveLength(1);
    expect(audit.hits[0]).toMatchObject({ noteId: saved });
    expect(audit.hits[0]?.versionId).not.toBe(saved);
    expect(audit.hits[0]?.excerpt).toContain("Cedarbay");
    expect(audit.hits[0]?.excerpt).not.toContain("Ambertrail");
    expect(audit.hits[0]?.excerpt).not.toContain("<mark>");
    expect(
      (
        await readNoteHistory(engine, {
          query: "Ambertrail",
          asOf,
        })
      ).hits
    ).toEqual([]);
  }
  {
    await using engine = await openMemoryEngine(
      binary,
      root,
      namespace,
      "learned-memory",
      { requireExisting: true }
    );
    expect(await mutateNotes(engine, namespace, remember)).toEqual({
      ids: [saved],
    });
    expect((await readNotes(engine)).results[0]?.memory).toContain(
      "Ambertrail"
    );
    await expect(
      mutateNotes(engine, namespace, { ...remember, text: "Conflicting text" })
    ).rejects.toMatchObject({ reason: "conflict" });
    await mutateNotes(engine, namespace, {
      action: "delete",
      operationId: randomUUID(),
      memoryId: z.uuid().parse(saved),
    });
    expect((await readNotes(engine, "Ambertrail")).results).toEqual([]);
    expect(await mutateNotes(engine, namespace, remember)).toEqual({
      ids: [saved],
    });
    expect((await readNotes(engine)).results).toEqual([]);
    const history = await engine.client.callTool({
      name: "memory_query",
      arguments: {
        workspace: "zoen",
        project: "learned",
        query: "Cedarbay",
        as_of: asOf,
      },
    });
    expect(JSON.stringify(history.content)).not.toContain("Cedarbay");
    expect(
      (await readNoteHistory(engine, { query: "Cedarbay", asOf })).hits
    ).toEqual([]);
  }
});

test("lists more than the upstream recent-page cap and enforces the 200-note product limit", async () => {
  const namespace = randomUUID();
  await using engine = await openMemoryEngine(
    binary,
    root,
    namespace,
    "learned-memory",
    { requireExisting: false }
  );
  for (let index = 0; index < 200; index++) {
    await mutateNotes(engine, namespace, {
      action: "remember",
      operationId: `note-${index}`,
      text: `Synthetic quota note ${index}.`,
    });
  }
  expect((await readNotes(engine)).results).toHaveLength(200);
  await expect(
    mutateNotes(engine, namespace, {
      action: "remember",
      operationId: "overflow",
      text: "Overflow",
    })
  ).rejects.toMatchObject({ reason: "limit" });
  expect((await readNotes(engine)).results).toHaveLength(200);
}, 60_000);

test("keeps namespaces private and a clear receipt cannot erase subsequently saved notes", async () => {
  const namespace = randomUUID();
  const clear = { action: "clear" as const, operationId: randomUUID() };
  let id: string | undefined;
  {
    await using engine = await openMemoryEngine(
      binary,
      root,
      namespace,
      "learned-memory",
      { requireExisting: false }
    );
    id = (
      await mutateNotes(engine, namespace, {
        action: "remember",
        operationId: randomUUID(),
        text: "Willowhaven",
      })
    ).ids[0];
    await mutateNotes(engine, namespace, clear);
    await mutateNotes(engine, namespace, {
      action: "remember",
      operationId: randomUUID(),
      text: "Birchhaven",
    });
  }
  {
    await using engine = await openMemoryEngine(
      binary,
      root,
      namespace,
      "learned-memory",
      { requireExisting: true }
    );
    await mutateNotes(engine, namespace, clear);
    expect(
      (await readNotes(engine)).results.map((item) => item.memory)
    ).toEqual(["Birchhaven"]);
    const other = randomUUID();
    await using privateEngine = await openMemoryEngine(
      binary,
      root,
      other,
      "learned-memory",
      { requireExisting: false }
    );
    expect((await readNotes(privateEngine)).results).toEqual([]);
    await expect(
      mutateNotes(privateEngine, other, {
        action: "delete",
        operationId: randomUUID(),
        memoryId: z.uuid().parse(id),
      })
    ).rejects.toMatchObject({ reason: "not_found" });
  }
});

test("fails closed on an interrupted receipt and never serves the index after its source disappears", async () => {
  const namespace = randomUUID();
  await using engine = await openMemoryEngine(
    binary,
    root,
    namespace,
    "learned-memory",
    { requireExisting: false }
  );
  const input = {
    action: "remember" as const,
    operationId: randomUUID(),
    text: "Brookfield",
  };
  await mutateNotes(engine, namespace, input);
  const receipts = await Array.fromAsync(
    glob(join(engine.data, "zoen-operations/*.json"))
  );
  const receipt = receipts[0];
  if (!receipt) throw new Error("Missing receipt");
  const stored = z
    .object({ digest: z.string() })
    .parse(JSON.parse(await readFile(receipt, "utf8")));
  await writeFile(receipt, JSON.stringify({ ...stored, result: null }));
  await expect(mutateNotes(engine, namespace, input)).rejects.toBeInstanceOf(
    FileMemoryError
  );
  const pages = await Array.fromAsync(
    glob(join(engine.data, "wiki/*/*/notes/*.md"))
  );
  const page = pages[0];
  if (!page) throw new Error("Missing note");
  await rm(page);
  expect((await readNotes(engine, "Brookfield")).results).toEqual([]);
  await symlink(receipt, page);
  await expect(readNotes(engine)).rejects.toThrow(
    "The learned memory limit was exceeded."
  );
});
