import { randomUUID } from "node:crypto";
import { mkdir, readFile, rm, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { afterAll, afterEach, expect, test, vi } from "vitest";
import { sql } from "drizzle-orm";
import { query, transaction } from "@db/queries";
import { drainMemoryErasures } from "../../server/memory/erasure";
import * as sources from "../../server/memory/session-files";

const { directory } = await vi.hoisted(async () => {
  const { mkdtemp } = await import("node:fs/promises");
  const { tmpdir } = await import("node:os");
  const pathModule = await import("node:path");
  return {
    directory: await mkdtemp(pathModule.join(tmpdir(), "zoen-memory-erasure-")),
  };
});
vi.mock("@shared/environment/env", async (original) => {
  const actual = await original<typeof import("@shared/environment/env")>();
  return {
    ...actual,
    env: { ...actual.env, ZOEN_SESSION_ARCHIVE_DIR: directory },
  };
});

const receipts: string[] = [];
const requests: string[] = [];
afterEach(async () => {
  for (const id of receipts.splice(0))
    await query(
      sql`DELETE FROM workspace_memory_erasure WHERE namespace_id=${id}`
    );
  for (const id of requests.splice(0))
    await query(sql`DELETE FROM account_deletion_requests WHERE id=${id}`);
});
afterAll(() => rm(directory, { recursive: true, force: true }));

async function enqueue(owner: string | null = null) {
  const id = randomUUID();
  receipts.push(id);
  const path = join(directory, id, "raw", "eve");
  await mkdir(path, { recursive: true });
  await writeFile(join(path, "synthetic.jsonl"), "Synthetic erasure fixture");
  await query(sql`INSERT INTO workspace_memory_erasure(namespace_id, owner_user_id, requested_at, available_at)
    VALUES (${id}, ${owner}, ${new Date(receipts.length)}, ${new Date(receipts.length)})`);
  return id;
}

test("a failed erasure does not roll back another account's completion", async () => {
  const healthy = await enqueue();
  const damaged = await enqueue();
  const erase = sources.eraseSessionSources;
  vi.spyOn(sources, "eraseSessionSources").mockImplementation(
    async (root, id) => {
      if (id === damaged) throw new Error("Synthetic filesystem failure");
      await erase(root, id);
    }
  );
  await expect(drainMemoryErasures()).rejects.toBeInstanceOf(Error);
  expect(
    await query(sql`SELECT namespace_id FROM workspace_memory_erasure
    WHERE namespace_id=${healthy}`)
  ).toHaveLength(0);
  expect(
    await query(sql`SELECT namespace_id FROM workspace_memory_erasure
    WHERE namespace_id=${damaged}`)
  ).toHaveLength(1);
  await expect(
    readFile(join(directory, healthy, "raw/eve/synthetic.jsonl"))
  ).rejects.toMatchObject({ code: "ENOENT" });
  expect(
    await readFile(join(directory, damaged, "raw/eve/synthetic.jsonl"), "utf8")
  ).toBe("Synthetic erasure fixture");
});

test("a failing receipt backs off durably without storing error content, and recovers after repair", async () => {
  const damaged = await enqueue();
  const erase = sources.eraseSessionSources;
  const attempts = vi
    .spyOn(sources, "eraseSessionSources")
    .mockImplementation(async (root, id) => {
      if (id === damaged)
        throw new Error("Synthetic private filename must not be persisted");
      await erase(root, id);
    });
  await expect(drainMemoryErasures()).rejects.toBeInstanceOf(AggregateError);
  const [first] = await query<{
    failures: number;
    failed: boolean;
    wait: number;
  }>(sql`
    SELECT erasure_failures AS failures, last_failed_at IS NOT NULL AS failed,
      extract(epoch FROM available_at-clock_timestamp())::float AS wait
    FROM workspace_memory_erasure WHERE namespace_id=${damaged}`);
  expect(first).toMatchObject({ failures: 1, failed: true });
  expect(first?.wait).toBeGreaterThan(45);
  expect(first?.wait).toBeLessThanOrEqual(60);
  const [receipt] = await query<{
    payload: string;
  }>(sql`SELECT row_to_json(e)::text AS payload
    FROM workspace_memory_erasure e WHERE namespace_id=${damaged}`);
  expect(receipt?.payload).not.toContain("Synthetic private filename");
  attempts.mockClear();
  await drainMemoryErasures();
  expect(attempts.mock.calls.some(([, id]) => id === damaged)).toBe(false);
  await query(
    sql`UPDATE workspace_memory_erasure SET available_at='1970-01-01', erasure_failures=20 WHERE namespace_id=${damaged}`
  );
  await expect(drainMemoryErasures()).rejects.toBeInstanceOf(AggregateError);
  const [capped] = await query<{ failures: number; wait: number }>(sql`
    SELECT erasure_failures AS failures, extract(epoch FROM available_at-clock_timestamp())::float AS wait
    FROM workspace_memory_erasure WHERE namespace_id=${damaged}`);
  expect(capped?.failures).toBe(21);
  expect(capped?.wait).toBeGreaterThan(3580);
  expect(capped?.wait).toBeLessThanOrEqual(3600);
  attempts.mockRestore();
  await query(
    sql`UPDATE workspace_memory_erasure SET available_at='1970-01-01' WHERE namespace_id=${damaged}`
  );
  await drainMemoryErasures();
  expect(
    await query(
      sql`SELECT 1 FROM workspace_memory_erasure WHERE namespace_id=${damaged}`
    )
  ).toHaveLength(0);
  await expect(
    readFile(join(directory, damaged, "raw/eve/synthetic.jsonl"))
  ).rejects.toMatchObject({ code: "ENOENT" });
});

test("each dispatch has a five-partition budget", async () => {
  const ids = [];
  for (let i = 0; i < 7; i++) ids.push(await enqueue());
  expect(await drainMemoryErasures()).toEqual({ cleared: 5 });
  const pending = await query<{
    id: string;
  }>(sql`SELECT namespace_id AS id FROM workspace_memory_erasure
    WHERE namespace_id IN (${sql.join(
      ids.map((id) => sql`${id}::uuid`),
      sql`, `
    )}) ORDER BY requested_at`);
  expect(pending.map((row) => row.id)).toEqual(ids.slice(5));
});

test("a locked partition is skipped while an unrelated account completes", async () => {
  const held = await enqueue();
  const healthy = await enqueue();
  const locked = Promise.withResolvers<void>();
  const release = Promise.withResolvers<void>();
  const holding = transaction(async () => {
    await query(
      sql`SELECT namespace_id FROM workspace_memory_erasure WHERE namespace_id=${held} FOR UPDATE`
    );
    locked.resolve();
    await release.promise;
  });
  await locked.promise;
  try {
    await drainMemoryErasures();
    expect(
      await query(
        sql`SELECT 1 FROM workspace_memory_erasure WHERE namespace_id=${healthy}`
      )
    ).toHaveLength(0);
    expect(
      await query(
        sql`SELECT 1 FROM workspace_memory_erasure WHERE namespace_id=${held}`
      )
    ).toHaveLength(1);
  } finally {
    release.resolve();
    await holding;
  }
});

async function deletionRequest() {
  const userId = `better-auth:erasure-${randomUUID()}`;
  const id = randomUUID();
  requests.push(id);
  await query(sql`INSERT INTO account_deletion_requests(id, user_id, status, backup_expires_at, completed_at)
    VALUES (${id}, ${userId}, 'pending_external', now()+interval '30 days', now())`);
  await query(sql`INSERT INTO account_deletion_ledger(id, request_id, surface, status) VALUES
    (${randomUUID()}, ${id}, 'file_memory', 'pending_external'),
    (${randomUUID()}, ${id}, 'mem0', 'pending_external')`);
  return { id, userId };
}

test("concurrent partition acknowledgements complete only this account's file-memory obligation", async () => {
  const owner = await deletionRequest();
  const unrelated = await deletionRequest();
  const ids = new Set<string>([
    await enqueue(owner.userId),
    await enqueue(owner.userId),
  ]);
  const both = Promise.withResolvers<void>();
  const reached = new Set<string>();
  const erase = sources.eraseSessionSources;
  const attempts = vi
    .spyOn(sources, "eraseSessionSources")
    .mockImplementation(async (root, id) => {
      if (ids.has(id)) {
        reached.add(id);
        if (reached.size === 2) both.resolve();
        await both.promise;
      }
      await erase(root, id);
    });
  await Promise.all([drainMemoryErasures(), drainMemoryErasures()]);
  expect(attempts.mock.calls.filter(([, id]) => ids.has(id))).toHaveLength(2);
  expect(
    await query(
      sql`SELECT 1 FROM workspace_memory_erasure WHERE owner_user_id=${owner.userId}`
    )
  ).toHaveLength(0);
  expect(
    await query(
      sql`SELECT surface, status FROM account_deletion_ledger WHERE request_id=${owner.id} ORDER BY surface`
    )
  ).toEqual([
    { surface: "file_memory", status: "erased" },
    { surface: "mem0", status: "pending_external" },
  ]);
  expect(
    await query(
      sql`SELECT status FROM account_deletion_ledger WHERE request_id=${unrelated.id}`
    )
  ).toEqual([{ status: "pending_external" }, { status: "pending_external" }]);
});

test("partial filesystem completion stays pending until a retry confirms every subtree", async () => {
  const owner = await deletionRequest();
  const id = await enqueue(owner.userId);
  const erase = sources.eraseSessionSources;
  const attempts = vi
    .spyOn(sources, "eraseSessionSources")
    .mockImplementation(async (root, namespace) => {
      await erase(root, namespace);
      if (namespace === id)
        throw new Error("Synthetic interruption after filesystem deletion");
    });
  await expect(drainMemoryErasures()).rejects.toBeInstanceOf(AggregateError);
  await expect(
    readFile(join(directory, id, "raw/eve/synthetic.jsonl"))
  ).rejects.toMatchObject({ code: "ENOENT" });
  expect(
    await query(
      sql`SELECT status FROM account_deletion_ledger WHERE request_id=${owner.id} AND surface='file_memory'`
    )
  ).toEqual([{ status: "pending_external" }]);
  attempts.mockRestore();
  await query(
    sql`UPDATE workspace_memory_erasure SET available_at='1970-01-01' WHERE namespace_id=${id}`
  );
  await drainMemoryErasures();
  expect(
    await query(
      sql`SELECT status FROM account_deletion_ledger WHERE request_id=${owner.id} AND surface='file_memory'`
    )
  ).toEqual([{ status: "erased" }]);
});
