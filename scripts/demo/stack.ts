import { spawn } from "node:child_process";
import {
  chmod,
  copyFile,
  mkdir,
  readFile,
  readdir,
  writeFile,
} from "node:fs/promises";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { parseArgs } from "node:util";
import { parse, stringify } from "yaml";
import { z } from "zod";

export const DEMO_STATE_DIRECTORY =
  "/Users/enzotironi/Documents/Codex/2026-09-30/task-10/demo-state";
export const DEMO_PORTS = {
  web: 4397,
  eve: 9497,
  postgres: 15439,
  matrix: 18039,
  semantic: 18139,
} as const;
export const DEMO_DATABASE = "companion_investor_demo";
export const DEMO_MATRIX_SERVER = "zoen-investor-demo.test";
const project = "zoen-investor-demo";
const root = fileURLToPath(new URL("../../", import.meta.url));
const assignedRoot =
  "/Users/enzotironi/Documents/Codex/2026-09-30/task-12/worktrees/demo";
const composePath = join(DEMO_STATE_DIRECTORY, "compose.yaml");
const localNode =
  "/Users/enzotironi/.local/share/mise/installs/node/24.21.0/bin/node";

// Validate only the fields this launcher changes; preserve the pinned source configuration.
const serviceSchema = z.looseObject({
  image: z.string(),
  ports: z.array(z.string()),
});
const composeSchema = z.looseObject({
  name: z.string(),
  services: z.looseObject({
    postgres: serviceSchema.extend({
      environment: z.looseObject({ POSTGRES_DB: z.string() }),
      volumes: z.array(z.string()),
      healthcheck: z.looseObject({ test: z.array(z.string()) }),
    }),
    matrix: serviceSchema.extend({ volumes: z.array(z.string()) }),
    "semantic-1": serviceSchema.extend({
      profiles: z.array(z.string()).optional(),
      build: z.looseObject({ context: z.string() }),
      restart: z.string(),
    }),
    "semantic-2": z.unknown().optional(),
  }),
});
const registrationSchema = z.looseObject({
  url: z.string(),
  namespaces: z.looseObject({
    users: z.array(z.looseObject({ regex: z.string() })),
    aliases: z.array(z.looseObject({ regex: z.string() })),
  }),
});

// These values already belong to the repository's disposable runtime fixture.
// They identify this loopback-only installation; they are not production secrets.
const fixture = {
  NODE_ENV: "production",
  DATABASE_URL:
    "postgresql://zoen_app:synthetic-runtime@127.0.0.1:15439/companion_investor_demo",
  DATABASE_URL_UNPOOLED:
    "postgresql://zoen_migrator:synthetic-migrator@127.0.0.1:15439/companion_investor_demo",
  WORKFLOW_POSTGRES_URL:
    "postgresql://zoen_app:synthetic-runtime@127.0.0.1:15439/companion_investor_demo",
  BETTER_AUTH_URL: "http://127.0.0.1:4397",
  BETTER_AUTH_SECRET: "zoen-isolated-auth-test-secret-0123456789",
  SECRET_ENCRYPTION_KEY: "AQEBAQEBAQEBAQEBAQEBAQEBAQEBAQEBAQEBAQEBAQE=",
  HOST: "127.0.0.1",
  NITRO_HOST: "127.0.0.1",
  PORT: "4397",
  EVE_NEXT_PRODUCTION_PORT: "9497",
  WORKFLOW_LOCAL_BASE_URL: "http://127.0.0.1:9497",
  WORKFLOW_MAX_INLINE_STEPS: "0",
  WORKFLOW_POSTGRES_WORKER_CONCURRENCY: "1",
  WORKFLOW_POSTGRES_MAX_POOL_SIZE: "4",
  COMPANION_MODEL_PROVIDER: "codex-local",
  COMPANION_CODEX_MODEL: "gpt-5.6-luna",
  ZOEN_MATRIX_URL: "http://127.0.0.1:18039",
  ZOEN_MATRIX_NATIVE_NOTIFICATIONS: "true",
  ZOEN_MATRIX_SERVER_NAME: DEMO_MATRIX_SERVER,
  ZOEN_MATRIX_AS_TOKEN: "zoen-eve-synthetic-application-service-token",
  ZOEN_MATRIX_HS_TOKEN: "zoen-eve-synthetic-homeserver-token",
  ZOEN_SEMANTIC_URLS: "http://127.0.0.1:18139/",
  ZOEN_SEMANTIC_TOKEN: "zoen-semantic-synthetic-test-token-0123456789",
  ZOEN_SESSION_ARCHIVE_DIR: join(DEMO_STATE_DIRECTORY, "session-archives"),
};

