import { expect, test } from "vitest";
import { z } from "zod";
import { executeSemanticSnapshot } from "../../server/workspaces/semantic/execute";
import { withSignal } from "../../server/operations/async";

const source = {
  name: "items",
  columns: [{ name: "amount", type: "numeric" as const }],
  rows: [[10], [20]],
};
const tables = [source];
const model =
  "source: items is snapshot.table('public.items')\nquery: total is items -> { aggregate: total is amount.sum() }";
const input = { model, query: "total", arguments: {}, tables };

test("compiles and executes a known total in a disposable snapshot with manifest", async () => {
  const value = await executeSemanticSnapshot(input);
  expect(value.rows).toEqual([{ total: 30 }]);
  expect(value.sql).toContain("SUM");
  expect(value.manifest.inputSha256).toMatch(/^[a-f0-9]{64}$/);
  const other = await executeSemanticSnapshot({
    ...input,
    tables: [{ ...source, rows: [[7]] }],
  });
  expect(other.rows).toEqual([{ total: 7 }]);
  expect(other.manifest.inputSha256).not.toBe(value.manifest.inputSha256);
}, 30000);

test.each([
  "import: 'https://example.invalid/private.malloy'\n" + model,
  "source: items is snapshot.table('pg_catalog.pg_authid')\nquery: total is items -> { select: * }",
  "source: items is snapshot.sql('SELECT 1 AS amount')\nquery: total is items -> { select: * }",
])(
  "rejects an import, unregistered table or SQL source",
  async (invalidModel) => {
    await expect(
      executeSemanticSnapshot({ ...input, model: invalidModel })
    ).rejects.toThrow("Semantic execution failed");
  },
  20000
);

test("rejects output beyond the row bound instead of silently truncating", async () => {
  await expect(
    executeSemanticSnapshot({
      ...input,
      model:
        "source: items is snapshot.table('public.items')\nquery: total is items -> { select: amount }",
      tables: [{ ...source, rows: Array.from({ length: 101 }, (_, i) => [i]) }],
    })
  ).rejects.toThrow("Semantic execution failed");
}, 20000);

test("cancels an active child rather than waiting for query completion", async () => {
  const controller = new AbortController();
  const pending = withSignal(controller.signal, () =>
    executeSemanticSnapshot(input)
  );
  const timer = setTimeout(() => {
    controller.abort(new Error("cancelled"));
  }, 100);
  try {
    await expect(pending).rejects.toThrow("cancelled");
    await expect
      .poll(() => executeSemanticSnapshot(input), { timeout: 8_000 })
      .toMatchObject({ rows: [{ total: 30 }] });
  } finally {
    clearTimeout(timer);
  }
});

test("rejects malformed source names before spawning", async () => {
  await expect(
    executeSemanticSnapshot({
      ...input,
      tables: [{ ...source, name: "items; DROP TABLE items" }],
    })
  ).rejects.toThrow("Invalid string");
});

test("rejects unsafe numeric arguments before starting a calculation", async () => {
  await expect(
    executeSemanticSnapshot({
      ...input,
      arguments: { minimum: 9_007_199_254_740_992 },
    })
  ).rejects.toThrow("Unsafe integer");
});

test("treats string arguments as data even when they contain SQL syntax", async () => {
  const value = "x' OR 1=1 --";
  const result = await executeSemanticSnapshot({
    query: "matches",
    arguments: { requested: value },
    model:
      "##! experimental.givens\ngiven: requested :: string\n" +
      "source: items is snapshot.table('public.items')\n" +
      "query: matches is items -> { where: label = $requested aggregate: total is amount.sum() }",
    tables: [
      {
        name: "items",
        columns: [
          { name: "label", type: "text" },
          { name: "amount", type: "numeric" },
        ],
        rows: [
          [value, 7],
          ["other", 20],
        ],
      },
    ],
  });
  expect(result.rows).toEqual([{ total: 7 }]);
}, 20000);

