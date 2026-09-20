import { Secret } from "@shared/environment/secret";
vi.mock("@shared/environment", async (original) => {
  const actual = await original<typeof import("@shared/environment")>();
  return {
    ...actual,
    env: {
      ...actual.env,
      ZOEN_MEM0_URL: "https://mem0.zoen.test",
      ZOEN_MEM0_API_KEY: new Secret("synthetic-memory-key"),
    },
  };
});
import { query } from "@db/queries";
import { sql } from "drizzle-orm";
import { jsonString } from "@shared/validation";
import { z } from "zod";
import { randomUUID } from "node:crypto";

import { afterEach, expect, test, vi } from "vitest";
import { LearnedMemory } from "../../server/memory/learned";

import { drainMemoryErasures } from "../../server/memory/erasure";

import { WorkspaceAccessDenied } from "../../server/workspaces/access";
import { invokeWorkspaceTool } from "../../server/tools/workspace";
import { workspaceFixture } from "./workspace-fixture";

const requestSchema = jsonString(
  z.object({
    namespace: z.uuid(),
    action: z.string(),
    operation_id: z.optional(z.string()),
  })
);
const network = () =>
  vi.spyOn(globalThis, "fetch").mockImplementation(async (_url, init) => {
    const input = requestSchema.parse(init?.body);
    return Response.json(
      input.action === "list" || input.action === "search"
        ? { results: [] }
        : { ids: [] }
    );
  });
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
afterEach(() => {
  vi.restoreAllMocks();
});

test("partitions personal/work memory and each member; forged workspace access never reaches Mem0", () => {
  const backend = network();
  return run(async ({ actor, guest, personal, memory }) => {
    for (const person of [actor, guest, personal])
      await memory.write(
        person,
        {
          action: "remember",
          text: "Synthetic preference",
          operationId: randomUUID(),
        },
        false
      );
    const requests = backend.mock.calls.map(([, init]) =>
      requestSchema.parse(init?.body)
    );
    expect(new Set(requests.map((request) => request.namespace)).size).toBe(3);
    expect(
      requests.every((request) => !request.namespace.includes(actor.userId))
    ).toBe(true);
    const denied = await Promise.try(async () =>
      memory.read({ ...guest, workspaceId: personal.workspaceId })
    ).then(
      (value) => ({ ok: true as const, value }),
      (error: unknown) => ({ ok: false as const, error })
    );
    expect(!denied.ok && denied.error).toBeInstanceOf(WorkspaceAccessDenied);
    expect(backend).toHaveBeenCalledTimes(3);
  });
});

test("replay is stable, forget tombstones previous recalls, and a scope key cannot be rebound", () => {
  const backend = network();
  const fact = {
    id: randomUUID(),
    memory: "Synthetic old preference",
    createdAt: null,
    updatedAt: null,
  };
  return run(async ({ actor, memory }) => {
    backend.mockResolvedValueOnce(Response.json({ results: [fact] }));
    const first = await memory.recall(
      actor,
      "opaque-scope-one",
      "recall-one",
      "preference"
    );
    expect(first.results).toEqual([fact]);
    expect(
      await memory.recall(
        actor,
        "opaque-scope-one",
        "recall-one",
        "changed query"
      )
    ).toEqual(first);
    expect(backend).toHaveBeenCalledTimes(1);
    await memory.write(actor, {
      action: "delete",
      memoryId: fact.id,
      operationId: randomUUID(),
    });
    const stale = await Promise.try(async () =>
      memory.recall(actor, "opaque-scope-one", "recall-one", "preference")
    ).then(
      (value) => ({ ok: true as const, value }),
      (error: unknown) => ({ ok: false as const, error })
    );
    expect(!stale.ok && stale.error).toMatchObject({
      reason: "stale_recall",
    });
    expect(
      (
        await memory.recall(
          actor,
          "opaque-scope-one",
          "recall-two",
          "preference"
        )
      ).results
    ).toEqual([]);
    const rebound = await Promise.try(async () =>
      memory.recall(actor, "forged-scope", "recall-three", "preference")
    ).then(
      (value) => ({ ok: true as const, value }),
      (error: unknown) => ({ ok: false as const, error })
    );
    expect(!rebound.ok && rebound.error).toMatchObject({
      reason: "invalid_input",
    });
    await memory.setEnabled(actor, false);
    const before = backend.mock.calls.length;
    expect(
      await memory.recall(
        actor,
        "opaque-scope-one",
        "recall-paused",
        "preference"
      )
    ).toEqual({ enabled: false, results: [] });
    expect(backend).toHaveBeenCalledTimes(before);
  });
});