/** Provider keys, DATABASE_URL and Node injection options are never inherited. */
export function demoEnvironment(): NodeJS.ProcessEnv {
  const environment: NodeJS.ProcessEnv = { NODE_ENV: "production" };
  for (const name of [
    "HOME",
    "PATH",
    "TMPDIR",
    "USER",
    "LOGNAME",
    "LANG",
    "LC_ALL",
    "SHELL",
    "TERM",
  ]) {
    // The launcher's allowlist preserves the existing local Codex login only.
    // oxlint-disable-next-line eslint/no-restricted-properties
    const value = process.env[name];
    if (value !== undefined) environment[name] = value;
  }
  environment.PATH = `${dirname(localNode)}:${environment.PATH ?? "/usr/bin:/bin:/usr/sbin:/sbin:/opt/homebrew/bin"}`;
  Object.assign(environment, fixture);
  assertDemoEnvironment(environment);
  return environment;
}

export function assertDemoEnvironment(environment: NodeJS.ProcessEnv) {
  for (const [name, username] of [
    ["DATABASE_URL", "zoen_app"],
    ["DATABASE_URL_UNPOOLED", "zoen_migrator"],
  ] as const) {
    const url = new URL(environment[name] ?? "");
    if (
      url.protocol !== "postgresql:" ||
      url.hostname !== "127.0.0.1" ||
      url.port !== String(DEMO_PORTS.postgres) ||
      url.pathname !== `/${DEMO_DATABASE}` ||
      url.username !== username
    )
      throw new Error(
        `${name} must target the isolated demo database role and port.`
      );
  }
  if (environment.WORKFLOW_POSTGRES_URL !== environment.DATABASE_URL)
    throw new Error(
      "Workflow must use the isolated demo application database."
    );
  if (
    environment.ZOEN_MATRIX_URL !== fixture.ZOEN_MATRIX_URL ||
    environment.ZOEN_MATRIX_SERVER_NAME !== DEMO_MATRIX_SERVER ||
    environment.ZOEN_SEMANTIC_URLS !== fixture.ZOEN_SEMANTIC_URLS ||
    environment.BETTER_AUTH_URL !== fixture.BETTER_AUTH_URL ||
    environment.EVE_NEXT_PRODUCTION_PORT !== String(DEMO_PORTS.eve) ||
    environment.COMPANION_MODEL_PROVIDER !== "codex-local" ||
    environment.COMPANION_CODEX_MODEL !== "gpt-5.6-luna"
  )
    throw new Error(
      "Demo service origins and model selection must match the isolated installation."
    );
  for (const name of [
    "OPENAI_API_KEY",
    "ANTHROPIC_API_KEY",
    "OPENROUTER_API_KEY",
    "AI_GATEWAY_API_KEY",
    "KERNEL_API_KEY",
    "TELEGRAM_BOT_TOKEN",
    "KAPSO_API_KEY",
    "GOOGLE_CLIENT_SECRET",
    "BLOB_READ_WRITE_TOKEN",
    "NEXT_PUBLIC_POSTHOG_PROJECT_TOKEN",
    "NODE_OPTIONS",
  ]) {
    if (environment[name])
      throw new Error(`Unexpected inherited setting: ${name}.`);
  }
}

