import { query } from "@db/queries";
import { sql } from "drizzle-orm";
import { z, ZodError } from "zod";
import { randomUUID } from "node:crypto";
import { setTimeout as delay } from "node:timers/promises";
import { rm, glob, readFile, rename, lstat, writeFile } from "node:fs/promises";
import { execFileSync } from "node:child_process";
import { join } from "node:path";
import { afterAll, afterEach, expect, test, vi } from "vitest";
import { LearnedMemory } from "../../server/memory/learned";
import { FileMemory } from "../../server/memory/ai-memory/learned";
import { FileMemoryError } from "../../server/memory/ai-memory/mutations";
import * as sourceFiles from "../../server/memory/session-files";
import { drainMemoryErasures } from "../../server/memory/erasure";
import { WorkspaceAccessDenied } from "../../server/workspaces/access";
import { invokeWorkspaceTool } from "../../server/tools/workspace";
import { workspaceFixture } from "./workspace-fixture";

const { directory } = await vi.hoisted(async () => {
  const { mkdtemp } = await import("node:fs/promises");
  const { tmpdir } = await import("node:os");
  const path = await import("node:path");
  return {
    directory: await mkdtemp(path.join(tmpdir(), "zoen-learned-owner-")),
  };
});
vi.mock("@shared/environment/env", async (original) => {
  const actual = await original<typeof import("@shared/environment/env")>();
  return {
    ...actual,
    env: { ...actual.env, ZOEN_SESSION_ARCHIVE_DIR: directory },
  };
});
afterAll(() => rm(directory, { recursive: true, force: true }));
afterEach(() => vi.restoreAllMocks());
const run = async (
  body: (
    value: Awaited<ReturnType<typeof workspaceFixture>> & {
      memory: typeof LearnedMemory;
    }
  ) => Promise<void>
) => {
  await using workspace = await workspaceFixture();
  await body({ ...workspace, memory: LearnedMemory });
};

test.each(["corpus", "namespace", "volume"] as const)(
  "loss of an accepted %s cannot silently initialize a new memory",
  (missing) =>
    run(async ({ actor, memory }) => {
      const saved = await memory.write(actor, {
        action: "remember",
        operationId: randomUUID(),
        text: "The club meets in Cedarbay.",
      });
      const asOf = new Date().toISOString();
      await delay(20);
      await memory.write(actor, {
        action: "update",
        operationId: randomUUID(),
        memoryId: z.uuid().parse(saved.ids[0]),
        text: "The club now meets in Ambertrail.",
      });
      const [owner] = await query<{ id: string; initialized: boolean }>(sql`
      SELECT namespace_id AS id, learned_memory_initialized AS initialized FROM workspace_memory_namespace
      WHERE workspace_id = ${actor.workspaceId} AND user_id = ${actor.userId}`);
      expect(owner?.initialized).toBe(true);
      const target =
        missing === "volume"
          ? directory
          : join(
              directory,
              z.uuid().parse(owner?.id),
              ...(missing === "corpus" ? ["learned-memory"] : [])
            );
      const preserved = `${target}.preserved-${randomUUID()}`;
      await rename(target, preserved);
      const operationId = randomUUID();
      try {
        await expect(memory.read(actor)).rejects.toBeInstanceOf(
          FileMemoryError
        );
        await expect(
          memory.history(actor, { query: "Cedarbay", asOf })
        ).rejects.toBeInstanceOf(FileMemoryError);
        await expect(
          memory.recall(actor, "lost-corpus", randomUUID(), "Cedarbay")
        ).rejects.toBeInstanceOf(FileMemoryError);
        await expect(memory.recover(actor)).rejects.toBeInstanceOf(
          FileMemoryError
        );
        await expect(
          memory.write(actor, { action: "clear", operationId })
        ).rejects.toBeInstanceOf(FileMemoryError);
        const [receipt] =
          await query(sql`SELECT learned_memory_initialized AS initialized, pending_operation AS pending
        FROM workspace_memory_namespace WHERE namespace_id = ${owner?.id}`);
        expect(receipt).toEqual({ initialized: true, pending: operationId });
        await expect(lstat(target)).rejects.toMatchObject({ code: "ENOENT" });
      } finally {
        // This suite's disposable files only; the untouched original is restored.
        await rm(target, { recursive: true, force: true });
        await rename(preserved, target);
      }
      await memory.recover(actor);
      expect((await memory.read(actor)).results[0]?.memory).toContain(
        "Ambertrail"
      );
      expect(
        (await memory.history(actor, { query: "Cedarbay", asOf })).hits[0]
          ?.excerpt
      ).toContain("Cedarbay");
    })
);

