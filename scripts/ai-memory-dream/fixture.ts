import { memoryTool } from "../../server/memory/ai-memory/protocol";
import assert from "node:assert/strict";
import { spawn } from "node:child_process";
import { randomUUID } from "node:crypto";
import { once } from "node:events";
import { mkdir, writeFile } from "node:fs/promises";
import { createServer } from "node:http";
import { join } from "node:path";
import { setTimeout as delay } from "node:timers/promises";
import { stripVTControlCharacters } from "node:util";
import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { StreamableHTTPClientTransport } from "@modelcontextprotocol/sdk/client/streamableHttp.js";
import { z } from "zod";

export const scope = { workspace: "synthetic-review", project: "dream" };
export const pages = [
  "The reading club meets in Cedarbay.",
  "Bring a notebook to the Cedarbay reading club.",
  "The telescope group meets in Willowhaven.",
];

export async function eventually(check: () => boolean, description: string) {
  const deadline = Date.now() + 15_000;
  while (!check()) {
    assert(Date.now() < deadline, `Timed out: ${description}`);
    await delay(50);
  }
}

/** Synthetic, loopback-only provider. Never receives application credentials. */
export async function fixtureProvider() {
  const calls: { path: string; body: unknown }[] = [];
  const errors: string[] = [];
  let mode: "valid" | "malformed" | "held" = "valid";
  let release: (() => void) | undefined;
  const server = createServer((request, response) => {
    void (async () => {
      try {
        assert.equal(request.method, "POST");
        let text = "";
        for await (const part of request) {
          assert(Buffer.isBuffer(part));
          text += part.toString("utf8");
          assert(
            Buffer.byteLength(text) <= 200_000,
            "Oversized fixture request"
          );
        }
        const body = z.record(z.string(), z.unknown()).parse(JSON.parse(text));
        assert(calls.length < 100, "Unbounded fixture provider calls");
        calls.push({ path: request.url ?? "", body });
        let payload: unknown;
        if (request.url === "/v1/embeddings") {
          const inputs = z
            .array(z.string())
            .parse(Array.isArray(body.input) ? body.input : [body.input]);
          payload = {
            data: inputs.map((input, index) => ({
              index,
              embedding: input.includes("Cedarbay")
                ? [1, 0, 0]
                : input.includes("Ambertrail")
                  ? [0, 1, 0]
                  : [0, 0, 1],
            })),
          };
        } else {
          assert.equal(request.url, "/v1/chat/completions");
          if (body.response_format === undefined) {
            assert.equal(
              mode,
              "malformed",
              "Only malformed-output fallback omits the schema"
            );
          } else {
            const format = z
              .object({
                type: z.literal("json_schema"),
                json_schema: z.object({
                  strict: z.literal(true),
                  schema: z.object({
                    additionalProperties: z.literal(false),
                    required: z.array(z.string()),
                  }),
                }),
              })
              .parse(body.response_format);
            assert.deepEqual(format.json_schema.schema.required.toSorted(), [
              "body_markdown",
              "title",
            ]);
          }
          if (mode === "held")
            await new Promise<void>((done) => {
              release = done;
            });
          const cedarbay = JSON.stringify(body.messages).includes("Cedarbay");
          const content =
            mode === "malformed"
              ? "This is not structured JSON."
              : JSON.stringify({
                  title: "Synthetic club",
                  body_markdown: cedarbay
                    ? "The reading club meets in Cedarbay. Bring a notebook."
                    : "The walking club meets in Ambertrail. Bring a compass.",
                });
          payload = {
            id: "synthetic-dream",
            object: "chat.completion",
            created: 1,
            model: "synthetic-dream",
            choices: [
              {
                index: 0,
                finish_reason: "stop",
                message: { role: "assistant", content },
              },
            ],
            usage: { prompt_tokens: 5, completion_tokens: 5, total_tokens: 10 },
          };
        }
        response.writeHead(200, { "Content-Type": "application/json" });
        response.end(JSON.stringify(payload));
      } catch (error) {
        errors.push(error instanceof Error ? error.message : "Fixture failed");
        response.writeHead(500);
        response.end(error instanceof Error ? error.message : "Fixture failed");
      }
    })();
  });
  server.listen(0, "127.0.0.1");
  await once(server, "listening");
  const address = server.address();
  assert(address && typeof address !== "string");
  return {
    url: `http://127.0.0.1:${address.port}/v1`,
    calls,
    errors,
    completions: () =>
      calls.filter((call) => call.path.endsWith("/chat/completions")).length,
    setMode(value: typeof mode) {
      mode = value;
    },
    release() {
      release?.();
      release = undefined;
    },
    async [Symbol.asyncDispose]() {
      release?.();
      const closed = once(server, "close");
      server.close();
      server.closeAllConnections();
      await closed;
    },
  };
}