export async function assertDemoWorktree() {
  if (resolve(root) !== assignedRoot)
    throw new Error("Run this launcher only from the assigned demo worktree.");
  if (!process.versions.node.startsWith("24."))
    throw new Error(
      `Use Node 24: ${localNode} --import tsx scripts/demo/stack.ts --help`
    );
  const liveEnvironmentFiles = (await readdir(root)).filter(
    (name) => /^\.env(?:\.|$)/u.test(name) && name !== ".env.example"
  );
  if (liveEnvironmentFiles.length)
    throw new Error(
      "Remove inherited .env files from the isolated worktree before launching."
    );
}

async function privateWrite(path: string, content: string) {
  await writeFile(path, content, { mode: 0o600 });
  await chmod(path, 0o600);
}

async function prepare() {
  await assertDemoWorktree();
  await mkdir(DEMO_STATE_DIRECTORY, { recursive: true, mode: 0o700 });
  await chmod(DEMO_STATE_DIRECTORY, 0o700);
  const matrixDirectory = join(DEMO_STATE_DIRECTORY, "matrix");
  await mkdir(matrixDirectory, { recursive: true, mode: 0o700 });
  await chmod(matrixDirectory, 0o700);
  await mkdir(fixture.ZOEN_SESSION_ARCHIVE_DIR, {
    recursive: true,
    mode: 0o700,
  });
  const compose = composeSchema.parse(
    parse(await readFile(join(root, "tests/runtime/compose.yaml"), "utf8"))
  );
  compose.name = project;
  const postgres = compose.services.postgres;
  postgres.environment.POSTGRES_DB = DEMO_DATABASE;
  postgres.ports = [`127.0.0.1:${DEMO_PORTS.postgres}:5432`];
  postgres.volumes = [
    "postgres:/var/lib/postgresql",
    `${join(DEMO_STATE_DIRECTORY, "application.sh")}:/docker-entrypoint-initdb.d/application.sh:ro`,
    `${join(matrixDirectory, "database.sql")}:/docker-entrypoint-initdb.d/matrix.sql:ro`,
  ];
  postgres.healthcheck.test = [
    "CMD-SHELL",
    `pg_isready -h 127.0.0.1 -U postgres -d ${DEMO_DATABASE}`,
  ];
  const matrix = compose.services.matrix;
  matrix.ports = [`127.0.0.1:${DEMO_PORTS.matrix}:8008`];
  matrix.volumes = [
    "matrix:/data",
    `${matrixDirectory}:/config:ro`,
    `${join(DEMO_STATE_DIRECTORY, "registration.py")}:/zoen/registration.py:ro`,
  ];
  const semantic = compose.services["semantic-1"];
  delete semantic.profiles;
  semantic.build.context = root;
  semantic.image = "zoen-semantic-investor-demo";
  semantic.ports = [`127.0.0.1:${DEMO_PORTS.semantic}:18130`];
  // No restart loop should restart work after the explicit stop command.
  semantic.restart = "no";
  delete compose.services["semantic-2"];
  const homeserver = z
    .looseObject({ server_name: z.string() })
    .parse(
      parse(
        await readFile(
          join(root, "tests/runtime/matrix/homeserver.yaml"),
          "utf8"
        )
      )
    );
  homeserver.server_name = DEMO_MATRIX_SERVER;
  const registration = registrationSchema.parse(
    parse(
      await readFile(
        join(root, "tests/runtime/matrix/registration.yaml"),
        "utf8"
      )
    )
  );
  registration.url = `http://host.docker.internal:${DEMO_PORTS.eve}`;
  for (const namespace of ["users", "aliases"] as const)
    for (const entry of registration.namespaces[namespace])
      entry.regex = entry.regex
        .replaceAll("zoen-eve\\.test", "zoen-investor-demo\\.test")
        .replaceAll("zoen-eve.test", DEMO_MATRIX_SERVER);
  await copyFile(
    join(root, "infrastructure/postgres/bootstrap-application.sh"),
    join(DEMO_STATE_DIRECTORY, "application.sh")
  );
  await copyFile(
    join(root, "infrastructure/matrix/registration.py"),
    join(DEMO_STATE_DIRECTORY, "registration.py")
  );
  await copyFile(
    join(root, "tests/runtime/matrix/database.sql"),
    join(matrixDirectory, "database.sql")
  );
  await privateWrite(composePath, stringify(compose));
  await privateWrite(
    join(matrixDirectory, "homeserver.yaml"),
    stringify(homeserver)
  );
  await privateWrite(
    join(matrixDirectory, "registration.yaml"),
    stringify(registration)
  );
  await privateWrite(
    join(DEMO_STATE_DIRECTORY, "installation.env"),
    Object.entries(fixture)
      .map(([name, value]) => `${name}=${value}`)
      .join("\n") + "\n"
  );
  await privateWrite(
    join(DEMO_STATE_DIRECTORY, "stack.json"),
    JSON.stringify(
      {
        project,
        root,
        database: DEMO_DATABASE,
        serverName: DEMO_MATRIX_SERVER,
        ports: DEMO_PORTS,
        matrixCallback: registration.url,
        model: {
          provider: "codex-local",
          name: "gpt-5.6-luna",
          rootModelTurnLimit: 3,
        },
      },
      null,
      2
    ) + "\n"
  );
}

