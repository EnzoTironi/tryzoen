import { execFile, spawn } from "node:child_process";
import { fileURLToPath } from "node:url";
import { promisify } from "node:util";
import { z } from "zod";
import { expect, onTestFinished } from "vitest";
import { Pool } from "pg";
import { env } from "@shared/environment/env";
import { requireRuntimeDatabase } from "./database";
import { waitForSupervisorClose } from "../helpers/supervisor-process";
const directory = fileURLToPath(
  new URL("../fixtures/eve-runtime/", import.meta.url)
);
const eventsSchema = z.array(
  z.object({
    type: z.string(),
    data: z.unknown(),
  })
);
export async function buildEveFixture() {
  await clearFixtureWorkflows();
  await promisify(execFile)(
    process.execPath,
    ["../../../node_modules/eve/bin/eve.js", "build"],
    {
      cwd: directory,
      timeout: 60_000,
      maxBuffer: 4 * 1024 * 1024,
    }
  );
}

// Runtime files run serially. Retire this compiled fixture's parked sessions so
// the next world's startup cannot enqueue them against a stopped HTTP process.
export async function clearFixtureWorkflows() {
  await requireRuntimeDatabase();
  const connectionString = env.DATABASE_URL_UNPOOLED;
  if (!connectionString)
    throw new Error("Fixture migrations require their own database role.");
  const target = new URL(connectionString);
  const database = new URL(env.DATABASE_URL);
  if (target.host !== database.host || target.pathname !== database.pathname) {
    throw new Error(
      "Workflow cleanup must use the same isolated test database."
    );
  }
  const pool = new Pool({ connectionString, max: 1 });
  try {
    await pool.query(`TRUNCATE workflow.workflow_runs, workflow.workflow_stream_chunks,
      graphile_worker._private_jobs, graphile_worker._private_job_queues CASCADE`);
  } finally {
    await pool.end();
  }
}
export async function runtime(port: number, host = "127.0.0.1") {
  const origin = `http://127.0.0.1:${String(port)}`;
  const child = spawn(process.execPath, [".output/server/index.mjs"], {
    cwd: directory,
    stdio: ["ignore", "pipe", "pipe"],
    env: {
      ...process.env,
      HOST: host,
      PORT: String(port),
      WORKFLOW_LOCAL_BASE_URL: origin,
      WORKFLOW_MAX_INLINE_STEPS: "0",
      WORKFLOW_POSTGRES_WORKER_CONCURRENCY: String(
        env.WORKFLOW_POSTGRES_WORKER_CONCURRENCY
      ),
      WORKFLOW_POSTGRES_MAX_POOL_SIZE: String(
        env.WORKFLOW_POSTGRES_MAX_POOL_SIZE
      ),
    },
  });
  let output = "";
  child.stdout.on("data", (chunk: Buffer) => {
    output += chunk.toString();
  });
  child.stderr.on("data", (chunk: Buffer) => {
    output += chunk.toString();
  });
  const closed = waitForSupervisorClose(child);
  async function stop() {
    if (child.exitCode !== null || child.signalCode !== null) return;
    child.kill("SIGTERM");
    const deadline = globalThis.setTimeout(() => child.kill("SIGKILL"), 5_000);
    try {
      await closed;
    } finally {
      clearTimeout(deadline);
    }
  }
  onTestFinished(stop);
  await expect
    .poll(
      async () => {
        if (child.exitCode !== null) throw new Error(output);
        try {
          return (await fetch(`${origin}/eve/v1/health`)).ok;
        } catch {
          return false;
        }
      },
      {
        timeout: 20_000,
        interval: 100,
      }
    )
    .toBe(true);
  async function request(path: string, body?: unknown): Promise<unknown> {
    const response = await fetch(origin + path, {
      method: body === undefined ? "GET" : "POST",
      headers: {
        "content-type": "application/json",
      },
      body: body === undefined ? undefined : JSON.stringify(body),
      signal: AbortSignal.timeout(30_000),
    });
    if (!response.ok)
      throw new Error(
        `${String(response.status)}: ${await response.text()}\n${output}`
      );
    return response.json();
  }
  async function settled(sessionId: string, turns = 1) {
    let events: z.output<typeof eventsSchema> = [];
    await expect
      .poll(
        async () => {
          events = eventsSchema.parse(
            await request(`/probe/events/${sessionId}`)
          );
          const failed = events.filter((event) =>
            /^(session|turn)\.failed$/u.test(event.type)
          );
          if (failed.length)
            throw new Error(JSON.stringify(failed) + "\n" + output);
          return events.filter((event) => event.type === "session.waiting")
            .length;
        },
        {
          timeout: 30_000,
          interval: 100,
        }
      )
      .toBeGreaterThanOrEqual(turns);
    return events;
  }
  return {
    request,
    stop,
    settled,
    output: () => output,
  };
}
