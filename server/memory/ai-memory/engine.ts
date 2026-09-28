import { execFile, spawn, type ChildProcess } from "node:child_process";
import { randomBytes } from "node:crypto";
import { lstat, open, readFile } from "node:fs/promises";
import { join } from "node:path";
import { promisify, stripVTControlCharacters } from "node:util";
import { setTimeout as delay } from "node:timers/promises";
import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { StreamableHTTPClientTransport } from "@modelcontextprotocol/sdk/client/streamableHttp.js";
import { z } from "zod";
import type { MemoryCorpus } from "@db/services/memory-corpora";
import { privateMemoryDirectory } from "../session-files";

const configuration = 'embedding_provider = "none"\n[dream]\nenabled = false\n';

// Run in a separate Node process: IPC disconnect still fires if the application
// is SIGKILLed. Static source avoids a runtime TypeScript loader or bundled asset
// path; the executable and arguments are argv values, never interpolated code.
const supervisor = String.raw`
const { spawn } = require('node:child_process');
if (!process.connected) process.exit(1);
process.umask(0o077);
const [binary, ...args] = process.argv.slice(1);
const child = spawn(binary, args, { stdio: ['ignore', 'ignore', 'pipe'] });
let stopping = false;
let force;
const stop = () => {
  if (stopping) return;
  stopping = true;
  child.kill('SIGTERM');
  force = setTimeout(() => child.kill('SIGKILL'), 1000);
};
const lease = setTimeout(stop, 15 * 60 * 1000);
process.on('disconnect', stop);
process.on('SIGTERM', stop);
process.on('SIGINT', stop);
process.stderr.on('error', stop);
child.stderr.pipe(process.stderr);
child.once('error', () => process.exit(1));
child.once('exit', (code) => {
  clearTimeout(lease);
  clearTimeout(force);
  process.exit(code ?? 1);
});
`;

async function verifyMemoryIndex(data: string, requireExisting: boolean) {
  const [wiki, directory] = await Promise.all(
    ["wiki", "db"].map((name) =>
      lstat(join(data, name)).catch((error: unknown) => {
        if (
          error instanceof Error &&
          "code" in error &&
          error.code === "ENOENT"
        )
          return null;
        throw error;
      })
    )
  );
  if (!wiki && !directory && !requireExisting) return;
  if (!wiki || !directory)
    throw new Error(
      "Memory requires both its source files and original index."
    );
  const index = await lstat(join(data, "db", "memory.sqlite"));
  if (
    !wiki.isDirectory() ||
    wiki.isSymbolicLink() ||
    !directory.isDirectory() ||
    directory.isSymbolicLink() ||
    !index.isFile() ||
    index.isSymbolicLink() ||
    index.size < 100 ||
    ((wiki.mode | directory.mode | index.mode) & 0o077) !== 0
  )
    throw new Error(
      "Memory requires its original private index or a verified restore."
    );
  // Native startup may create an empty DB when one is missing. Do not launch it
  // against an existing wiki: reindex restores current pages, not all history.
}

async function prepareSessionMemory(
  root: string,
  namespaceId: string,
  corpus: MemoryCorpus,
  requireExisting: boolean
) {
  const namespace = z.uuid().parse(namespaceId);
  const owner = join(root, namespace);
  const data = join(owner, corpus);
  // Check before creating even the parent directories or configuration. A lost
  // accepted volume must never be silently replaced by a fresh native corpus.
  await verifyMemoryIndex(data, requireExisting);
  await privateMemoryDirectory(root);
  await privateMemoryDirectory(owner);
  await privateMemoryDirectory(data);
  const config = join(data, "config.toml");
  try {
    await using file = await open(config, "wx", 0o600);
    await file.writeFile(configuration);
    await file.sync();
  } catch (error) {
    if (
      !(error instanceof Error) ||
      !("code" in error) ||
      error.code !== "EEXIST"
    )
      throw error;
    const info = await lstat(config);
    if (
      !info.isFile() ||
      info.isSymbolicLink() ||
      (info.mode & 0o077) !== 0 ||
      (await readFile(config, "utf8")) !== configuration
    )
      throw new Error(
        "Session memory requires its qualified private configuration.",
        { cause: error }
      );
  }
  await verifyMemoryIndex(data, requireExisting);
  return data;
}

