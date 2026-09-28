import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { createHash, randomUUID } from "node:crypto";
import { cp, glob, mkdtemp, readFile, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { setTimeout as delay } from "node:timers/promises";
import { z } from "zod";
import { openMemoryEngine } from "../server/memory/ai-memory/engine";
import {
  noteTool,
  readNoteHistory,
  readNotes,
} from "../server/memory/ai-memory/notes";

// A disposable qualification of the upstream lifecycle, never a restore command
// for a user corpus. It intentionally uses no Zoen database or provider secrets.
const argument = process.argv[2];
assert(
  argument,
  "Usage: pnpm exec tsx scripts/ai-memory-lifecycle-acceptance.ts /absolute/path/to/ai-memory"
);
const binary = resolve(argument);
process.umask(0o077);
const root = await mkdtemp(join(tmpdir(), "zoen-memory-lifecycle-"));
const owner = randomUUID();
const corpus = join(root, owner, "learned-memory");
const backup = join(root, "snapshot.tar.gz");
const path = `notes/${randomUUID()}.md`;
const environment = {
  PATH: "/usr/bin:/bin",
  HOME: root,
  RUST_LOG: "error",
  NODE_ENV: "test",
} satisfies NodeJS.ProcessEnv;
const run = (data: string, ...args: string[]) =>
  execFileSync(
    binary,
    ["--data-dir", data, "--config", join(corpus, "config.toml"), ...args],
    {
      env: environment,
      encoding: "utf8",
      timeout: 30_000,
      stdio: ["ignore", "pipe", "pipe"],
    }
  );
let asOf: string;
let source: string;
let revision: string;
{
  await using engine = await openMemoryEngine(
    binary,
    root,
    owner,
    "learned-memory",
    { requireExisting: false }
  );
  await noteTool(engine, "memory_write_page", {
    path,
    body: "The reading club meets in Cedarbay.",
  });
  asOf = new Date().toISOString();
  await delay(20);
  await noteTool(engine, "memory_write_page", {
    path,
    body: "The reading club now meets in Ambertrail.",
  });
  const wiki = join(corpus, "wiki");
  const paths = await Array.fromAsync(glob(`*/*/${path}`, { cwd: wiki }));
  assert.equal(paths.length, 1);
  source = join(wiki, z.string().parse(paths[0]));
  revision = execFileSync("git", ["-C", wiki, "rev-parse", "HEAD"], {
    encoding: "utf8",
  }).trim();

  // Observe only our synthetic engine's authenticated public HTTP request. The
  // production adapter keeps its address/token private; no test-only export is added.
  const network = globalThis.fetch;
  let authority: { address: URL; headers: Headers } | undefined;
  globalThis.fetch = async (input, init) => {
    const address = new URL(
      input instanceof Request ? input.url : input.toString()
    );
    if (address.pathname === "/admin/commit") {
      assert.equal(address.hostname, "127.0.0.1");
      authority = { address, headers: new Headers(init?.headers) };
    }
    return network(input, init);
  };
  try {
    await engine.checkpoint();
  } finally {
    globalThis.fetch = network;
  }
  assert(
    authority,
    "The synthetic engine must expose its authenticated checkpoint request."
  );
  const response = await fetch(new URL("/admin/backup", authority.address), {
    method: "POST",
    headers: authority.headers,
    redirect: "error",
    signal: AbortSignal.timeout(30_000),
  });
  assert(response.ok, "Native backup must succeed.");
  assert.match(response.headers.get("content-type") ?? "", /application\/gzip/);
  const archive = Buffer.from(await response.arrayBuffer());
  assert(
    archive.length > 0 && archive.length < 16 * 1024 * 1024,
    "The synthetic snapshot must stay bounded."
  );
  await writeFile(backup, archive, { mode: 0o600, flag: "wx" });
  assert.throws(
    () => run(corpus, "restore", "--from", backup, "--force"),
    /other ai-memory process\(es\) running/
  );
  await noteTool(engine, "memory_write_page", {
    path,
    body: "The reading club moved again to Willowgate.",
  });
}

const database = join(corpus, "db", "memory.sqlite");
const digest = async (file: string) =>
  createHash("sha256")
    .update(await readFile(file))
    .digest("hex");
const original = {
  database: await digest(database),
  source: await digest(source),
};
const corrupt = join(root, "truncated.tar.gz");
const snapshot = await readFile(backup);
await writeFile(
  corrupt,
  snapshot.subarray(0, Math.floor(snapshot.length / 2)),
  { mode: 0o600 }
);
// v2.4.1 deletes an occupied target before validating the archive. Keep the
// original offline and restore ONLY to a new private quarantine directory.
assert.throws(() =>
  run(join(root, "rejected-restore"), "restore", "--from", corrupt)
);
assert.equal(
  await digest(database),
  original.database,
  "Failed restore must leave the database unchanged."
);
assert.equal(
  await digest(source),
  original.source,
  "Failed restore must leave source files unchanged."
);
const restoredOwner = randomUUID();
const restored = join(root, restoredOwner, "learned-memory");
run(restored, "restore", "--from", backup);
// Native unpack normalizes files to 0644 even under umask 0077. The quarantine
// stays private; remove group/other access before the Zoen adapter opens it.
execFileSync("chmod", ["-R", "go-rwx", restored]);
{
  await using engine = await openMemoryEngine(
    binary,
    root,
    restoredOwner,
    "learned-memory",
    { requireExisting: true }
  );
  assert.match(
    (await readNotes(engine)).results[0]?.memory ?? "",
    /Ambertrail/
  );
  assert.equal((await readNotes(engine, "Willowgate")).results.length, 0);
  const history = await readNoteHistory(engine, { query: "Cedarbay", asOf });
  assert.match(history.hits[0]?.excerpt ?? "", /Cedarbay/);
  execFileSync("git", [
    "-C",
    join(restored, "wiki"),
    "cat-file",
    "-e",
    `${revision}^{commit}`,
  ]);
}

// Reindex has a deliberately weaker contract: current Markdown can be rebuilt,
// but that must never be reported as restoration of earlier content versions.
const rebuiltOwner = randomUUID();
const rebuilt = join(root, rebuiltOwner, "learned-memory");
await cp(join(restored, "wiki"), join(rebuilt, "wiki"), { recursive: true });
await cp(join(restored, "config.toml"), join(rebuilt, "config.toml"));
execFileSync(
  binary,
  ["--data-dir", rebuilt, "--config", join(rebuilt, "config.toml"), "reindex"],
  {
    env: environment,
    timeout: 30_000,
    stdio: "pipe",
  }
);
{
  await using engine = await openMemoryEngine(
    binary,
    root,
    rebuiltOwner,
    "learned-memory",
    { requireExisting: true }
  );
  assert.match(
    (await readNotes(engine)).results[0]?.memory ?? "",
    /Ambertrail/
  );
  assert.equal(
    (await readNoteHistory(engine, { query: "Cedarbay", asOf })).hits.length,
    0
  );
}
assert.equal(await digest(database), original.database);
assert.equal(await digest(source), original.source);
const report = {
  version: "ai-memory 2.4.1",
  root,
  passed: [
    "live-snapshot",
    "restore-refuses-live-writer",
    "quarantined-corrupt-restore-preserves-original",
    "restore-current-content",
    "restore-historical-content",
    "restore-git-history",
    "reindex-current-content-only",
  ],
  blocked: ["v2.4.1-in-place-restore-removes-target-before-archive-validation"],
  pending: [
    "owner-bound-production-backups",
    "raw-session-and-PostgreSQL-coordination",
    "retention-and-erasure",
    "remote-volume-disaster-recovery",
    "capacity",
  ],
};
await writeFile(
  join(root, "report.json"),
  `${JSON.stringify(report, null, 2)}\n`,
  { mode: 0o600 }
);
process.stdout.write(`${JSON.stringify(report, null, 2)}\n`);
