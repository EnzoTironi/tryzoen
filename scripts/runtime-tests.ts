import { spawnSync } from "node:child_process";
import { mkdtempSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { parseEnv } from "node:util";
import { fileURLToPath } from "node:url";
import { prepareRuntimePayloads } from "./runtime-payloads";

const root = fileURLToPath(new URL("../", import.meta.url));
const command = process.argv[2] ?? "up";
const compose = [
  "compose",
  "--profile",
  "semantic",
  "-p",
  "zoen-runtime-tests",
  "-f",
  "tests/runtime/compose.yaml",
];
const fixture = parseEnv(
  readFileSync(
    new URL("../tests/runtime/.env.example", import.meta.url),
    "utf8"
  )
);
// oxlint-disable-next-line eslint/no-restricted-properties
const inheritedEnvironment = { ...process.env };
// Setup tools inherit PATH; connection values always come from the synthetic fixture.
const environment = { ...inheritedEnvironment, ...fixture };

function run(program: string, args: string[], env = environment) {
  const result = spawnSync(program, args, { cwd: root, env, stdio: "inherit" });
  if (result.error) throw result.error;
  if (result.status !== 0)
    throw new Error(`${program} failed with status ${String(result.status)}.`);
}

if (["--help", "-h", "help"].includes(command)) {
  console.log(`Manage Zoen's isolated PostgreSQL and Matrix test services.

  pnpm test:runtime:setup     Start services and apply both migration chains
  pnpm test:runtime           Run the complete runtime suite, including backup restore
  pnpm test:runtime --shard=1/4 --reporter=default --reporter=json --outputFile=report.json
                             Forward Vitest options for an isolated CI shard
  pnpm test:runtime:reset     Delete this test project's volumes and recreate them
  pnpm test:runtime:down      Stop this test project, retaining its disposable volumes

Requires Docker Compose and Node 24. Uses loopback ports 15432, 18008, 18130, 18131 and 19480.
The reset command deletes only the zoen-runtime-tests Compose project's data.`);
} else if (command === "down") {
  run("docker", [...compose, "down"]);
} else if (command === "run") {
  const archiveRoot = mkdtempSync(join(tmpdir(), "zoen-k3-runtime-"));
  const runtimeEnvironment = {
    ...environment,
    ZOEN_SESSION_ARCHIVE_DIR: archiveRoot,
  };
  try {
    run(
      "pnpm",
      ["--filter", "@zoen/companion-ui", "build:ui"],
      runtimeEnvironment
    );
    run("pnpm", ["build:semantic"], runtimeEnvironment);
    run(
      process.execPath,
      [
        "--env-file=tests/runtime/.env.example",
        "node_modules/vitest/vitest.mjs",
        "run",
        "--config",
        "vitest.runtime.config.ts",
        ...process.argv.slice(3),
      ],
      runtimeEnvironment
    );
  } finally {
    rmSync(archiveRoot, { recursive: true, force: true, maxRetries: 3 });
  }
} else if (command === "up" || command === "reset") {
  if (command === "reset") run("docker", [...compose, "down", "--volumes"]);
  run("pnpm", ["--filter", "@zoen/companion-ui", "build:ui"]);
  run("pnpm", ["build:semantic"]);
  run("docker", [
    ...compose,
    "up",
    "--build",
    "--detach",
    "--wait",
    "--wait-timeout",
    "120",
  ]);
  await prepareRuntimePayloads();
  run(process.execPath, [
    "--import",
    "tsx",
    "--input-type=module",
    "-e",
    "import { migrateApplication } from './server/database/migrations.ts'; console.log(JSON.stringify(await migrateApplication(process.env.DATABASE_URL_UNPOOLED)));",
  ]);
  run(
    process.execPath,
    ["node_modules/@workflow/world-postgres/bin/setup.js"],
    {
      ...environment,
      WORKFLOW_POSTGRES_URL: fixture.DATABASE_URL_UNPOOLED,
    }
  );
  run(process.execPath, ["--import", "tsx", "scripts/mastra-pilot-setup.ts"]);
  run("docker", [
    ...compose,
    "exec",
    "-T",
    "postgres",
    "bash",
    "/docker-entrypoint-initdb.d/application.sh",
  ]);
  console.log(
    "Runtime test services and migrations are ready. Run pnpm test:runtime."
  );
} else {
  throw new Error(`Unknown command ${command}. Use --help.`);
}