test("published scalar arguments change the compiled query and answer; unused arguments fail", async () => {
  const parameterized = {
    ...input,
    model:
      "##! experimental.givens\ngiven: minimum :: number\n" +
      "source: items is snapshot.table('public.items')\n" +
      "query: total is items -> { where: amount >= $minimum aggregate: total is amount.sum() }",
  };
  const first = await executeSemanticSnapshot({
    ...parameterized,
    arguments: { minimum: 15 },
  });
  const second = await executeSemanticSnapshot({
    ...parameterized,
    arguments: { minimum: 0 },
  });
  expect(first.rows).toEqual([{ total: 20 }]);
  expect(second.rows).toEqual([{ total: 30 }]);
  expect(first.manifest.sqlSha256).not.toBe(second.manifest.sqlSha256);
  await expect(
    executeSemanticSnapshot({ ...input, arguments: { unused: 1 } })
  ).rejects.toThrow("Semantic execution failed");
}, 20000);

test("rejects oversized result bytes and source payloads", async () => {
  const large = {
    ...input,
    model:
      "source: items is snapshot.table('public.items')\nquery: total is items -> { select: text }",
    tables: [
      {
        name: "items",
        columns: [{ name: "text", type: "text" as const }],
        rows: Array.from({ length: 30 }, () => ["x".repeat(4000)]),
      },
    ],
  };
  await expect(executeSemanticSnapshot(large)).rejects.toThrow(
    "Semantic execution failed"
  );
  await expect(
    executeSemanticSnapshot({
      ...large,
      tables: [
        {
          ...large.tables[0],
          name: "items",
          columns: [{ name: "text", type: "text" }],
          rows: Array.from({ length: 300 }, () => ["x".repeat(4000)]),
        },
      ],
    })
  ).rejects.toThrow("Semantic input exceeds its byte limit");
}, 20000);

test("kills an actual slow database query at the execution deadline", async () => {
  await expect(
    executeSemanticSnapshot({
      ...input,
      model:
        "##! experimental.sql_functions\nsource: items is snapshot.table('public.items')\n" +
        "query: total is items -> { select: delay is sql_number('COALESCE((SELECT 1 FROM pg_sleep(30)),0)') }",
      tables: [{ ...source, rows: [[1]] }],
    })
  ).rejects.toThrow("Semantic execution deadline reached");
}, 20000);

test("preserves project budgets under one-to-many joins and retains an empty project", async () => {
  const result = await executeSemanticSnapshot({
    query: "totals",
    arguments: {},
    model:
      "source: expenses is snapshot.table('public.expenses')\n" +
      "source: projects is snapshot.table('public.projects') extend {\n" +
      "  primary_key: id\n  join_many: expenses on id = expenses.project_id\n}\n" +
      "query: totals is projects -> { group_by: id aggregate: budget is budget.sum(), spent is expenses.amount.sum() order_by: id }",
    tables: [
      {
        name: "projects",
        columns: [
          { name: "id", type: "numeric" },
          { name: "budget", type: "numeric" },
        ],
        rows: [
          [1, 100],
          [2, 200],
          [3, 300],
        ],
      },
      {
        name: "expenses",
        columns: [
          { name: "project_id", type: "numeric" },
          { name: "amount", type: "numeric" },
        ],
        rows: [
          [1, 10],
          [1, 20],
          [2, 5],
        ],
      },
    ],
  });
  expect(result.rows).toEqual([
    { id: 1, budget: 100, spent: 30 },
    { id: 2, budget: 200, spent: 5 },
    { id: 3, budget: 300, spent: 0 },
  ]);
}, 20000);

test.each(["9007199254740993", "0.1234567890123456789012345"])(
  "keeps exact numeric source value %s in the returned answer",
  async (value) => {
    const result = await executeSemanticSnapshot({
      ...input,
      tables: [{ ...source, rows: [[value]] }],
    });
    expect(result.rows[0]?.total).toBe(value);
  },
  20000
);