test("the initial corpus receipt survives a failed first mutation and clear keeps it protected", () =>
  run(async ({ actor, memory }) => {
    vi.spyOn(FileMemory, "mutate").mockRejectedValueOnce(
      new FileMemoryError("unavailable")
    );
    await expect(
      memory.write(actor, {
        action: "remember",
        operationId: randomUUID(),
        text: "Synthetic uncertain first note.",
      })
    ).rejects.toBeInstanceOf(FileMemoryError);
    const [owner] = await query<{
      id: string;
      initialized: boolean;
      pending: string | null;
    }>(sql`
      SELECT namespace_id AS id, learned_memory_initialized AS initialized, pending_operation AS pending
      FROM workspace_memory_namespace WHERE workspace_id = ${actor.workspaceId} AND user_id = ${actor.userId}`);
    expect(owner?.initialized).toBe(true);
    expect(owner?.pending).toBeTruthy();
    const corpus = join(directory, z.uuid().parse(owner?.id), "learned-memory");
    const preserved = `${corpus}.preserved`;
    await rename(corpus, preserved);
    try {
      await expect(memory.recover(actor)).rejects.toBeInstanceOf(
        FileMemoryError
      );
      await expect(memory.read(actor)).rejects.toBeInstanceOf(FileMemoryError);
      await expect(lstat(corpus)).rejects.toMatchObject({ code: "ENOENT" });
    } finally {
      await rm(corpus, { recursive: true, force: true });
      await rename(preserved, corpus);
    }
    await memory.write(actor, { action: "clear", operationId: randomUUID() });
    expect((await memory.read(actor)).results).toEqual([]);
    expect(
      await query(
        sql`SELECT learned_memory_initialized AS initialized FROM workspace_memory_namespace WHERE namespace_id = ${owner?.id}`
      )
    ).toEqual([{ initialized: true }]);
  }));

test.each([
  { missing: "db", empty: false },
  { missing: "wiki", empty: false },
  { missing: "db/memory.sqlite", empty: false },
  { missing: "db/memory.sqlite", empty: true },
])(
  "damaged corpus ($missing, empty=$empty) cannot pass recovery or be overwritten",
  ({ missing, empty }) =>
    run(async ({ actor, memory }) => {
      const writes = vi.spyOn(FileMemory, "mutate");
      const saved = await memory.write(actor, {
        action: "remember",
        operationId: randomUUID(),
        text: "The book club meets in Cedarbay.",
      });
      const asOf = new Date().toISOString();
      await delay(20);
      await memory.write(actor, {
        action: "update",
        memoryId: z.uuid().parse(saved.ids[0]),
        operationId: randomUUID(),
        text: "The book club now meets in Ambertrail.",
      });
      const input = { query: "Cedarbay", asOf };
      expect((await memory.history(actor, input)).hits[0]?.excerpt).toContain(
        "Cedarbay"
      );
      const corpus = join(
        directory,
        z.uuid().parse(writes.mock.calls[0]?.[0]),
        "learned-memory"
      );
      const index = join(corpus, missing);
      const preserved = join(corpus, "preserved-source");
      await rename(index, preserved);
      if (empty) await writeFile(index, "", { mode: 0o600 });
      try {
        await expect(memory.history(actor, input)).rejects.toBeInstanceOf(
          FileMemoryError
        );
        await expect(memory.recover(actor)).rejects.toBeInstanceOf(
          FileMemoryError
        );
        await expect(
          lstat(index).then(
            (info) => info.size,
            (error: unknown) => z.object({ code: z.string() }).parse(error).code
          )
        ).resolves.toBe(empty ? 0 : "ENOENT");
      } finally {
        // Only this fixture's disposable index is removed, preserving its original snapshot.
        await rm(index, { recursive: true, force: true });
        await rename(preserved, index);
      }
      expect((await memory.history(actor, input)).hits[0]?.excerpt).toContain(
        "Cedarbay"
      );
      expect((await memory.read(actor)).results[0]?.memory).toContain(
        "Ambertrail"
      );
    })
);

