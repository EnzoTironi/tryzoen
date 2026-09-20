import { spawnSync } from "node:child_process";
import { readFileSync } from "node:fs";
import { parseEnv } from "node:util";
import { fileURLToPath } from "node:url";

const root = fileURLToPath(new URL("../", import.meta.url));
const command = process.argv[2] ?? "up";
const compose = [
  "compose",
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
// Child tools inherit PATH; connection values always come from the checked-in synthetic fixture.
// oxlint-disable-next-line eslint/no-restricted-properties
const environment = { ...process.env, ...fixture };

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
  pnpm test:runtime:reset     Delete this test project's volumes and recreate them
  pnpm test:runtime:down      Stop this test project, retaining its disposable volumes

Requires Docker Compose and Node 24. Uses only loopback ports 15432 and 18008.
The reset command deletes only the zoen-runtime-tests Compose project's data.`);
} else if (command === "down") {
  run("docker", [...compose, "down"]);
} else if (command === "up" || command === "reset") {
  if (command === "reset") run("docker", [...compose, "down", "--volumes"]);
  run("docker", [
    ...compose,
    "up",
    "--detach",
    "--wait",
    "--wait-timeout",
    "120",
  ]);
  run(process.execPath, [
    "node_modules/drizzle-kit/bin.cjs",
    "migrate",
    "--config",
    "db/drizzle.config.ts",
  ]);
  run(
    process.execPath,
    ["node_modules/@workflow/world-postgres/bin/setup.js"],
    {
      ...environment,
      WORKFLOW_POSTGRES_URL: fixture.DATABASE_URL_UNPOOLED,
    }
  );
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