test("rejects excess concurrency and acknowledges cancelled workers before releasing admission", async () => {
  const controllers = [new AbortController(), new AbortController()];
  const pending = controllers.map((controller) =>
    withSignal(controller.signal, () => executeSemanticSnapshot(input))
  );
  try {
    await expect(executeSemanticSnapshot(input)).rejects.toThrow(
      "Semantic execution is busy"
    );
  } finally {
    controllers.forEach((controller) => {
      controller.abort(new Error("cancelled"));
    });
    await Promise.allSettled(pending);
  }
  await expect
    .poll(() => executeSemanticSnapshot(input), { timeout: 8_000 })
    .toMatchObject({ rows: [{ total: 30 }] });
}, 20000);

// This suite uses only the dedicated Compose capsules, not the application cgroup.
async function capsuleMemory(name: string) {
  const { execFile } = await import("node:child_process");
  const { promisify } = await import("node:util");
  const { stdout } = await promisify(execFile)(
    "docker",
    [
      "exec",
      name,
      "node",
      "-e",
      "const fs=require('node:fs');console.log(JSON.stringify(Object.fromEntries(['memory.max','memory.swap.max','memory.current','memory.peak','memory.events'].map(p=>[p,fs.readFileSync('/sys/fs/cgroup/'+p,'utf8').trim()]))))",
    ],
    { timeout: 5_000 }
  );
  return z.record(z.string(), z.string()).parse(JSON.parse(stdout));
}

test("the runtime requires authentication before accepting any calculation", async () => {
  const response = await fetch("http://127.0.0.1:18130/execute", {
    method: "POST",
    body: JSON.stringify(input),
  });
  expect(response.status).toBe(401);
});

const event = (value: string | undefined, name: string) =>
  Number(value?.match(new RegExp(`(?:^|\n)${name} (\\d+)`))?.[1]);

test("a huge computed value stays in the bounded capsule; the application survives and admission recovers", async () => {
  const container = "zoen-runtime-tests-semantic-1-1";
  const before = await capsuleMemory(container);
  expect(before["memory.max"]).toBe("1610612736");
  expect(before["memory.swap.max"]).toBe("0");
  const application = { pid: process.pid, rss: process.memoryUsage().rss };
  const started = performance.now();
  // Allocate the computed array inside SQL before text/JSON decoding. A single
  // large repeat also tests CPU-heavy conversion and can hit the deadline first.
  let failure: unknown;
  try {
    await executeSemanticSnapshot({
      ...input,
      query: "huge",
      model:
        "##! experimental.sql_functions\nsource: items is snapshot.table('public.items')\nquery: huge is items -> { select: value is sql_string('array_fill(0, ARRAY[160000000])::text') }",
      tables: [{ ...source, rows: [[1]] }],
    });
  } catch (error) {
    failure = error;
  }
  const elapsedMs = performance.now() - started;
  const after = await capsuleMemory(container);
  let recoveredResult: number | null = null;
  try {
    await expect
      .poll(() => executeSemanticSnapshot(input), { timeout: 10_000 })
      .toMatchObject({ rows: [{ total: 30 }] });
    recoveredResult = 30;
  } finally {
    // Persist the counter and error before assertions so CI retains evidence
    // when an OOM, deadline or recovery expectation fails.
    const { writeFile } = await import("node:fs/promises");
    await writeFile(
      "/tmp/zoen-semantic-memory-evidence.json",
      JSON.stringify(
        {
          before,
          after,
          elapsedMs,
          failure: failure instanceof Error ? failure.message : String(failure),
          applicationBefore: application,
          applicationAfter: {
            pid: process.pid,
            rss: process.memoryUsage().rss,
          },
          recoveredResult,
        },
        null,
        2
      )
    );
  }
  expect(failure).toBeInstanceOf(Error);
  expect(failure).toHaveProperty("message", "Semantic execution failed");
  expect(event(after["memory.events"], "oom_kill")).toBeGreaterThan(
    event(before["memory.events"], "oom_kill")
  );
  expect(process.pid).toBe(application.pid);
}, 30_000);