test("historical excerpts preserve the old version and enforce owner, pause and mutation fences", () =>
  run(async ({ actor, guest, personal, memory }) => {
    const saved = await memory.write(actor, {
      action: "remember",
      operationId: randomUUID(),
      text: "The book club meets in Cedarbay.",
    });
    const asOf = new Date().toISOString();
    await delay(20);
    await memory.write(actor, {
      action: "update",
      memoryId: z.uuid().parse(saved.ids[0]),
      operationId: randomUUID(),
      text: "The book club now meets in Ambertrail.",
    });
    const input = { query: "Cedarbay", asOf };
    expect((await memory.history(actor, input)).hits[0]?.excerpt).toContain(
      "Cedarbay"
    );
    expect((await memory.read(actor, "Cedarbay")).results).toEqual([]);
    expect((await memory.history(guest, input)).hits).toEqual([]);
    const audit = vi.spyOn(FileMemory, "history");
    await expect(
      memory.history({ ...guest, workspaceId: personal.workspaceId }, input)
    ).rejects.toBeInstanceOf(WorkspaceAccessDenied);
    expect(audit).not.toHaveBeenCalled();
    await expect(
      memory.history(actor, { ...input, asOf: "2026-09-28T10:00:00" })
    ).rejects.toBeInstanceOf(ZodError);
    const untrusted = { ...input, global: true };
    await expect(memory.history(actor, untrusted)).rejects.toBeInstanceOf(
      ZodError
    );
    expect(audit).not.toHaveBeenCalled();
    await memory.setEnabled(actor, false);
    await expect(memory.history(actor, input)).rejects.toMatchObject({
      reason: "disabled",
    });
    await memory.setEnabled(actor, true);
    vi.spyOn(FileMemory, "mutate").mockRejectedValueOnce(
      new FileMemoryError("unavailable")
    );
    await expect(
      memory.write(actor, {
        action: "update",
        memoryId: z.uuid().parse(saved.ids[0]),
        text: "An unfinished correction.",
        operationId: randomUUID(),
      })
    ).rejects.toBeInstanceOf(FileMemoryError);
    await expect(memory.history(actor, input)).rejects.toMatchObject({
      reason: "stale_recall",
    });
    expect(audit).not.toHaveBeenCalled();
  }));

