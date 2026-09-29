import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { randomUUID } from "node:crypto";
import { mkdtempDisposable } from "node:fs/promises";
import { arch, platform, tmpdir } from "node:os";
import { isAbsolute, join } from "node:path";
import { parseArgs } from "node:util";
import { sql } from "drizzle-orm";
import { z } from "zod";

const { values } = parseArgs({
  options: {
    binary: { type: "string" },
    accounts: { type: "string", default: "20" },
    sources: { type: "string", default: "25" },
    workers: { type: "string", default: "4" },
    help: { type: "boolean", short: "h" },
  },
});
if (values.help) {
  console.log(`Measure bounded archive delivery with PostgreSQL, fsync and real Akita ingestion.

Options:
  --binary PATH   Required: absolute path to qualified ai-memory 2.4.1
  --accounts N    Synthetic accounts, 1–100 (default 20)
  --sources N     Sources per account, 1–100 (default 25)
  --workers N     Concurrent dispatch calls, 1–8 (default 4)

Example (Node 24, isolated services already started and migrated):
  node --env-file=tests/runtime/.env.example --import tsx scripts/session-archive-capacity.ts --binary /tmp/zoen-ai-memory-runtime/ai-memory --accounts 20 --sources 25 --workers 4 > /tmp/archive-capacity.json

Run alone, never alongside runtime tests. Only loopback companion_runtime_test
is accepted; pending sources must be empty. Fixtures and files are disposed after
measurement. No database reset, provider credentials or model calls are needed.
Stdout is one JSON report. This local sample does not certify production scale.`);
} else {
  const parsed = z
    .object({
      binary: z
        .string()
        .refine(
          (value) => isAbsolute(value),
          "--binary must be an absolute path"
        ),
      accounts: z.coerce.number().int().min(1).max(100),
      sources: z.coerce.number().int().min(1).max(100),
      workers: z.coerce.number().int().min(1).max(8),
    })
    .safeParse(values);
  if (!parsed.success)
    throw new Error(`${parsed.error.issues.map((issue) => `${issue.path.join(".")}: ${issue.message}`).join("; ")}
Run: node --import tsx scripts/session-archive-capacity.ts --help`);
  const options = parsed.data;
  assert.equal(
    execFileSync(options.binary, ["--version"], {
      encoding: "utf8",
      timeout: 10_000,
      env: { PATH: "/usr/bin:/bin", NODE_ENV: "test" },
    }).trim(),
    "ai-memory 2.4.1"
  );
  process.umask(0o077);
  await using directory = await mkdtempDisposable(
    join(tmpdir(), "zoen-archive-capacity-")
  );
  // This harness sets its disposable storage before loading the validated app
  // environment. It never reuses a configured personal or production corpus.
  // oxlint-disable-next-line eslint/no-restricted-properties
  Object.assign(process.env, {
    ZOEN_SESSION_ARCHIVE_DIR: directory.path,
    ZOEN_AI_MEMORY_BINARY: options.binary,
  });
  const { requireRuntimeDatabase } = await import("../tests/runtime/database");
  const { db } = await import("../db");
  const namespaceIds: string[] = [];
  try {
    await requireRuntimeDatabase();
    const { query } = await import("../db/queries");
    assert.equal(
      (
        await query(
          sql`SELECT event_id FROM memory_session_sources WHERE stored_at IS NULL LIMIT 1`
        )
      ).length,
      0,
      "Run only when the isolated runtime database has no pending sources."
    );
    await using fixtures = new AsyncDisposableStack();
    const { workspaceFixture } =
      await import("../tests/runtime/workspace-fixture");
    const { claimSession } = await import("../db/services/sessions");
    const { captureSessionSource, drainSessionSources } =
      await import("../server/memory/session-capture");
    const { sessionSource } = await import("../server/memory/session-files");
    const started = performance.now();
    for (let account = 0; account < options.accounts; account++) {
      const fixture = fixtures.use(await workspaceFixture());
      const sessionId = `archive-capacity-${randomUUID()}`;
      await claimSession(fixture.personal, sessionId);
      for (let sequence = 0; sequence < options.sources; sequence++) {
        await captureSessionSource(
          fixture.personal,
          sessionSource(
            {
              type: "message.received",
              meta: { id: randomUUID(), at: new Date().toISOString() },
              data: {
                message: `Synthetic capacity source ${sequence}; account ${account}.`,
                sequence,
                turnId: "capacity",
              },
            },
            sessionId
          )
        );
      }
      const [namespace] = await query<{
        id: string;
      }>(sql`SELECT namespace_id AS id FROM workspace_memory_namespace
        WHERE workspace_id = ${fixture.personal.workspaceId} AND user_id = ${fixture.personal.userId}`);
      assert(namespace);
      namespaceIds.push(namespace.id);
    }
    const setupMs = performance.now() - started;
    const dispatchStarted = performance.now();
    const cpu = process.cpuUsage();
    const dispatchMs: number[] = [];
    let stored = 0;
    let rounds = 0;
    const expected = options.accounts * options.sources;
    while (stored < expected) {
      assert(rounds++ < expected, "Delivery stopped making progress.");
      const deliveries = await Promise.allSettled(
        Array.from({ length: options.workers }, async () => {
          const start = performance.now();
          const result = await drainSessionSources();
          dispatchMs.push(performance.now() - start);
          return result.stored;
        })
      );
      const failures: unknown[] = [];
      let delivered = 0;
      for (const delivery of deliveries) {
        if (delivery.status === "rejected") failures.push(delivery.reason);
        else delivered += delivery.value;
      }
      if (failures.length)
        throw new AggregateError(
          failures,
          "Capacity measurement failed; all workers have settled."
        );
      assert(delivered > 0, "The fixture backlog must advance each round.");
      stored += delivered;
    }
    const elapsedMs = performance.now() - dispatchStarted;
    assert.equal(stored, expected);
    const receipts = await query<{
      id: string;
      stored: number;
      pending: number;
    }>(sql`
      SELECT namespace_id AS id, count(*) FILTER (WHERE stored_at IS NOT NULL)::int AS stored,
        count(*) FILTER (WHERE stored_at IS NULL)::int AS pending
      FROM memory_session_sources WHERE namespace_id IN (${sql.join(
        namespaceIds.map((id) => sql`${id}::uuid`),
        sql`, `
      )})
      GROUP BY namespace_id`);
    assert.equal(receipts.length, options.accounts);
    for (const receipt of receipts) {
      assert.equal(receipt.stored, options.sources);
      assert.equal(receipt.pending, 0);
    }
    assert.equal((await drainSessionSources()).stored, 0);
    dispatchMs.sort((a, b) => a - b);
    const report = {
      schema: 1,
      measuredAt: new Date().toISOString(),
      workload: {
        accounts: options.accounts,
        sourcesPerAccount: options.sources,
        workers: options.workers,
        sourceKind: "message.received",
      },
      engine: "ai-memory 2.4.1",
      host: { platform: platform(), arch: arch(), node: process.version },
      stored,
      rounds,
      setupMs,
      elapsedMs,
      sourcesPerSecond: (stored * 1000) / elapsedMs,
      dispatchMs: {
        p50: dispatchMs[Math.ceil(dispatchMs.length * 0.5) - 1],
        p95: dispatchMs[Math.ceil(dispatchMs.length * 0.95) - 1],
        max: dispatchMs.at(-1),
      },
      parentProcess: {
        cpuMicroseconds: process.cpuUsage(cpu),
        finalRssBytes: process.memoryUsage().rss,
      },
      receiptsVerified: true,
      limits: [
        "Loopback PostgreSQL and temporary local disk, not production topology",
        "Minute scheduler cadence is excluded; dispatch is continuous",
        "Parent process metrics exclude native child processes and PostgreSQL",
        "No embeddings, LLM dreaming, cold/large corpora, outage injection or one-million-account claim",
      ],
    };
    console.log(JSON.stringify(report, null, 2));
  } finally {
    try {
      // Fixture disposal has removed these namespaces; the disposable volume
      // is removed next. Clear only erasure receipts created by this run.
      if (namespaceIds.length) {
        const { query } = await import("../db/queries");
        await query(sql`DELETE FROM workspace_memory_erasure WHERE namespace_id IN (
          ${sql.join(
            namespaceIds.map((id) => sql`${id}::uuid`),
            sql`, `
          )})`);
      }
    } finally {
      await db.$client.end();
    }
  }
}
