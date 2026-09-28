import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { v5 as uuidv5 } from "uuid";
import { openMemoryEngine } from "../server/memory/ai-memory/engine";
import { ingestSessionSource } from "../server/memory/ai-memory/session-ingestion";
import {
  sessionSourceSchema,
  sessionSourceSegments,
  writeSessionSource,
  eraseSessionSources,
} from "../server/memory/session-files";
import { execFileSync, spawn } from "node:child_process";
import { once } from "node:events";
import { setTimeout as delay } from "node:timers/promises";
import { pathToFileURL } from "node:url";
import { glob, mkdtemp, mkdir, readFile, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { StdioClientTransport } from "@modelcontextprotocol/sdk/client/stdio.js";
import { z } from "zod";

// Run only against a verified upstream executable. No user stores, hooks, model
// credentials or Zoen database are used; retain the synthetic files for inspection.
const binaryArgument = process.argv[2];
assert(
  binaryArgument,
  "Usage: pnpm exec tsx scripts/ai-memory-acceptance.ts /absolute/path/to/ai-memory"
);
const binary = resolve(binaryArgument);
const version = execFileSync(binary, ["--version"], {
  encoding: "utf8",
}).trim();
assert.equal(
  version,
  "ai-memory 2.4.1",
  "Requalify the contract before changing the engine version."
);
const directory = await mkdtemp(join(tmpdir(), "zoen-ai-memory-acceptance-"));
const scope = { workspace: "synthetic-review", project: "personal" };

async function openEngine(name: string) {
  const data = join(directory, name);
  await mkdir(data, { recursive: true });
  const config = join(data, "config.toml");
  await writeFile(
    config,
    'embedding_provider = "none"\n[dream]\nenabled = false\n',
    { mode: 0o600 }
  );
  const transport = new StdioClientTransport({
    command: binary,
    args: [
      "--data-dir",
      data,
      "--config",
      config,
      "serve",
      "--transport",
      "stdio",
    ],
    // SDK defaults pass only its OS allowlist, not application/provider secrets.
    env: {},
    cwd: directory,
    stderr: "pipe",
  });
  let diagnostics = "";
  transport.stderr?.on("data", (chunk: Buffer) => {
    diagnostics = (diagnostics + chunk.toString()).slice(-8192);
  });
  const client = new Client({
    name: "zoen-memory-acceptance",
    version: "1.0.0",
  });
  try {
    await client.connect(transport, { timeout: 20_000 });
  } catch (error) {
    await client.close();
    throw new Error(`Memory engine failed to start: ${diagnostics}`, {
      cause: error,
    });
  }
  return {
    client,
    data,
    [Symbol.asyncDispose]: () => client.close(),
  };
}

async function call(
  client: Client,
  name: string,
  args: Record<string, unknown>
) {
  const result = await client.callTool({ name, arguments: args }, undefined, {
    timeout: 20_000,
  });
  assert(!result.isError, `${name} failed: ${JSON.stringify(result)}`);
  const content = z
    .array(z.object({ type: z.literal("text"), text: z.string() }))
    .parse(result.content);
  return z
    .record(z.string(), z.unknown())
    .parse(JSON.parse(content.map((block) => block.text).join("\n")));
}

async function search(client: Client, args: Record<string, unknown>) {
  const result = await call(client, "memory_query", args);
  // Assert actual result rows, not echoed query text or transport envelopes.
  const parsed = z
    .object({
      hits: z.array(z.record(z.string(), z.unknown())),
      global_hits: z.array(z.record(z.string(), z.unknown())).optional(),
    })
    .parse(result);
  return JSON.stringify([...parsed.hits, ...(parsed.global_hits ?? [])]);
}

let asOf: string;
{
  await using engine = await openEngine("person-a");
  await call(engine.client, "memory_write_page", {
    ...scope,
    path: "notes/reading.md",
    body: "# Reading\nThe synthetic reading club meets at Blueharbor.",
    tags: ["blueharbor"],
  });
  asOf = new Date().toISOString();
  await new Promise((done) => setTimeout(done, 20));
  await call(engine.client, "memory_write_page", {
    ...scope,
    path: "notes/reading.md",
    body: "# Reading\nThe synthetic reading club now meets at Ambertrail.",
    tags: ["ambertrail"],
  });
  const current = await search(engine.client, {
    ...scope,
    query: "Ambertrail",
    explain: true,
  });
  assert.match(current, /Ambertrail/);
  assert.equal(
    await search(engine.client, { ...scope, query: "Blueharbor" }),
    "[]"
  );
  const historical = await search(engine.client, {
    ...scope,
    query: "Blueharbor",
    as_of: asOf,
    explain: true,
  });
  assert.match(historical, /Blueharbor/);
  assert.doesNotMatch(historical, /Ambertrail/);
  const wiki = join(engine.data, "wiki");
  const files = await Array.fromAsync(glob("**/*.md", { cwd: wiki }));
  const relative = files.find((file) => file.endsWith("/notes/reading.md"));
  assert(relative, "The authoritative Markdown must exist on disk.");
  const page = join(wiki, relative);
  assert.match(await readFile(page, "utf8"), /Ambertrail/);
  const revisions = execFileSync(
    "git",
    ["-C", wiki, "log", "--format=%H", "--", page],
    { encoding: "utf8" }
  )
    .trim()
    .split("\n");
  assert(revisions.length >= 2, "Both writes must be Git-versioned.");

  // Upstream's MCP write tool does not expose relation metadata. Exercise its
  // supported human-editable Markdown + watcher path, not a made-up API field.
  for (const relation of ["causes", "fixes", "contradicts"]) {
    const path = `notes/${relation}.md`;
    await call(engine.client, "memory_write_page", {
      ...scope,
      path,
      body: `# ${relation}\nSynthetic relationship evidence.`,
    });
    const file = join(page.slice(0, -"notes/reading.md".length), path);
    const markdown = await readFile(file, "utf8");
    await writeFile(
      file,
      markdown.replace(
        /^---\n/,
        `---\nrelations:\n  ${relation}: ["notes/reading.md"]\n`
      )
    );
  }
  const deadline = Date.now() + 15_000;
  let graph = "";
  do {
    graph = await search(engine.client, {
      ...scope,
      query: "Ambertrail",
      explain: true,
    });
    if (
      ["causes", "fixes", "contradicts"].every((edge) =>
        graph.includes(`"edge":"${edge}"`)
      )
    )
      break;
    await new Promise((done) => setTimeout(done, 250));
  } while (Date.now() < deadline);
  for (const edge of ["causes", "fixes", "contradicts"]) {
    assert(
      graph.includes(`"edge":"${edge}"`),
      `Missing typed graph relation: ${edge}`
    );
  }
  const audit = await search(engine.client, {
    ...scope,
    query: "Blueharbor",
    as_of: asOf,
    explain: true,
  });
  assert.doesNotMatch(
    audit,
    /graph_via/,
    "Historical retrieval must not mix in present-day graph edges."
  );
}
{
  await using restarted = await openEngine("person-a");
  assert.match(
    await search(restarted.client, {
      ...scope,
      query: "Blueharbor",
      as_of: asOf,
    }),
    /Blueharbor/
  );
  assert.match(
    await search(restarted.client, { ...scope, query: "Ambertrail" }),
    /Ambertrail/
  );
}
{
  await using other = await openEngine("person-b");
  assert.equal(
    await search(other.client, { query: "Ambertrail", global: true }),
    "[]"
  );
}
const owner = randomUUID();
const source = sessionSourceSchema.parse({
  version: 2,
  source: "eve",
  sessionId: "synthetic-eve-session",
  eventId: "evt-user",
  occurredAt: "2026-09-28T12:00:00.000Z",
  kind: "message.received",
  turnId: "turn-1",
  sequence: 0,
  stepIndex: null,
  role: "user",
  settlement: null,
  text: `The synthetic club meets at Cedarfield. ${"More synthetic transcript context. ".repeat(4500)} LastwordOrchid.`,
});
const assistant = sessionSourceSchema.parse({
  ...source,
  eventId: "evt-assistant",
  kind: "message.completed",
  sequence: 1,
  stepIndex: 0,
  role: "assistant",
  settlement: "unverified",
  text: "Abandoned attempt claims Prismvale.",
});
const acceptedAssistant = sessionSourceSchema.parse({
  ...assistant,
  eventId: "evt-assistant-settled",
  occurredAt: null,
  kind: "message.settled",
  settlement: "accepted",
  text: "Accepted final reply names Cedarfield and Bluefern.",
});
const boundary = sessionSourceSchema.parse({
  ...source,
  eventId: "evt-end",
  kind: "turn.completed",
  sequence: null,
  role: null,
  text: null,
});
const memoryScope = { workspace: "zoen", project: "private" };
const memorySession = uuidv5(
  JSON.stringify([source.sessionId, source.turnId]),
  owner
);
const sourcePath = await writeSessionSource(directory, owner, source, 1);
await writeSessionSource(directory, owner, assistant, 2);
await writeSessionSource(directory, owner, boundary, 3);
const acceptedPath = await writeSessionSource(
  directory,
  owner,
  acceptedAssistant,
  4
);
{
  await using engine = await openMemoryEngine(
    binary,
    directory,
    owner,
    "ai-memory",
    { requireExisting: false }
  );
  const network = globalThis.fetch;
  let deliveredBatches = 0;
  globalThis.fetch = async (input, init) => {
    const response = await network(input, init);
    const url = input instanceof Request ? input.url : input.toString();
    if (url.endsWith("/hook/batch") && ++deliveredBatches === 2)
      throw new TypeError(
        "Synthetic acknowledgement loss after a partial source delivery."
      );
    return response;
  };
  try {
    await assert.rejects(
      ingestSessionSource(engine, owner, source),
      /Synthetic acknowledgement loss/
    );
  } finally {
    globalThis.fetch = network;
  }
}
{
  await using engine = await openMemoryEngine(
    binary,
    directory,
    owner,
    "ai-memory",
    { requireExisting: true }
  );
  await ingestSessionSource(engine, owner, source);
  await ingestSessionSource(engine, owner, assistant);
  await ingestSessionSource(engine, owner, acceptedAssistant);
  await ingestSessionSource(engine, owner, boundary);
}
{
  await using engine = await openMemoryEngine(
    binary,
    directory,
    owner,
    "ai-memory",
    { requireExisting: true }
  );
  // Model the acknowledgement being lost after delivery: replay the same source
  // and close marker after a process restart, not just the same HTTP connection.
  await ingestSessionSource(engine, owner, source);
  await ingestSessionSource(engine, owner, boundary);
  const observations = await call(
    engine.client,
    "memory_read_session_observations",
    {
      ...memoryScope,
      session_id: memorySession,
      limit: 200,
      body_max_chars: 16384,
    }
  );
  const parsed = z
    .object({
      total: z.number(),
      session: z.object({
        started_at: z.iso.datetime({ offset: true }),
        ended_at: z.iso.datetime({ offset: true }),
      }),
      observations: z.array(
        z.object({
          kind: z.string(),
          extension: z.string().nullable(),
          source_event: z.string().nullable(),
          body: z.string(),
        })
      ),
    })
    .parse(observations);
  assert(
    Date.parse(parsed.session.started_at) <=
      Date.parse(parsed.session.ended_at),
    "Source session times must preserve event order, not delivery time."
  );
  assert.equal(
    parsed.total,
    sessionSourceSegments(source).length + 2,
    "Replay must not duplicate start, source segments or end."
  );
  assert.match(JSON.stringify(parsed), /LastwordOrchid/);
  assert.doesNotMatch(JSON.stringify(parsed), /Prismvale/);
  assert.doesNotMatch(JSON.stringify(parsed), /Bluefern/);
  assert(parsed.observations.every((item) => item.extension === "eve"));
  const page = await call(engine.client, "memory_read_page", {
    ...memoryScope,
    path: `sessions/${memorySession}.md`,
  });
  assert.match(JSON.stringify(page), /Cedarfield/);
  const wiki = join(directory, owner, "ai-memory/wiki");
  const files = await Array.fromAsync(
    glob(`**/sessions/${memorySession}.md`, { cwd: wiki })
  );
  assert.equal(files.length, 1);
  const [file] = files;
  assert(file);
  assert.match(await readFile(join(wiki, file), "utf8"), /message.received/);
  assert(
    execFileSync("git", ["-C", wiki, "log", "-1", "--format=%H", "--", file], {
      encoding: "utf8",
    }).trim(),
    "Consolidated Markdown must be committed."
  );
}
assert.match(await readFile(acceptedPath, "utf8"), /Bluefern/);
const otherOwner = randomUUID();
{
  await using other = await openMemoryEngine(
    binary,
    directory,
    otherOwner,
    "ai-memory",
    { requireExisting: false }
  );
  assert.equal(
    await search(other.client, { query: "Cedarfield", global: true }),
    "[]"
  );
}

// Terminate the real application owner, not the engine or a mocked cleanup hook.
// Its separate supervisor must release the upstream single-writer lock so a new
// worker can resume the same private directory without force-unlocking it.
const crashOwner = randomUUID();
const crashedWorker = spawn(
  process.execPath,
  [
    "--import",
    "tsx",
    "--input-type=module",
    "--eval",
    String.raw`
      const [module, binary, root, owner] = process.argv.slice(1);
      const { openMemoryEngine } = await import(module);
      const engine = await openMemoryEngine(binary, root, owner, "ai-memory", { requireExisting: false });
      const result = await engine.client.callTool({
        name: 'memory_write_page',
        arguments: {
          workspace: 'zoen', project: 'private', path: 'notes/crash.md',
          body: '# Crash recovery\nThe synthetic signal is Willowgate.'
        }
      });
      if (result.isError) throw new Error('Synthetic pre-crash write failed.');
      process.send({ ready: true });
      await new Promise(() => {});
    `,
    "--",
    pathToFileURL(resolve("server/memory/ai-memory/engine.ts")).href,
    binary,
    directory,
    crashOwner,
  ],
  { stdio: ["ignore", "ignore", "pipe", "ipc"] }
);
const crashedExit = once(crashedWorker, "exit");
let crashDiagnostics = "";
crashedWorker.stderr?.on("data", (chunk: Buffer) => {
  crashDiagnostics = (crashDiagnostics + chunk.toString()).slice(-8192);
});
try {
  const ready: unknown = await Promise.race([
    once(crashedWorker, "message", { signal: AbortSignal.timeout(30_000) }),
    crashedExit.then(() => {
      throw new Error(`Synthetic worker exited: ${crashDiagnostics}`);
    }),
  ]);
  assert.deepEqual(ready, [{ ready: true }, undefined]);
  await assert.rejects(
    openMemoryEngine(binary, directory, crashOwner, "ai-memory", {
      requireExisting: true,
    }),
    /exited before readiness/,
    "A second writer must remain excluded before the crash."
  );
  crashedWorker.kill("SIGKILL");
  await crashedExit;
  await delay(2_000);
  await using resumed = await openMemoryEngine(
    binary,
    directory,
    crashOwner,
    "ai-memory",
    { requireExisting: true }
  );
  assert.match(
    await search(resumed.client, { ...memoryScope, query: "Willowgate" }),
    /Willowgate/
  );
} finally {
  if (crashedWorker.exitCode === null && crashedWorker.signalCode === null)
    crashedWorker.kill("SIGKILL");
  await crashedExit;
}
const raw = (await readFile(sourcePath, "utf8")).trimEnd().split("\n");
assert.equal(
  raw.map((line) => sessionSourceSchema.parse(JSON.parse(line)).text).join(""),
  source.text
);
await eraseSessionSources(directory, owner);
await assert.rejects(readFile(sourcePath), { code: "ENOENT" });
await assert.rejects(
  readFile(join(directory, owner, "ai-memory/config.toml")),
  { code: "ENOENT" }
);
assert(
  await readFile(join(directory, otherOwner, "ai-memory/config.toml"), "utf8")
);
const report = {
  version,
  directory,
  passed: [
    "markdown-on-disk",
    "git-version-history",
    "ingestion-time-as-of",
    "latest-excludes-superseded",
    "typed-relations",
    "as-of-excludes-current-graph",
    "restart-recall",
    "separate-data-directory-isolation",
    "Eve-source-segmentation",
    "generic-batch-ingestion-provenance",
    "restart-and-lost-acknowledgement-deduplication",
    "partial-source-delivery-resumes",
    "session-to-versioned-markdown",
    "unsettled-assistant-excluded",
    "accepted-assistant-archived-without-unsupported-ingestion",
    "source-and-derived-memory-erasure",
    "owner-crash-releases-writer-and-preserves-recall",
  ],
  pending: [
    "accepted-intermediate-history-and-upstream-assistant-ingestion",
    "dream-consolidation",
    "Zoen-authorization",
    "capacity",
  ],
};
await writeFile(
  join(directory, "report.json"),
  `${JSON.stringify(report, null, 2)}\n`
);
process.stdout.write(`${JSON.stringify(report, null, 2)}\n`);