const composeArguments = ["compose", "-p", project, "-f", composePath];
async function run(
  program: string,
  args: string[],
  environment = demoEnvironment(),
  capture = false
) {
  const child = spawn(program, args, {
    cwd: root,
    env: environment,
    stdio: capture ? ["ignore", "pipe", "pipe"] : "inherit",
  });
  let output = "";
  if (capture) {
    child.stdout?.on("data", (chunk: Buffer) => {
      output += chunk.toString();
    });
    child.stderr?.on("data", (chunk: Buffer) => {
      output += chunk.toString();
    });
  }
  await new Promise<void>((done, reject) => {
    child.once("error", reject);
    child.once("exit", (code) => {
      if (code === 0) done();
      else reject(new Error(`${program} failed with status ${String(code)}.`));
    });
  });
  return output;
}

async function assertOwnedDatabaseContainer() {
  const id = (
    await run(
      "docker",
      [...composeArguments, "ps", "-q", "postgres"],
      undefined,
      true
    )
  ).trim();
  if (!id || id.includes("\n"))
    throw new Error("The isolated demo PostgreSQL container is not running.");
  const [details] = z
    .tuple([
      z.object({
        Config: z.object({ Labels: z.record(z.string(), z.string()) }),
        State: z.object({ Running: z.boolean() }),
        NetworkSettings: z.object({
          Ports: z.record(
            z.string(),
            z
              .array(
                z.object({
                  HostIp: z.string(),
                  HostPort: z.string(),
                })
              )
              .nullable()
          ),
        }),
      }),
    ])
    .parse(JSON.parse(await run("docker", ["inspect", id], undefined, true)));
  const binding = details.NetworkSettings.Ports["5432/tcp"];
  const port = binding?.[0];
  if (
    details.Config.Labels["com.docker.compose.project"] !== project ||
    details.Config.Labels["com.docker.compose.service"] !== "postgres" ||
    !details.State.Running ||
    binding?.length !== 1 ||
    port?.HostIp !== "127.0.0.1" ||
    port.HostPort !== String(DEMO_PORTS.postgres)
  )
    throw new Error(
      "Database container ownership and loopback mapping do not match this demo."
    );
}

async function assertLocalDocker() {
  const [context] = z
    .tuple([
      z.object({
        Endpoints: z.object({ docker: z.object({ Host: z.string() }) }),
      }),
    ])
    .parse(
      JSON.parse(await run("docker", ["context", "inspect"], undefined, true))
    );
  if (!context.Endpoints.docker.Host.startsWith("unix://"))
    throw new Error(
      "Use a local Docker Unix socket context for this private demo."
    );
}

async function assertCachedServiceImages() {
  const compose = composeSchema.parse(
    parse(await readFile(composePath, "utf8"))
  );
  const dockerfile = await readFile(
    join(root, "infrastructure/semantic/Dockerfile"),
    "utf8"
  );
  const semanticBase = /^FROM\s+(\S+)/mu.exec(dockerfile)?.[1];
  if (!semanticBase)
    throw new Error(
      "The semantic service must declare its existing base image."
    );
  for (const image of [
    compose.services.postgres.image,
    compose.services.matrix.image,
    semanticBase,
  ]) {
    try {
      await run("docker", ["image", "inspect", image], undefined, true);
    } catch {
      throw new Error(
        `Required Docker image is not cached: ${image}. No image was pulled; obtain approval before fetching it.`
      );
    }
  }
}

