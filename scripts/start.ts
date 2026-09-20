import { spawn, type ChildProcess } from "node:child_process";
import { readFile } from "node:fs/promises";
import { fileURLToPath } from "node:url";
import { parseArgs } from "node:util";
import { setTimeout as delay } from "node:timers/promises";
import { z } from "zod";
import { requireServerPort } from "./server-ports.ts";

const { values } = parseArgs({
  options: {
    port: { type: "string" },
    hostname: { type: "string", default: "127.0.0.1" },
    "eve-port": { type: "string" },
    help: { type: "boolean", short: "h" },
  },
});
const children = new Map<ChildProcess, Promise<number | null>>();
const stopping = new AbortController();
for (const signal of ["SIGINT", "SIGTERM", "SIGHUP"] as const) {
  process.once(signal, () => {
    stopping.abort();
  });
}
function launch(args: string[], environment: NodeJS.ProcessEnv) {
  const child = spawn(process.execPath, args, {
    env: environment,
    stdio: "inherit",
  });
  const exited = new Promise<number | null>((resolve, reject) => {
    child.once("error", reject);
    child.once("exit", resolve);
  });
  children.set(child, exited);
  return exited;
}

try {
  if (values.help) {
    console.log(`Run the built Zoen app and Eve runtime.

Options:
  --port <number>      Web port (PORT or 3000)
  --hostname <host>    Web host (127.0.0.1)
  --eve-port <number>  Eve loopback port (EVE_NEXT_PRODUCTION_PORT or 4274)

Examples:
  pnpm start --port 3000
  pnpm start --hostname 0.0.0.0

Run database migrations and pnpm build before starting.`);
  } else {
    const { env } = await import("../shared/environment/env.ts");
    // The supervisor forwards the configured environment to its owned processes.
    // oxlint-disable-next-line eslint/no-restricted-properties
    const inherited = { ...process.env };
    const portSchema = z.coerce.number().int().min(1).max(65535);
    const port = portSchema.parse(values.port ?? env.PORT);
    const evePort = portSchema.parse(
      values["eve-port"] ?? env.EVE_NEXT_PRODUCTION_PORT
    );
    if (port === evePort)
      throw new Error(
        "Web and Eve ports must differ. Use --port 3000 --eve-port 4274."
      );
    const origin = `http://127.0.0.1:${evePort}`;
    const routes = z
      .object({
        rewrites: z.object({
          beforeFiles: z.array(
            z.object({ source: z.string(), destination: z.string() })
          ),
        }),
      })
      .parse(JSON.parse(await readFile(".next/routes-manifest.json", "utf8")));
    for (const [source, path] of [
      ["/eve/v1/:path+", "/eve/v1/:path+"],
      ["/api/channels/telegram", "/channels/telegram"],
      ["/api/channels/kapso", "/channels/kapso"],
    ] as const) {
      if (
        !routes.rewrites.beforeFiles.some(
          (route) =>
            route.source === source && route.destination === `${origin}${path}`
        )
      ) {
        throw new Error(
          "Eve port does not match the built routes. Rebuild with EVE_NEXT_PRODUCTION_PORT set to this port."
        );
      }
    }
    await requireServerPort("127.0.0.1", evePort);
    await requireServerPort(values.hostname, port);
    if (env.ZOEN_ERASURE_JOURNAL_BUCKET) {
      if (
        (await launch(
          ["--import", "tsx", "scripts/reconcile-account-erasures.ts"],
          inherited
        )) !== 0
      ) {
        throw new Error(
          "Account erasure reconciliation failed; refusing to serve restored data."
        );
      }
      children.clear();
    }
    const eveExited = launch([".output/server/index.mjs"], {
      ...inherited,
      NODE_ENV: "production",
      HOST: "127.0.0.1",
      NITRO_HOST: "127.0.0.1",
      NITRO_PORT: String(evePort),
      PORT: String(evePort),
      WORKFLOW_LOCAL_BASE_URL: origin,
      // Keep the session inbox available while native steps run model calls.
      WORKFLOW_MAX_INLINE_STEPS: "0",
      WORKFLOW_POSTGRES_WORKER_CONCURRENCY: String(
        env.WORKFLOW_POSTGRES_WORKER_CONCURRENCY
      ),
      WORKFLOW_POSTGRES_MAX_POOL_SIZE: String(
        env.WORKFLOW_POSTGRES_MAX_POOL_SIZE
      ),
    });
    await Promise.race([
      (async () => {
        const signal = AbortSignal.any([
          stopping.signal,
          AbortSignal.timeout(30_000),
        ]);
        for (;;) {
          signal.throwIfAborted();
          try {
            if ((await fetch(`${origin}/eve/v1/health`, { signal })).ok) return;
          } catch {
            signal.throwIfAborted();
          }
          await delay(100, undefined, { signal });
        }
      })(),
      eveExited.then((code) => {
        throw new Error(`Eve exited before readiness (code ${String(code)}).`);
      }),
    ]);
    const webExited = launch(
      [
        fileURLToPath(import.meta.resolve("next/dist/bin/next")),
        "start",
        "--hostname",
        values.hostname,
        "--port",
        String(port),
      ],
      {
        ...inherited,
        NODE_ENV: "production",
        EVE_NEXT_PRODUCTION_PORT: String(evePort),
      }
    );
    await Promise.race([
      new Promise<void>((resolve) => {
        if (stopping.signal.aborted) resolve();
        else
          stopping.signal.addEventListener(
            "abort",
            () => {
              resolve();
            },
            { once: true }
          );
      }),
      Promise.race([eveExited, webExited]).then((code) => {
        throw new Error(
          `A server exited (code ${String(code)}); stopping Zoen.`
        );
      }),
    ]);
  }
} catch (error) {
  if (!stopping.signal.aborted) {
    console.error(error instanceof Error ? error.message : "Startup failed.");
    process.exitCode = 1;
  }
} finally {
  stopping.abort();
  await Promise.all(
    [...children].map(async ([child, exited]) => {
      if (child.exitCode !== null || child.signalCode !== null) return;
      child.kill("SIGTERM");
      const force = setTimeout(() => child.kill("SIGKILL"), 15_000);
      try {
        await exited;
      } catch {
        process.exitCode = 1;
      } finally {
        clearTimeout(force);
      }
    })
  );
}
