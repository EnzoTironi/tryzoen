import { query } from "@db/queries";
import { sql } from "drizzle-orm";
import { ZodError } from "zod";
import { randomUUID } from "node:crypto";
import { setTimeout as delay } from "node:timers/promises";
import { rm } from "node:fs/promises";
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
      memoryId: saved.ids[0],
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
        memoryId: saved.ids[0],
        text: "An unfinished correction.",
        operationId: randomUUID(),
      })
    ).rejects.toBeInstanceOf(FileMemoryError);
    await expect(memory.history(actor, input)).rejects.toMatchObject({
      reason: "stale_recall",
    });
    expect(audit).not.toHaveBeenCalled();
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
    await expect(
      memory.read({ ...guest, workspaceId: personal.workspaceId })
    ).rejects.toBeInstanceOf(WorkspaceAccessDenied);
    expect(reads).toHaveBeenCalledTimes(3);
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
      memoryId: saved.ids[0],
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
        memoryId: saved.ids[0],
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
    vi.spyOn(FileMemory, "read").mockRejectedValueOnce(
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
    vi.spyOn(sourceFiles, "eraseSessionSources").mockRejectedValueOnce(
      new Error("Synthetic filesystem failure")
    );
    await expect(drainMemoryErasures()).rejects.toThrow(
      "Synthetic filesystem failure"
    );
    await queued();
    for (let i = 0; i < 20; i++)
      if ((await drainMemoryErasures()).cleared === 0) break;
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