test("typed relationships survive body edits, retain dangling history and cannot be resurrected by a replay", () =>
  run(async ({ actor, memory }) => {
    const writes = vi.spyOn(FileMemory, "mutate");
    const source = (
      await memory.write(actor, {
        action: "remember",
        operationId: randomUUID(),
        text: "Cedarbay club meets on Monday.",
      })
    ).ids[0];
    const target = (
      await memory.write(actor, {
        action: "remember",
        operationId: randomUUID(),
        text: "Cedarbay club meets on Tuesday.",
      })
    ).ids[0];
    const relations = [
      { kind: "contradicts" as const, memoryId: z.uuid().parse(target) },
    ];
    const input = {
      action: "relate" as const,
      memoryId: z.uuid().parse(source),
      relations,
      expectedRelations: [],
      operationId: randomUUID(),
    };
    await memory.write(actor, input);
    expect(
      (await memory.read(actor, "Tuesday")).results.some(
        (item) => item.id === source
      )
    ).toBe(true);
    expect(
      (await memory.read(actor)).results.find((item) => item.id === source)
        ?.relations
    ).toEqual(relations);
    const asOf = new Date().toISOString();
    await delay(20);
    await memory.write(actor, {
      action: "update",
      memoryId: z.uuid().parse(source),
      operationId: randomUUID(),
      text: "Ambertrail club now meets on Wednesday.",
    });
    const current = (await memory.read(actor)).results.find(
      (item) => item.id === source
    );
    expect(current).toMatchObject({
      memory: "Ambertrail club now meets on Wednesday.",
      relations,
    });
    const wiki = join(
      directory,
      z.uuid().parse(writes.mock.calls[0]?.[0]),
      "learned-memory",
      "wiki"
    );
    const sources = await Array.fromAsync(
      glob(`*/*/notes/${z.uuid().parse(source)}.md`, { cwd: wiki })
    );
    expect(sources).toHaveLength(1);
    const markdown = await readFile(
      join(wiki, z.string().parse(sources[0])),
      "utf8"
    );
    expect(markdown).toContain("contradicts:");
    expect(markdown).toContain(`notes/${z.uuid().parse(target)}.md`);
    expect(
      execFileSync(
        "git",
        ["-C", wiki, "show", `HEAD:${z.string().parse(sources[0])}`],
        {
          encoding: "utf8",
        }
      )
    ).toBe(markdown);
    expect(
      (await memory.history(actor, { query: "Monday", asOf })).hits.some(
        (item) => item.noteId === source && item.excerpt.includes("Monday")
      )
    ).toBe(true);
    await memory.write(actor, {
      action: "delete",
      memoryId: z.uuid().parse(target),
      operationId: randomUUID(),
    });
    expect(
      (await memory.read(actor)).results.find((item) => item.id === source)
        ?.relations
    ).toEqual(relations);
    await memory.write(actor, {
      ...input,
      relations: [],
      expectedRelations: relations,
      operationId: randomUUID(),
    });
    await memory.write(actor, input);
    expect(
      (await memory.read(actor)).results.find((item) => item.id === source)
        ?.relations
    ).toEqual([]);
  }));

test("a failed Git checkpoint leaves recall fenced and the source reviewable", () =>
  run(async ({ actor, memory }) => {
    const saved = await memory.write(actor, {
      action: "remember",
      operationId: randomUUID(),
      text: "Synthetic original note.",
    });
    const request = fetch;
    const failure = vi
      .spyOn(globalThis, "fetch")
      .mockImplementation((input, init) => {
        if (
          new URL(input instanceof Request ? input.url : input).pathname ===
          "/admin/commit"
        )
          return Promise.reject(new Error("Synthetic checkpoint outage"));
        return request(input, init);
      });
    const input = {
      action: "update" as const,
      memoryId: z.uuid().parse(saved.ids[0]),
      text: "Synthetic changed source.",
      operationId: randomUUID(),
    };
    await expect(memory.write(actor, input)).rejects.toMatchObject({
      reason: "unavailable",
    });
    await expect(memory.recover(actor)).rejects.toMatchObject({
      reason: "unavailable",
    });
    failure.mockRestore();
    await expect(
      memory.recall(actor, "checkpoint-failure", randomUUID(), "Synthetic")
    ).rejects.toMatchObject({
      reason: "stale_recall",
    });
    const review = await memory.read(actor, undefined, true);
    expect(review.needsAttention).toBe(true);
    expect(review.results[0]?.memory).toBe(input.text);
    await memory.recover(actor);
    expect((await memory.read(actor)).results[0]?.memory).toBe(input.text);
  }));

