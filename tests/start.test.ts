import { spawn } from "node:child_process";
import { freePort } from "./helpers/ports";
import {
  cp,
  mkdir,
  mkdtemp,
  readFile,
  rm,
  symlink,
  writeFile,
} from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { expect, onTestFinished, test } from "vitest";
import {
  waitForSupervisorClose,
  waitForSupervisorLogEntry,
} from "./helpers/supervisor-process";

async function fixture(mode = "ready", args: string[] = []) {
  const directory = await mkdtemp(join(tmpdir(), "zoen-start-"));
  const evePort = await freePort();
  const webPort = await freePort();
  const log = join(directory, "processes.log");
  onTestFinished(() => rm(directory, { force: true, recursive: true }));
  await Promise.all(
    [
      "scripts",
      "shared/environment",
      ".next",
      ".output/server",
      "node_modules/next/dist/bin",
    ].map((path) => mkdir(join(directory, path), { recursive: true }))
  );
  const manifest = {
    rewrites: {
      beforeFiles: (
        [
          ["/eve/v1/:path+", "/eve/v1/:path+"],
          ["/api/channels/telegram", "/channels/telegram"],
          ["/api/channels/kapso", "/channels/kapso"],
        ] as const
      ).map(([source, path]) => ({
        source,
        destination: `http://127.0.0.1:${String(evePort)}${path}`,
      })),
    },
  };
  await Promise.all([
    cp(
      new URL("../scripts/start.ts", import.meta.url),
      join(directory, "scripts/start.ts")
    ),
    cp(
      new URL("../scripts/server-ports.ts", import.meta.url),
      join(directory, "scripts/server-ports.ts")
    ),
    symlink(
      new URL("../node_modules/zod", import.meta.url).pathname,
      join(directory, "node_modules/zod")
    ),
    writeFile(join(directory, "package.json"), '{"type":"module"}'),
    writeFile(
      join(directory, "node_modules/next/package.json"),
      '{"type":"module","exports":{"./dist/bin/next":"./dist/bin/next.js"}}'
    ),
    writeFile(
      join(directory, ".next/routes-manifest.json"),
      JSON.stringify(manifest)
    ),
    writeFile(
      join(directory, "shared/environment/env.ts"),
      "export const env = process.env;"
    ),
    writeFile(
      join(directory, ".output/server/index.mjs"),
      `
      import { createServer } from "node:http";
      import { appendFileSync } from "node:fs";
      const log = text => appendFileSync(process.env.TEST_PROCESS_LOG, text + "\\n");
      if (process.env.TEST_START_MODE === "eve-exit") process.exit(7);
      const server = createServer((_, response) => { response.writeHead(process.env.TEST_START_MODE === "waiting" ? 503 : 200); response.end("{}"); });
      server.listen(Number(process.env.PORT), "127.0.0.1", () => log("eve-started"));
      process.once("SIGTERM", () => { log("eve-stopped"); server.close(() => process.exit()); });
    `
    ),
    writeFile(
      join(directory, "node_modules/next/dist/bin/next.js"),
      `
      import { appendFileSync } from "node:fs";
      const log = text => appendFileSync(process.env.TEST_PROCESS_LOG, text + "\\n");
      log("web-started " + process.argv.slice(2).join(" "));
      if (process.env.TEST_START_MODE === "web-exit") setTimeout(() => process.exit(9), 30);
      const timer = setInterval(() => {}, 1000);
      process.once("SIGTERM", () => { log("web-stopped"); clearInterval(timer); });
    `
    ),
  ]);
  const child = spawn(
    process.execPath,
    [join(directory, "scripts/start.ts"), ...args],
    {
      cwd: directory,
      stdio: ["ignore", "pipe", "pipe"],
      env: {
        NODE_ENV: "test",
        PATH: process.env.PATH,
        PORT: String(webPort),
        EVE_NEXT_PRODUCTION_PORT: String(evePort),
        TEST_START_MODE: mode,
        TEST_PROCESS_LOG: log,
      },
    }
  );
  let output = "";
  child.stdout.on("data", (chunk: Buffer) => {
    output += String(chunk);
  });
  child.stderr.on("data", (chunk: Buffer) => {
    output += String(chunk);
  });
  const closed = waitForSupervisorClose(child);
  onTestFinished(async () => {
    if (child.exitCode === null) child.kill("SIGTERM");
    await closed;
  });
  return { child, closed, log, output: () => output };
}

test("help is available without application credentials or a build", async () => {
  const f = await fixture("ready", ["--help"]);
  expect(await f.closed).toBe(0);
  expect(f.output()).toContain("Run the built Zoen app and Eve runtime.");
});

test("starts Next only after Eve is healthy and shuts both down on interruption", async () => {
  const f = await fixture();
  await waitForSupervisorLogEntry(f.log, "web-started");
  f.child.kill("SIGTERM");
  expect(await f.closed).toBe(0);
  const lines = (await readFile(f.log, "utf8")).trim().split("\n");
  expect(lines[0]).toBe("eve-started");
  expect(lines[1]).toContain("web-started start --hostname 127.0.0.1 --port");
  expect(lines).toContain("eve-stopped");
  expect(lines).toContain("web-stopped");
});

test("interruption during readiness stops Eve without launching Next", async () => {
  const f = await fixture("waiting");
  await waitForSupervisorLogEntry(f.log, "eve-started");
  f.child.kill("SIGTERM");
  expect(await f.closed).toBe(0);
  expect(await readFile(f.log, "utf8")).toBe("eve-started\neve-stopped\n");
});

test("a child failure stops its sibling and reports failure", async () => {
  const f = await fixture("web-exit");
  expect(await f.closed).toBe(1);
  expect(f.output()).toContain("A server exited (code 9)");
  expect(await readFile(f.log, "utf8")).toContain("eve-stopped");
});

test("rejects an Eve port that disagrees with the built rewrites", async () => {
  const f = await fixture("ready", ["--eve-port", "1"]);
  expect(await f.closed).toBe(1);
  expect(f.output()).toContain("Eve port does not match the built routes");
});
