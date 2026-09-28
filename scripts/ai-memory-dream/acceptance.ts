import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { glob, mkdtemp, readFile, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { setTimeout as delay } from "node:timers/promises";
import { z } from "zod";
import {
  dreamEngine,
  eventually,
  fixtureProvider,
  pages,
  scope,
  seed,
} from "./fixture";

// A native-engine qualification, not a user-data maintenance command. Every
// store and model response is synthetic; application environment is not inherited.
const argument = process.argv[2];
assert(argument, "Usage: pnpm test:memory:dream /absolute/path/to/ai-memory");
const binary = resolve(argument);
process.umask(0o077);
const root = await mkdtemp(join(tmpdir(), "zoen-memory-dream-"));
assert.equal(
  execFileSync(binary, ["--version"], {
    env: { PATH: "/usr/bin:/bin", HOME: root, NODE_ENV: "test" },
    encoding: "utf8",
    timeout: 10_000,
  }).trim(),
  "ai-memory 2.4.1",
  "Requalify dreams before upgrading the executable."
);
await using provider = await fixtureProvider();
const passed: string[] = [];
const blocked: string[] = [];
let completed = false;

async function sources(data: string) {
  const wiki = join(data, "wiki");
  const files = await Array.fromAsync(glob("*/*/notes/*.md", { cwd: wiki }));
  files.sort();
  return Object.fromEntries(
    await Promise.all(
      files.map(
        async (file) =>
          [file, await readFile(join(wiki, file), "utf8")] as const
      )
    )
  );
}

function git(data: string, ...args: string[]) {
  return execFileSync("git", ["-C", join(data, "wiki"), ...args], {
    encoding: "utf8",
    timeout: 10_000,
    env: { PATH: "/usr/bin:/bin", HOME: root, NODE_ENV: "test" },
  }).trim();
}

async function hits(
  engine: Awaited<ReturnType<typeof dreamEngine>>,
  args: Record<string, unknown>
) {
  const result = await engine.tool("memory_query", args);
  return z
    .object({ hits: z.array(z.record(z.string(), z.unknown())) })
    .parse(result).hits;
}

try {
  const data = join(root, "history");
  let original: Awaited<ReturnType<typeof sources>>;
  let revision: string;
  let asOf: string;
  {
    await using engine = await dreamEngine(binary, data, provider.url, false);
    await seed(engine);
    original = await sources(data);
    revision = git(data, "rev-parse", "HEAD");
    asOf = new Date().toISOString();
    await delay(6_000);
    assert.equal(provider.completions(), 0);
    assert.deepEqual(await sources(data), original);
    passed.push("flag-off-never-calls-merge-model");
  }
  provider.setMode("malformed");
  {
    await using engine = await dreamEngine(binary, data, provider.url, true);
    await eventually(
      () => engine.logs().includes("LLM merge failed"),
      "invalid structured merge rejected"
    );
    assert(provider.completions() > 0);
    assert.deepEqual(await sources(data), original);
    assert.equal(git(data, "rev-parse", "HEAD"), revision);
    passed.push("malformed-merge-preserves-all-pages");
  }
  provider.setMode("held");
  {
    const before = provider.completions();
    await using engine = await dreamEngine(binary, data, provider.url, true);
    await eventually(
      () => provider.completions() > before,
      "merge model request before forced process death"
    );
    await engine.kill();
    provider.release();
    assert.deepEqual(await sources(data), original);
    passed.push("death-before-model-response-preserves-sources");
  }
  provider.setMode("valid");
  {
    await using engine = await dreamEngine(binary, data, provider.url, false);
    assert.match(
      JSON.stringify(await hits(engine, { query: "Cedarbay" })),
      /Cedarbay/
    );
    assert.deepEqual(await sources(data), original);
    passed.push("restart-after-process-death-needs-no-forced-unlock");
  }
  let mergedRevision: string;
  {
    const before = provider.completions();
    await using engine = await dreamEngine(binary, data, provider.url, true);
    await eventually(
      () => engine.logs().includes("merged=1"),
      "native dream merge"
    );
    assert.equal(provider.completions() - before, 1);
    const after = await sources(data);
    const survivor = Object.entries(after).filter(([, body]) =>
      body.includes("merged_from:")
    );
    const stub = Object.entries(after).filter(([, body]) =>
      body.includes("merged_into:")
    );
    assert.equal(survivor.length, 1);
    assert.equal(stub.length, 1);
    assert.match(survivor[0]?.[1] ?? "", /Cedarbay.*notebook/);
    assert.match(stub[0]?.[1] ?? "", /compacted: true/);
    const noise = Object.keys(original).find((file) =>
      file.endsWith("synthetic-2.md")
    );
    assert(noise);
    assert.equal(after[noise], original[noise]);
    const checkpoint = await engine.admin("commit", {
      message: "Synthetic dream qualification",
    });
    assert.equal(checkpoint.committed, true);
    mergedRevision = z
      .string()
      .regex(/^[0-9a-f]{40}$/)
      .parse(checkpoint.oid);
    assert.notEqual(mergedRevision, revision);
    for (const [file, body] of Object.entries(original)) {
      assert.equal(git(data, "show", `${revision}:${file}`), body.trim());
    }
    passed.push(
      "merge-preserves-source-git-history-and-provenance",
      "unrelated-page-unchanged",
      "explicit-dream-git-checkpoint"
    );
  }
  {
    await using engine = await dreamEngine(binary, data, provider.url, false);
    assert.equal(git(data, "rev-parse", "HEAD"), mergedRevision);
    const historical = await hits(engine, {
      query: "Cedarbay",
      as_of: asOf,
      explain: true,
    });
    assert.equal(historical.length, 2);
    assert.doesNotMatch(
      JSON.stringify(historical),
      /Merged.*near-duplicate|graph_via/
    );
    assert.match(
      JSON.stringify(await hits(engine, { query: "Cedarbay" })),
      /notebook/
    );
    for (const index of [0, 1]) {
      const restored = await engine.admin("restore-page", {
        ...scope,
        path: `notes/synthetic-${index}.md`,
        rev: revision,
      });
      assert.equal(restored.restored_from, revision);
    }
    const restored = await sources(data);
    for (const [index, body] of pages.entries()) {
      const file = Object.keys(restored).find((key) =>
        key.endsWith(`synthetic-${index}.md`)
      );
      assert(file);
      const restoredBody = z.string().parse(restored[file]);
      assert(restoredBody.includes(body));
      assert.doesNotMatch(restoredBody, /merged_from:|merged_into:/);
    }
    passed.push(
      "as-of-before-dream-excludes-merged-content-after-restart",
      "public-restore-page-recovers-originals"
    );
  }
  {
    await using other = await dreamEngine(
      binary,
      join(root, "other-person"),
      provider.url,
      false
    );
    assert.deepEqual(
      await hits(other, { query: "Cedarbay", global: true }),
      []
    );
    passed.push("independent-corpus-cannot-recall-dream");
  }

  // Hold the first cluster while real MCP activity advances Akita's activity
  // clock. Two eligible clusters distinguish cancellation from simply finishing.
  const activity = join(root, "activity");
  {
    await using engine = await dreamEngine(
      binary,
      activity,
      provider.url,
      false
    );
    await seed(engine, [
      ...pages,
      "The walking club meets in Ambertrail.",
      "Bring a compass to the Ambertrail walking club.",
    ]);
  }
  provider.setMode("held");
  {
    const before = provider.completions();
    await using engine = await dreamEngine(
      binary,
      activity,
      provider.url,
      true
    );
    await eventually(
      () => provider.completions() > before,
      "first of two eligible clusters"
    );
    await engine.tool("memory_read_page", { path: "notes/synthetic-2.md" });
    await delay(2_200); // Native cancellation watcher samples every two seconds.
    provider.release();
    await eventually(
      () => engine.logs().includes("cancelled=true"),
      "activity cancels the next cluster"
    );
    assert.equal(provider.completions() - before, 1);
    assert.equal(
      Object.values(await sources(activity)).filter((body) =>
        body.includes("merged_from:")
      ).length,
      1
    );
    passed.push("resumed-mcp-activity-stops-before-next-cluster");
  }

  // Qualification probe: does a user edit made while the LLM is pending survive?
  // A known upstream failure is reported as blocked, never a green product claim.
  for (const mutation of ["edit", "delete"] as const) {
    const concurrent = join(root, `concurrent-${mutation}`);
    provider.setMode("valid");
    {
      await using engine = await dreamEngine(
        binary,
        concurrent,
        provider.url,
        false
      );
      await seed(engine);
    }
    provider.setMode("held");
    {
      const before = provider.completions();
      await using engine = await dreamEngine(
        binary,
        concurrent,
        provider.url,
        true
      );
      await eventually(
        () => provider.completions() > before,
        `held merge before concurrent ${mutation}`
      );
      for (const index of [0, 1]) {
        if (mutation === "delete") {
          const receipt = await engine.tool("memory_delete_page", {
            path: `notes/synthetic-${index}.md`,
          });
          assert.equal(receipt.deleted, true);
        } else {
          await engine.tool("memory_write_page", {
            path: `notes/synthetic-${index}.md`,
            body: "The club moved to Newhaven. Preserve this later user correction.",
            tier: "episodic",
          });
        }
      }
      const correctionAsOf = new Date().toISOString();
      await delay(2_200);
      provider.release();
      await eventually(
        () => engine.logs().includes("dream pass tick completed"),
        "concurrent edit probe settles"
      );
      const current = JSON.stringify(await sources(concurrent));
      if (mutation === "delete") {
        if (Object.keys(await sources(concurrent)).length === 1) {
          passed.push("deleted-pages-stay-deleted-after-in-flight-merge");
        } else {
          assert.match(current, /Cedarbay/);
          blocked.push("v2.4.1-in-flight-dream-recreates-deleted-pages");
        }
      } else if (current.includes("Newhaven")) {
        passed.push("concurrent-correction-survives-in-flight-merge");
      } else {
        assert.match(
          JSON.stringify(
            await hits(engine, {
              query: "Newhaven",
              as_of: correctionAsOf,
            })
          ),
          /Newhaven/
        );
        blocked.push("v2.4.1-in-flight-dream-overwrites-later-user-edit");
      }
    }
  }
  assert.deepEqual(
    provider.errors,
    [],
    "Every synthetic provider request must conform to the qualified protocol."
  );
  completed = true;
} finally {
  provider.release();
  await writeFile(
    join(root, "provider-requests.json"),
    `${JSON.stringify(provider.calls, null, 2)}\n`,
    { mode: 0o600 }
  );
  const report = {
    version: "ai-memory 2.4.1",
    status: completed ? "completed" : "failed",
    root,
    passed,
    blocked,
    pending: [
      "production-owner-opt-in-and-model-controls",
      "observable-proposals-and-revision-checked-apply",
      "real-provider-quality-and-cost",
      "interrupted-apply-and-erasure-races",
      "namespace-authorized-scheduler",
      "capacity",
    ],
  };
  await writeFile(
    join(root, "report.json"),
    `${JSON.stringify(report, null, 2)}\n`,
    { mode: 0o600 }
  );
  process.stdout.write(`${JSON.stringify(report, null, 2)}\n`);
}