async function launchSessionMemory(binary: string, data: string) {
  // Do not inherit application credentials or upstream provider/dream settings.
  const processEnv = {
    PATH: "/usr/bin:/bin",
    HOME: data,
    RUST_LOG: "info",
    NODE_ENV: "production",
  } satisfies NodeJS.ProcessEnv;
  const version = await promisify(execFile)(binary, ["--version"], {
    env: processEnv,
    timeout: 10_000,
  });
  if (version.stdout.trim() !== "ai-memory 2.4.1")
    throw new Error("Requalify ai-memory before changing the engine version.");
  const token = randomBytes(32).toString("hex");
  const child = spawn(
    process.execPath,
    [
      "--input-type=commonjs",
      "--eval",
      supervisor,
      "--",
      binary,
      "--data-dir",
      data,
      "--config",
      join(data, "config.toml"),
      "serve",
      "--transport",
      "http",
      "--bind",
      "127.0.0.1:0",
    ],
    {
      env: { ...processEnv, AI_MEMORY_AUTH_TOKEN: token },
      cwd: data,
      stdio: ["ignore", "ignore", "pipe", "ipc"],
    }
  );
  const exited = new Promise<void>((resolve) => {
    child.once("exit", () => {
      resolve();
    });
    child.once("error", () => {
      resolve();
    });
  });
  const stop = async () => {
    child.kill("SIGTERM");
    await Promise.race([exited, delay(3_000)]);
    if (child.exitCode === null && child.signalCode === null)
      child.kill("SIGKILL");
    await exited;
  };
  try {
    const address = await sessionMemoryAddress(child);
    return { address, token, stop };
  } catch (error) {
    await stop();
    throw error;
  }
}

function sessionMemoryAddress(child: ChildProcess) {
  return new Promise<URL>((resolve, reject) => {
    let output = "";
    const timer = setTimeout(() => {
      reject(new Error("Session memory did not become ready."));
    }, 15_000);
    const cleanup = () => {
      clearTimeout(timer);
    };
    child.once("error", () => {
      cleanup();
      reject(new Error("Session memory could not start."));
    });
    child.once("exit", () => {
      cleanup();
      reject(new Error("Session memory exited before readiness."));
    });
    child.stderr?.on("data", (chunk: Buffer) => {
      output = (output + stripVTControlCharacters(chunk.toString())).slice(
        -8192
      );
      const match =
        /MCP HTTP server ready[^\n]*local_addr=127\.0\.0\.1:(\d+)/.exec(output);
      if (match?.[1]) {
        cleanup();
        resolve(new URL(`http://127.0.0.1:${match[1]}`));
      }
    });
  });
}

async function deliverSessionBatch(
  address: URL,
  headers: Record<string, string>,
  items: readonly { url: string; body: Record<string, unknown> }[]
) {
  const response = await fetch(new URL("/hook/batch", address), {
    method: "POST",
    headers: { ...headers, "Content-Type": "application/json" },
    body: JSON.stringify(items),
    redirect: "error",
    signal: AbortSignal.timeout(30_000),
  });
  if (response.status !== 200 && response.status !== 429)
    throw new Error("Session memory delivery failed.");
  const receipt = z
    .object({
      accepted: z.number().int().nonnegative().max(items.length),
      accepted_indices: z
        .array(
          z
            .number()
            .int()
            .nonnegative()
            .max(items.length - 1)
        )
        .max(items.length)
        .optional(),
      failed_index: z.number().int().nonnegative().optional(),
    })
    .parse(await response.json());
  const accepted =
    receipt.accepted_indices ??
    Array.from({ length: receipt.accepted }, (_, index) => index);
  if (
    receipt.failed_index !== undefined ||
    new Set(accepted).size !== items.length ||
    accepted.some((index) => index >= items.length)
  )
    throw new Error(
      "Session memory delivery is incomplete; sources remain queued."
    );
}

async function checkpointMemory(address: URL, headers: Record<string, string>) {
  const response = await fetch(new URL("/admin/commit", address), {
    method: "POST",
    headers: { ...headers, "Content-Type": "application/json" },
    body: JSON.stringify({
      message: "Zoen: edit private learned note",
    }),
    redirect: "error",
    signal: AbortSignal.timeout(20_000),
  });
  if (!response.ok) throw new Error("Memory checkpoint failed.");
  const receipt = z
    .object({
      committed: z.boolean(),
      oid: z
        .string()
        .regex(/^[0-9a-f]{40}$/)
        .optional(),
    })
    .parse(await response.json());
  if (receipt.committed && !receipt.oid)
    throw new Error("Memory checkpoint is incomplete.");
}

/** Operator-owned local worker. Never expose its URL, token, or generic MCP to a client/model. */
export async function openMemoryEngine(
  binary: string,
  root: string,
  namespaceId: string,
  corpus: MemoryCorpus,
  options: { requireExisting: boolean }
) {
  const data = await prepareSessionMemory(
    root,
    namespaceId,
    corpus,
    options.requireExisting
  );
  const runtime = await launchSessionMemory(binary, data);
  const client = new Client({ name: "zoen-file-memory", version: "1.0.0" });
  const headers = { Authorization: `Bearer ${runtime.token}` };
  try {
    await client.connect(
      new StreamableHTTPClientTransport(new URL("/mcp", runtime.address), {
        requestInit: { headers, redirect: "error" },
      }),
      { timeout: 15_000 }
    );
    return {
      data,
      client,
      checkpoint: () => checkpointMemory(runtime.address, headers),
      deliver: (items: Parameters<typeof deliverSessionBatch>[2]) =>
        deliverSessionBatch(runtime.address, headers, items),
      async [Symbol.asyncDispose]() {
        try {
          await client.close();
        } finally {
          await runtime.stop();
        }
      },
    };
  } catch (error) {
    try {
      await client.close();
    } finally {
      await runtime.stop();
    }
    throw error;
  }
}
