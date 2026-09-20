import { parseArgs } from "node:util";
import { spawn, type ChildProcess } from "node:child_process";
import { mkdir, readFile, writeFile } from "node:fs/promises";
import { randomUUID } from "node:crypto";
import { z } from "zod";
import { Client } from "eve/client";

const stopping = new AbortController();
let child: ChildProcess | undefined;
let forceKill: NodeJS.Timeout | undefined;
for (const signal of ["SIGINT", "SIGTERM"] as const)
  process.once(signal, () => {
    stopping.abort();
    process.exitCode = 130;
    child?.kill(signal);
    forceKill = setTimeout(() => child?.kill("SIGKILL"), 10_000);
    forceKill.unref();
  });

async function run(args: string[], env: NodeJS.ProcessEnv) {
  stopping.signal.throwIfAborted();
  child = spawn(
    process.execPath,
    ["node_modules/eve/bin/eve.js", "eval", ...args],
    { env, stdio: "inherit" }
  );
  try {
    return await new Promise<number | null>((resolve, reject) => {
      child?.once("error", reject);
      child?.once("exit", resolve);
    });
  } finally {
    child = undefined;
  }
}
const loopback = (host: string) =>
  ["localhost", "127.0.0.1", "[::1]"].includes(host);

try {
  const { values } = parseArgs({
    options: {
      url: { type: "string" },
      suite: { type: "string", default: "launch" },
      tag: { type: "string" },
      "network-scope": { type: "string", default: "personal" },
      list: { type: "boolean" },
      json: { type: "boolean" },
      repeat: { type: "string", default: "1" },
      timeout: { type: "string", default: "180000" },
      junit: { type: "string" },
      help: { type: "boolean", short: "h" },
    },
  });
  if (values.help) {
    console.log(`Run native Eve evals against an isolated Zoen installation.

Options:
  --list                 List without model or database access
  --suite <path>         launch, agent, browser, or a case below them
  --url <origin>         Loopback HTTP app using companion_runtime_test
  --tag <tag>            Filter native cases
  --repeat <1..20>       Repeat every selected case
  --timeout <ms>         Per-case timeout (1000..900000)
  --network-scope <kind> personal or company
  --junit <path>         Write a native JUnit report
  --json                 Native machine-readable output

Examples:
  pnpm eval:agent --list
  pnpm eval:agent --url http://127.0.0.1:4351 --tag tools --repeat 3
  pnpm eval:agent --url http://127.0.0.1:4351 --junit .eve/launch.xml`);
  } else {
    if (!/^(launch|agent|browser)(\/[a-zA-Z0-9_-]+)*$/u.test(values.suite))
      throw new Error(
        "Use --suite launch, agent, browser, or a case below one of those directories."
      );
    const repeat = z.coerce.number().int().min(1).max(20).parse(values.repeat);
    const timeout = z.coerce
      .number()
      .int()
      .min(1000)
      .max(900000)
      .parse(values.timeout);
    const networkKind = z
      .enum(["personal", "company"])
      .parse(values["network-scope"]);
    // Explicit allowlist: provider/channel production credentials never reach synthetic evals.
    const environment: NodeJS.ProcessEnv = { NODE_ENV: "test" };
    for (const name of [
      "PATH",
      "HOME",
      "TMPDIR",
      "LANG",
      "LC_ALL",
      "AI_GATEWAY_API_KEY",
      "OPENROUTER_API_KEY",
      "BETTER_AUTH_SECRET",
      "BETTER_AUTH_URL",
      "SECRET_ENCRYPTION_KEY",
      "DATABASE_URL",
    ]) {
      // oxlint-disable-next-line eslint/no-restricted-properties
      const value = process.env[name];
      if (value !== undefined) environment[name] = value;
    }
    const selected = [
      values.suite,
      ...(values.tag ? ["--tag", values.tag] : []),
    ];
    if (values.list) {
      if ((await run([...selected, "--list"], environment)) !== 0)
        throw new Error("Eval listing failed.");
    } else {
      if (!values.url)
        throw new Error(
          "Start the built app against companion_runtime_test, then run pnpm eval:agent --url http://127.0.0.1:4351. Use --list to inspect cases without credentials."
        );
      const origin = new URL(values.url);
      const database = new URL(
        environment.DATABASE_URL ?? "postgresql://invalid/"
      );
      if (
        !loopback(origin.hostname) ||
        origin.protocol !== "http:" ||
        origin.username ||
        origin.password ||
        origin.pathname !== "/" ||
        origin.search ||
        origin.hash ||
        !loopback(database.hostname) ||
        database.pathname !== "/companion_runtime_test"
      ) {
        throw new Error(
          "Only a loopback HTTP app and the isolated companion_runtime_test database are allowed. Production targets are refused."
        );
      }
      const { launchFixture } = await import("./agent-evals/fixture");
      const { launchTarget } = await import("./agent-evals/target");
      const { requireRuntimeDatabase } =
        await import("../tests/runtime/database");
      const { db } = await import("../db");
      try {
        await requireRuntimeDatabase();
        const output = `.eve/launch-${randomUUID()}`;
        await mkdir(output, { recursive: true });
        const failures: string[] = [];
        for (let index = 0; index < repeat; index++) {
          stopping.signal.throwIfAborted();
          await using fixture = await launchFixture(
            values.suite === "launch" ||
              values.suite === "launch/network" ||
              values.tag === "network"
              ? networkKind
              : undefined
          );
          await using target = await launchTarget(origin.origin, fixture);
          await new Client({
            host: target.url,
            auth: { bearer: target.token },
            redirect: "error",
          }).health();
          const report = `${output}/run-${index + 1}.json`;
          const code = await run(
            [
              ...selected,
              "--url",
              target.url,
              "--strict",
              "--max-concurrency",
              "1",
              "--timeout",
              String(timeout),
              ...(values.json ? ["--json"] : []),
              ...(values.junit
                ? [
                    "--junit",
                    repeat === 1
                      ? values.junit
                      : `${values.junit}.${index + 1}.xml`,
                  ]
                : []),
            ],
            {
              ...environment,
              EVE_EVAL_AUTH_TOKEN: target.token,
              ZOEN_EVAL_REPORT: report,
            }
          );
          if (fixture.network)
            await writeFile(
              `${output}/run-${index + 1}-matrix.json`,
              JSON.stringify(await fixture.network.evidence(), null, 2),
              { mode: 0o600 }
            );
          const raw = await readFile(report, "utf8").catch(() => {
            throw new Error(
              `Eve exited with ${String(code)} before producing a report. Inspect its preceding configuration or transport error.`
            );
          });
          const receipt = z
            .object({
              counts: z.object({
                passed: z.number(),
                failed: z.number(),
                skipped: z.number(),
                scored: z.number(),
              }),
            })
            .parse(JSON.parse(raw));
          if (!values.json)
            console.info(`Native evaluation receipt: ${report}`);
          if (
            code !== 0 ||
            receipt.counts.passed === 0 ||
            receipt.counts.failed !== 0 ||
            receipt.counts.skipped !== 0 ||
            receipt.counts.scored !== 0
          )
            failures.push(report);
        }
        if (failures.length)
          throw new Error(
            `Required evals did not all pass. Inspect ${failures.join(", ")} and the native .eve/evals artifacts.`
          );
      } finally {
        await db.$client.end();
      }
    }
  }
} catch (error) {
  console.error(error instanceof Error ? error.message : "Evaluation failed.");
  process.exitCode ??= 1;
} finally {
  if (forceKill) clearTimeout(forceKill);
}