test("relation destinations cannot cross a person/workspace and stale replacement cannot overwrite newer links", () =>
  run(async ({ actor, guest, personal, memory }) => {
    const save = async (
      person: Parameters<typeof memory.write>[0],
      text: string
    ) =>
      (
        await memory.write(person, {
          action: "remember",
          operationId: randomUUID(),
          text,
        })
      ).ids[0];
    const source = await save(actor, "Synthetic source");
    const target = await save(actor, "Synthetic target");
    const foreign = [
      await save(guest, "Other person"),
      await save(personal, "Other workspace"),
      source,
    ];
    for (const memoryId of foreign) {
      await expect(
        memory.write(actor, {
          action: "relate",
          memoryId: z.uuid().parse(source),
          relations: [{ kind: "causes", memoryId: z.uuid().parse(memoryId) }],
          expectedRelations: [],
          operationId: randomUUID(),
        })
      ).rejects.toMatchObject({ reason: "not_found" });
      await memory.recover(actor);
    }
    const relations = [
      { kind: "fixes" as const, memoryId: z.uuid().parse(target) },
    ];
    await memory.write(actor, {
      action: "relate",
      memoryId: z.uuid().parse(source),
      relations,
      expectedRelations: [],
      operationId: randomUUID(),
    });
    await expect(
      memory.write(actor, {
        action: "relate",
        memoryId: z.uuid().parse(source),
        relations: [],
        expectedRelations: [],
        operationId: randomUUID(),
      })
    ).rejects.toMatchObject({ reason: "conflict" });
    await memory.recover(actor);
    expect(
      (await memory.read(actor)).results.find((item) => item.id === source)
        ?.relations
    ).toEqual(relations);
  }));

test("partitions each person/workspace and rejects forged access before reaching the file engine", () =>
  run(async ({ actor, guest, personal, memory }) => {
    const writes = vi.spyOn(FileMemory, "mutate");
    const reads = vi.spyOn(FileMemory, "read");
    for (const [index, person] of [actor, guest, personal].entries()) {
      await memory.write(person, {
        action: "remember",
        text: `Synthetic preference ${index}`,
        operationId: randomUUID(),
      });
      expect(
        (await memory.read(person)).results.map((item) => item.memory)
      ).toEqual([`Synthetic preference ${index}`]);
    }
    expect(
      new Set(writes.mock.calls.map(([namespace]) => namespace)).size
    ).toBe(3);
    expect(
      writes.mock.calls.every(
        ([namespace]) => !namespace.includes(actor.userId)
      )
    ).toBe(true);
    reads.mockClear();
    await expect(
      memory.read({ ...guest, workspaceId: personal.workspaceId })
    ).rejects.toBeInstanceOf(WorkspaceAccessDenied);
    expect(reads).not.toHaveBeenCalled();
  }));

test("replay is stable, deletion invalidates earlier recalls, and an Eve scope cannot be rebound", () =>
  run(async ({ actor, memory }) => {
    const saved = await memory.write(actor, {
      action: "remember",
      text: "Synthetic preference: Cedarbay",
      operationId: randomUUID(),
    });
    const first = await memory.recall(
      actor,
      "scope-one",
      "recall-one",
      "Cedarbay"
    );
    expect(first.results[0]?.id).toBe(saved.ids[0]);
    expect(
      await memory.recall(actor, "scope-one", "recall-one", "changed query")
    ).toEqual(first);
    await memory.write(actor, {
      action: "delete",
      memoryId: z.uuid().parse(saved.ids[0]),
      operationId: randomUUID(),
    });
    await expect(
      memory.recall(actor, "scope-one", "recall-one", "Cedarbay")
    ).rejects.toMatchObject({ reason: "stale_recall" });
    expect(
      (await memory.recall(actor, "scope-one", "recall-two", "Cedarbay"))
        .results
    ).toEqual([]);
    await expect(
      memory.recall(actor, "forged-scope", "recall-three", "Cedarbay")
    ).rejects.toMatchObject({ reason: "invalid_input" });
    const reads = vi.spyOn(FileMemory, "read");
    await memory.setEnabled(actor, false);
    expect(
      await memory.recall(actor, "scope-one", "paused", "Cedarbay")
    ).toEqual({ enabled: false, results: [] });
    expect(reads).not.toHaveBeenCalled();
  }));