async function main() {
  const { positionals, values } = parseArgs({
    allowPositionals: true,
    options: {
      help: { type: "boolean", short: "h" },
      "dry-run": { type: "boolean" },
    },
  });
  const command = positionals[0] ?? "help";
  if (positionals.length > 1)
    throw new Error("Specify exactly one command. Use --help.");
  if (values.help || ["help", "--help", "-h"].includes(command)) {
    console.log(`Manage the private, real Zoen demo services. No model calls are made here.

Commands:
  prepare  Write private synthetic service configuration only
  up       Build the real semantic executor and start this Compose project
  migrate  Apply Drizzle + Workflow schemas to the owned demo database
  stop     Stop only this project's containers, retaining all fictional data

Options:
  --dry-run  Print the fixed target without writes or service operations

Examples:
  ${localNode} --import tsx scripts/demo/stack.ts prepare
  ${localNode} --import tsx scripts/demo/stack.ts up --dry-run
  ${localNode} --import tsx scripts/demo/stack.ts migrate
  ${localNode} --import tsx scripts/demo/stack.ts stop

Project: ${project}; loopback ports: ${Object.values(DEMO_PORTS).join(", ")}.
State: ${DEMO_STATE_DIRECTORY}. There is no reset or volume-delete command.
Build/start the real Next/Eve app separately using demoEnvironment().
Verify Synapse can reach the loopback Eve callback before any model prompt.`);
    return;
  }
  if (!["prepare", "up", "migrate", "stop"].includes(command))
    throw new Error(`Unknown command ${command}. Use --help.`);
  await assertDemoWorktree();
  if (values["dry-run"]) {
    console.log(
      JSON.stringify({
        command,
        project,
        root,
        state: DEMO_STATE_DIRECTORY,
        ports: DEMO_PORTS,
        database: DEMO_DATABASE,
        model: "codex-local/gpt-5.6-luna",
        modelCalls: 0,
      })
    );
    return;
  }
  await prepare();
  if (command !== "prepare") await assertLocalDocker();
  if (command === "up") {
    await assertCachedServiceImages();
    await run(process.execPath, [
      "--import",
      "tsx",
      "server/workspaces/semantic/build.ts",
    ]);
    await run("docker", [
      ...composeArguments,
      "up",
      "--pull",
      "never",
      "--build",
      "--detach",
      "--wait",
      "--wait-timeout",
      "120",
    ]);
  } else if (command === "migrate") {
    await assertOwnedDatabaseContainer();
    await run(process.execPath, [
      "node_modules/drizzle-kit/bin.cjs",
      "migrate",
      "--config",
      "db/drizzle.config.ts",
    ]);
    await run(
      process.execPath,
      ["node_modules/@workflow/world-postgres/bin/setup.js"],
      {
        ...demoEnvironment(),
        WORKFLOW_POSTGRES_URL: fixture.DATABASE_URL_UNPOOLED,
      }
    );
    await run("docker", [
      ...composeArguments,
      "exec",
      "-T",
      "postgres",
      "bash",
      "/docker-entrypoint-initdb.d/application.sh",
    ]);
  } else if (command === "stop") {
    await run("docker", [...composeArguments, "stop"]);
  }
  console.log(
    JSON.stringify({
      command,
      status: "completed",
      project,
      state: DEMO_STATE_DIRECTORY,
      ports: DEMO_PORTS,
      modelCalls: 0,
    })
  );
}

// Seed/build scripts can import the environment without executing any CLI action.
if (
  process.argv[1] &&
  resolve(process.argv[1]) === fileURLToPath(import.meta.url)
) {
  await main().catch((error: unknown) => {
    console.error(
      error instanceof Error ? error.message : "Demo service command failed."
    );
    process.exitCode = 1;
  });
}