test("an ambiguous deletion fences recall until an explicit clear acknowledges recovery", () => {
  const backend = network();
  return run(async ({ actor, memory }) => {
    await memory.recall(actor, "scope", "before", "test");
    backend.mockResolvedValueOnce(Response.json({}, { status: 503 }));
    const failed = await Promise.try(async () =>
      memory.write(actor, {
        action: "delete",
        memoryId: randomUUID(),
        operationId: "uncertain-delete",
      })
    ).then(
      (value) => ({ ok: true as const, value }),
      (error: unknown) => ({ ok: false as const, error })
    );
    expect(!failed.ok && failed.error).toMatchObject({
      _tag: "Mem0Error",
    });
    const fenced = await Promise.try(async () =>
      memory.recall(actor, "scope", "after", "test")
    ).then(
      (value) => ({ ok: true as const, value }),
      (error: unknown) => ({ ok: false as const, error })
    );
    expect(!fenced.ok && fenced.error).toMatchObject({
      reason: "stale_recall",
    });
    const unrelated = await Promise.try(async () =>
      memory.write(actor, {
        action: "remember",
        text: "New fact",
        operationId: "new-write",
      })
    ).then(
      (value) => ({ ok: true as const, value }),
      (error: unknown) => ({ ok: false as const, error })
    );
    expect(!unrelated.ok && unrelated.error).toMatchObject({
      reason: "stale_recall",
    });
    expect(backend).toHaveBeenCalledTimes(2);
    await memory.write(actor, {
      action: "clear",
      operationId: "explicit-recovery",
    });
    expect((await memory.read(actor)).needsAttention).toBe(false);
    expect(
      (await memory.recall(actor, "scope", "recovered", "test")).results
    ).toEqual([]);
  });
});

test("recovery verifies current memory without replaying an uncertain mutation or restoring old recalls", () => {
  const backend = network();
  return run(async ({ actor, memory }) => {
    await memory.recall(actor, "scope", "before", "test");
    backend.mockResolvedValueOnce(Response.json({}, { status: 503 }));
    await Promise.try(async () =>
      memory.write(actor, {
        action: "remember",
        text: "Uncertain fact",
        operationId: "uncertain-write",
      })
    ).then(
      (value) => ({ ok: true as const, value }),
      (error: unknown) => ({ ok: false as const, error })
    );
    backend.mockResolvedValueOnce(Response.json({}, { status: 503 }));
    expect(
      !(
        await Promise.try(async () => memory.recover(actor)).then(
          (value) => ({ ok: true as const, value }),
          (error: unknown) => ({ ok: false as const, error })
        )
      ).ok
    ).toBe(true);
    expect((await memory.read(actor, undefined, true)).needsAttention).toBe(
      true
    );
    await memory.recover(actor);
    expect((await memory.read(actor, undefined, true)).needsAttention).toBe(
      false
    );
    const stale = await Promise.try(async () =>
      memory.recall(actor, "scope", "before", "test")
    ).then(
      (value) => ({ ok: true as const, value }),
      (error: unknown) => ({ ok: false as const, error })
    );
    expect(!stale.ok && stale.error).toMatchObject({
      reason: "stale_recall",
    });
    const actions = backend.mock.calls.map(
      ([, init]) => requestSchema.parse(init?.body).action
    );
    expect(actions.filter((action) => action === "remember")).toHaveLength(1);
    expect(actions).not.toContain("clear");
  });
});

test("Native tools enforce the published plugin catalog and membership on every call", () => {
  network();
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

test("deleted accounts queue durable memory erasure; a failed service call retains the receipt", () => {
  const backend = network();
  return run(async ({ actor, personal, memory }) => {
    await memory.read(actor);
    await memory.read(personal);
    const partitions = await query<{
      id: string;
    }>(
      sql`SELECT namespace_id AS id FROM workspace_memory_namespace WHERE user_id = ${actor.userId}`
    );
    await query(
      sql`DELETE FROM public.user WHERE id = ${actor.userId.slice("better-auth:".length)}`
    );
    for (const { id } of partitions) {
      expect(
        await query(
          sql`SELECT 1 FROM workspace_memory_erasure WHERE namespace_id = ${id}`
        )
      ).toHaveLength(1);
    }
    backend.mockResolvedValueOnce(Response.json({}, { status: 503 }));
    expect(
      !(
        await Promise.try(async () => drainMemoryErasures()).then(
          (value) => ({ ok: true as const, value }),
          (error: unknown) => ({ ok: false as const, error })
        )
      ).ok
    ).toBe(true);
    for (const { id } of partitions) {
      expect(
        await query(
          sql`SELECT 1 FROM workspace_memory_erasure WHERE namespace_id = ${id}`
        )
      ).toHaveLength(1);
    }
    // The isolated test database can contain receipts from previous integration fixtures.
    for (let i = 0; i < 20; i++) {
      if ((await drainMemoryErasures()).cleared === 0) break;
    }
    for (const { id } of partitions) {
      expect(
        await query(
          sql`SELECT 1 FROM workspace_memory_erasure WHERE namespace_id = ${id}`
        )
      ).toHaveLength(0);
    }
  });
});
