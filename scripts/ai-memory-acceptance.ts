import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
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
  ],
  pending: [
    "Eve-session-capture",
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