test("an ambiguous deletion fences recall until explicit clear succeeds", () =>
  run(async ({ actor, memory }) => {
    const saved = await memory.write(actor, {
      action: "remember",
      text: "Cedarbay",
      operationId: randomUUID(),
    });
    await memory.recall(actor, "scope", "before", "Cedarbay");
    vi.spyOn(FileMemory, "mutate").mockRejectedValueOnce(
      new FileMemoryError("unavailable")
    );
    await expect(
      memory.write(actor, {
        action: "delete",
        memoryId: z.uuid().parse(saved.ids[0]),
        operationId: "uncertain-delete",
      })
    ).rejects.toBeInstanceOf(FileMemoryError);
    await expect(
      memory.recall(actor, "scope", "after", "Cedarbay")
    ).rejects.toMatchObject({ reason: "stale_recall" });
    await expect(
      memory.write(actor, {
        action: "remember",
        text: "New fact",
        operationId: "new-write",
      })
    ).rejects.toMatchObject({ reason: "stale_recall" });
    await memory.write(actor, {
      action: "clear",
      operationId: "explicit-recovery",
    });
    expect((await memory.read(actor)).needsAttention).toBe(false);
    expect(
      (await memory.recall(actor, "scope", "recovered", "Cedarbay")).results
    ).toEqual([]);
  }));

test("recovery verifies current files without replaying an uncertain mutation or restoring stale recalls", () =>
  run(async ({ actor, memory }) => {
    await memory.recall(actor, "scope", "before", "Cedarbay");
    const writes = vi
      .spyOn(FileMemory, "mutate")
      .mockRejectedValueOnce(new FileMemoryError("unavailable"));
    await expect(
      memory.write(actor, {
        action: "remember",
        text: "Cedarbay",
        operationId: "uncertain-write",
      })
    ).rejects.toBeInstanceOf(FileMemoryError);
    vi.spyOn(FileMemory, "recover").mockRejectedValueOnce(
      new FileMemoryError("unavailable")
    );
    await expect(memory.recover(actor)).rejects.toBeInstanceOf(FileMemoryError);
    expect((await memory.read(actor, undefined, true)).needsAttention).toBe(
      true
    );
    await memory.recover(actor);
    expect((await memory.read(actor, undefined, true)).needsAttention).toBe(
      false
    );
    await expect(
      memory.recall(actor, "scope", "before", "Cedarbay")
    ).rejects.toMatchObject({ reason: "stale_recall" });
    expect(writes).toHaveBeenCalledTimes(1);
  }));

test("Native tools enforce the published plugin catalog and membership on every call", () => {
  return run(async ({ actor, guest, repository }) => {
    const first = await repository.write(actor, {
      path: "knowledge/plan.md",
      content: "Launch on Monday",
      expectedRevision: null,
      operationId: randomUUID(),
    });
    const read = await invokeWorkspaceTool(guest, {
      path: "workspace_files_search",
      args: { query: "Monday" },
    });
    expect(JSON.stringify(read)).toContain("knowledge/plan.md");
    expect(JSON.stringify(read)).toContain("Monday");
    await repository.write(actor, {
      path: "plugins/workspace.json",
      content: '{"version":1,"enabled":["memory"]}',
      expectedRevision: first.revision,
      operationId: randomUUID(),
    });
    await expect(
      invokeWorkspaceTool(guest, { path: "workspace_files_list", args: {} })
    ).rejects.toThrow(Error);
    await expect(
      invokeWorkspaceTool(guest, { path: "credentials.list", args: {} })
    ).rejects.toThrow(Error);
    await query(
      sql`DELETE FROM organization_memberships WHERE user_id = ${guest.userId}`
    );
    const removed = await Promise.try(async () =>
      invokeWorkspaceTool(guest, { path: "workspace_files_list", args: {} })
    ).then(
      (value) => ({ ok: true as const, value }),
      (error: unknown) => ({ ok: false as const, error })
    );
    expect(!removed.ok && removed.error).toBeInstanceOf(WorkspaceAccessDenied);
  });
});

