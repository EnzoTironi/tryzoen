import { spawnSync } from "node:child_process";
import { randomUUID } from "node:crypto";
import {
  mkdir,
  mkdtemp,
  readFile,
  rm,
  symlink,
  writeFile,
} from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { parseEnv } from "node:util";
import { fileURLToPath } from "node:url";
import { Client } from "pg";
import { drizzle } from "drizzle-orm/node-postgres";
import { migrate } from "drizzle-orm/node-postgres/migrator";
import { z } from "zod";
import { prepareRuntimePayloads } from "./runtime-payloads";

const root = fileURLToPath(new URL("../", import.meta.url));
const mode = z
  .enum(["cutover", "foundation", "collection", "restore"])
  .parse(process.argv[2] ?? "cutover");
const project = "zoen-payload-cutover-" + randomUUID().slice(0, 8);
const temporary = await mkdtemp(join(tmpdir(), "zoen-k3-cutover-"));
const fixture = parseEnv(
  await readFile(
    new URL("../tests/runtime/.env.example", import.meta.url),
    "utf8"
  )
);
// oxlint-disable-next-line eslint/no-restricted-properties -- Child setup values are overridden by the synthetic installation.
const inheritedEnvironment = { ...process.env };
const environment = {
  ...inheritedEnvironment,
  ...fixture,
  ZOEN_SESSION_ARCHIVE_DIR: temporary,
  CODEX_HOME: join(temporary, "empty-model-auth"),
  ZOEN_ERASURE_JOURNAL_BUCKET: "synthetic-erasure-cutover",
  ZOEN_RESTORE_TEST_CONTAINER: project + "-postgres-1",
};
const compose = ["compose", "-p", project, "-f", "tests/runtime/compose.yaml"];
const reportPath = join(root, `.eve/runtime-reports/payload-${mode}.json`);

function run(program: string, args: string[]) {
  const result = spawnSync(program, args, {
    cwd: root,
    env: environment,
    stdio: "inherit",
    timeout: 300_000,
  });
  if (result.error) throw result.error;
  if (result.status !== 0)
    throw new Error(`${program} failed with status ${String(result.status)}`);
}

try {
  await mkdir(environment.CODEX_HOME, { mode: 0o700 });
  await mkdir(join(root, ".eve/runtime-reports"), { recursive: true });
  await rm(reportPath, { force: true });
  run("docker", [
    ...compose,
    "up",
    "--detach",
    "--wait",
    "--wait-timeout",
    "90",
    "postgres",
    "payloads",
  ]);
  await prepareRuntimePayloads("synthetic-erasure-cutover");
  if (mode === "cutover") {
    const journal = z
      .looseObject({
        entries: z.array(
          z.looseObject({ idx: z.number().int(), tag: z.string() })
        ),
      })
      .parse(
        JSON.parse(
          await readFile(join(root, "db/migrations/meta/_journal.json"), "utf8")
        )
      );
    const entries = journal.entries.slice(0, 108);
    if (entries.at(-1)?.tag !== "0107_matrix-contribution-receipts")
      throw new Error("Missing unchanged legacy migration baseline");
    const baseline = join(temporary, "baseline");
    await mkdir(join(baseline, "meta"), { recursive: true });
    await writeFile(
      join(baseline, "meta/_journal.json"),
      JSON.stringify({ ...journal, entries })
    );
    for (const entry of entries)
      await symlink(
        join(root, "db/migrations", entry.tag + ".sql"),
        join(baseline, entry.tag + ".sql")
      );
    const connection = new Client({
      connectionString: fixture.DATABASE_URL_UNPOOLED,
      connectionTimeoutMillis: 5000,
    });
    try {
      await connection.connect();
      await migrate(drizzle(connection), { migrationsFolder: baseline });
    } finally {
      await connection.end();
    }
  } else {
    run(process.execPath, [
      "--import",
      "tsx",
      "--input-type=module",
      "-e",
      "import { migrateApplication } from './server/database/migrations.ts'; console.log(JSON.stringify(await migrateApplication(process.env.DATABASE_URL_UNPOOLED)));",
    ]);
  }
  run("docker", [
    ...compose,
    "exec",
    "-T",
    "postgres",
    "bash",
    "/docker-entrypoint-initdb.d/application.sh",
  ]);
  run("pnpm", ["--filter", "@zoen/companion-ui", "build:ui"]);
  const config = mode === "foundation" ? "publication" : `payload-${mode}`;
  run(process.execPath, [
    "node_modules/vitest/vitest.mjs",
    "run",
    "--config",
    `scripts/verification/${config}.config.ts`,
    "--reporter=default",
    "--reporter=json",
    "--outputFile=" + reportPath,
  ]);
  const expected =
    mode === "cutover" || mode === "restore"
      ? 1
      : mode === "foundation"
        ? 6
        : 21;
  z.object({
    success: z.literal(true),
    numPassedTests: z.literal(expected),
    numFailedTests: z.literal(0),
    numPendingTests: z.literal(0),
    numTodoTests: z.literal(0),
  }).parse(JSON.parse(await readFile(reportPath, "utf8")));
  console.log(
    `The native payload ${mode} passed ${expected} cases with no skips.`
  );
} finally {
  try {
    run("docker", [...compose, "down", "--volumes"]);
  } finally {
    await rm(temporary, { recursive: true, force: true });
  }
}