/** Qualification-only configuration: one-second ticks and deliberately cold pages. */
export async function dreamEngine(
  binary: string,
  data: string,
  provider: string,
  enabled: boolean
) {
  await mkdir(data, { recursive: true, mode: 0o700 });
  const config = join(data, "config.toml");
  await writeFile(
    config,
    `llm_provider = "openai-compat"
llm_model = "synthetic-dream"
llm_base_url = "${provider}"
llm_timeout_secs = 15
embedding_provider = "openai-compat"
embedding_model = "synthetic-embedding"
embedding_dim = 3
embedding_base_url = "${provider}"
[maintenance]
enabled = false
[auto_improve]
enabled = false
[decay]
cold_threshold = 100.0
[dream]
enabled = ${String(enabled)}
interval_secs = 1
idle_window_secs = 5
max_clusters_per_run = 2
min_cold_pages = 2
min_pts = 2
`,
    { mode: 0o600 }
  );
  const token = randomUUID();
  const child = spawn(
    binary,
    [
      "--data-dir",
      data,
      "--config",
      config,
      "serve",
      "--transport",
      "http",
      "--bind",
      "127.0.0.1:0",
    ],
    {
      env: {
        PATH: "/usr/bin:/bin",
        HOME: data,
        RUST_LOG: "info",
        NODE_ENV: "test",
        AI_MEMORY_AUTH_TOKEN: token,
        LLM_API_KEY: "synthetic-fixture",
        EMBEDDING_API_KEY: "synthetic-fixture",
      },
      stdio: ["ignore", "ignore", "pipe"],
    }
  );
  let logs = "";
  let spawnError: Error | undefined;
  child.on("error", (error) => {
    spawnError = error;
  });
  child.stderr.on("data", (part: Buffer) => {
    logs = (logs + stripVTControlCharacters(part.toString())).slice(-128_000);
  });
  const client = new Client({
    name: "zoen-dream-qualification",
    version: "1.0.0",
  });
  async function stop(signal: NodeJS.Signals = "SIGTERM") {
    if (child.exitCode !== null || child.signalCode !== null || spawnError)
      return;
    const exited = once(child, "exit");
    child.kill(signal);
    const force = setTimeout(() => child.kill("SIGKILL"), 2_000).unref();
    try {
      await exited;
    } finally {
      clearTimeout(force);
    }
  }
  try {
    const ready = /MCP HTTP server ready[^\n]*local_addr=127\.0\.0\.1:(\d+)/;
    await eventually(() => {
      if (spawnError) throw spawnError;
      assert(
        child.exitCode === null && child.signalCode === null,
        "Engine exited before readiness"
      );
      return ready.test(logs);
    }, "native engine readiness");
    const port = z.string().regex(/^\d+$/).parse(ready.exec(logs)?.[1]);
    const address = `http://127.0.0.1:${port}`;
    const headers = {
      Authorization: `Bearer ${token}`,
      "Content-Type": "application/json",
    };
    await client.connect(
      new StreamableHTTPClientTransport(new URL("/mcp", address), {
        requestInit: { headers, redirect: "error" },
      }),
      { timeout: 10_000 }
    );
    return {
      data,
      logs: () => logs,
      kill: () => stop("SIGKILL"),
      async admin(path: string, body: Record<string, unknown>) {
        const response = await fetch(`${address}/admin/${path}`, {
          method: "POST",
          headers,
          body: JSON.stringify(body),
          redirect: "error",
          signal: AbortSignal.timeout(15_000),
        });
        assert(response.ok, `${path} failed: ${response.status}`);
        return z.record(z.string(), z.unknown()).parse(await response.json());
      },
      tool(name: string, args: Record<string, unknown>) {
        return memoryTool(
          client,
          name,
          args.global === true ? args : { ...scope, ...args }
        );
      },
      async [Symbol.asyncDispose]() {
        try {
          await client.close();
        } finally {
          await stop();
          await writeFile(join(data, `engine-${randomUUID()}.log`), logs, {
            mode: 0o600,
          });
        }
      },
    };
  } catch (error) {
    await stop();
    await writeFile(join(data, "failed-start.log"), logs, { mode: 0o600 });
    throw error;
  }
}

export async function seed(
  engine: Awaited<ReturnType<typeof dreamEngine>>,
  bodies = pages
) {
  for (const [index, body] of bodies.entries()) {
    await engine.admin("write-page", {
      ...scope,
      path: `notes/synthetic-${index}.md`,
      body,
      tier: "episodic",
    });
  }
  await engine.admin("embed", scope);
}