test("deleted accounts queue durable file erasure; filesystem failure retains the receipt", () =>
  run(async ({ actor, personal, memory }) => {
    for (const person of [actor, personal])
      await memory.write(person, {
        action: "remember",
        text: "Synthetic private note",
        operationId: randomUUID(),
      });
    const partitions = await query<{ id: string }>(
      sql`SELECT namespace_id AS id FROM workspace_memory_namespace WHERE user_id = ${actor.userId}`
    );
    const requestId = randomUUID();
    await query(sql`INSERT INTO account_deletion_requests(id, user_id, status, backup_expires_at, completed_at)
      VALUES (${requestId}, ${actor.userId}, 'pending_external', now() + interval '30 days', now())`);
    await query(sql`INSERT INTO account_deletion_ledger(id, request_id, surface, status) VALUES
      (${randomUUID()}, ${requestId}, 'file_memory', 'pending_external'),
      (${randomUUID()}, ${requestId}, 'mem0', 'pending_external')`);
    await query(
      sql`DELETE FROM public.user WHERE id = ${actor.userId.slice("better-auth:".length)}`
    );
    const queued = async () => {
      for (const { id } of partitions)
        expect(
          await query(
            sql`SELECT 1 FROM workspace_memory_erasure WHERE namespace_id = ${id}`
          )
        ).toHaveLength(1);
    };
    await queued();
    const failedPartition = partitions[0]?.id;
    if (!failedPartition) throw new Error("Expected a synthetic partition");
    await query(sql`UPDATE workspace_memory_erasure SET available_at='1970-01-01'
      WHERE owner_user_id=${actor.userId}`);
    const erase = sourceFiles.eraseSessionSources;
    const attempts = vi
      .spyOn(sourceFiles, "eraseSessionSources")
      .mockImplementation(async (root, id) => {
        if (id === failedPartition)
          throw new Error("Synthetic filesystem failure");
        await erase(root, id);
      });
    await expect(drainMemoryErasures()).rejects.toMatchObject({
      errors: [
        expect.objectContaining({ message: "Synthetic filesystem failure" }),
      ],
    });
    expect(
      await query(sql`SELECT namespace_id FROM workspace_memory_erasure
      WHERE owner_user_id=${actor.userId}`)
    ).toEqual([{ namespace_id: failedPartition }]);
    expect(
      await query(sql`SELECT status FROM account_deletion_ledger
      WHERE request_id=${requestId} AND surface='file_memory'`)
    ).toEqual([{ status: "pending_external" }]);
    attempts.mockRestore();
    await query(sql`UPDATE workspace_memory_erasure SET available_at='1970-01-01'
      WHERE namespace_id=${failedPartition}`);
    await drainMemoryErasures();
    for (const { id } of partitions)
      expect(
        await query(
          sql`SELECT 1 FROM workspace_memory_erasure WHERE namespace_id = ${id}`
        )
      ).toHaveLength(0);
    expect(
      await query(
        sql`SELECT surface, status FROM account_deletion_ledger WHERE request_id = ${requestId}`
      )
    ).toEqual(
      expect.arrayContaining([
        { surface: "file_memory", status: "erased" },
        { surface: "mem0", status: "pending_external" },
      ])
    );
  }));
