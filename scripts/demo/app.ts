import { spawn } from "node:child_process";
import { fileURLToPath } from "node:url";
import { parseArgs } from "node:util";
import { assertDemoWorktree, demoEnvironment, DEMO_PORTS } from "./stack.ts";

const root = fileURLToPath(new URL("../../", import.meta.url));
const { positionals, values } = parseArgs({
  allowPositionals: true,
  options: {
    help: { type: "boolean", short: "h" },
    "dry-run": { type: "boolean" },
  },
});
const command = positionals[0] ?? "help";
const environment = demoEnvironment();
const buildCommands = [
  [
    "node_modules/typescript/bin/tsc",
    "-p",
    "packages/companion-ui/tsconfig.json",
  ],
  ["node_modules/eve/bin/eve.js", "build", "--skip-sandbox-prewarm"],
  ["--import", "tsx", "server/workspaces/semantic/build.ts"],
  ["node_modules/next/dist/bin/next", "build", root, "--turbopack"],
];
const startCommand = [
  "--import",
  "tsx",
  "scripts/start.ts",
  "--hostname",
  "127.0.0.1",
  "--port",
  String(DEMO_PORTS.web),
  "--eve-port",
  String(DEMO_PORTS.eve),
];

async function run(args: string[]) {
  const child = spawn(process.execPath, args, {
    cwd: root,
    env: environment,
    stdio: "inherit",
  });
  const stop = () => {
    child.kill("SIGTERM");
  };
  process.once("SIGINT", stop);
  process.once("SIGTERM", stop);
  try {
    await new Promise<void>((resolve, reject) => {
      child.once("error", reject);
      child.once("exit", (code, signal) => {
        if (code === 0) resolve();
        else
          reject(
            new Error(
              "Demo app command stopped with " + String(signal ?? code) + "."
            )
          );
      });
    });
  } finally {
    process.removeListener("SIGINT", stop);
    process.removeListener("SIGTERM", stop);
  }
}

if (!process.versions.node.startsWith("24."))
  throw new Error("Use the existing Node 24 executable.");
if (positionals.length > 1)
  throw new Error("Specify one command: build or start.");
if (values.help || command === "help") {
  console.log(
    "Build/start the actual Zoen app with only the isolated synthetic environment.\n\n" +
      "Commands: build, start. Option: --dry-run. No package-manager install or model invocation occurs.\n" +
      "Build uses installed TypeScript, Eve, semantic and Next executables directly; it skips external sandbox prewarm.\n" +
      "Start uses the existing production supervisor and binds web 4397 / Eve 9497 on loopback.\n" +
      "Run stack prepare/up/migrate and seed --apply separately before recording.\n" +
      "Final footage requires the integrated UI checkpoint and verified real workflows."
  );
} else if (command === "build" || command === "start") {
  await assertDemoWorktree();
  const commands = command === "build" ? buildCommands : [startCommand];
  if (values["dry-run"])
    console.log(
      JSON.stringify({
        command,
        root,
        commands,
        ports: DEMO_PORTS,
        modelTurns: 0,
      })
    );
  else for (const args of commands) await run(args);
} else throw new Error("Unknown command. Use --help.");
