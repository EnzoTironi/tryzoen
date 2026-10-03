import { spawn } from "node:child_process";
import { createHash } from "node:crypto";
import type { ChildProcess } from "node:child_process";
import {
  mkdtemp,
  open,
  readFile,
  realpath,
  rm,
  stat,
  symlink,
  writeFile,
} from "node:fs/promises";
import { createServer } from "node:http";
import type { IncomingMessage, ServerResponse } from "node:http";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { setTimeout as delay } from "node:timers/promises";
import { afterEach, expect, it } from "vitest";
import { z } from "zod";

const directories: string[] = [];
afterEach(async () => {
  await Promise.all(
    directories
      .splice(0)
      .map((path) => rm(path, { recursive: true, force: true }))
  );
});
async function directory() {
  const path = await realpath(await mkdtemp(join(tmpdir(), "zoen-r2-test-")));
  directories.push(path);
  return path;
}
async function cli(
  args: string[],
  preload?: string,
  beforeCompletion?: (child: ChildProcess) => Promise<void>
) {
  const child = spawn(
    process.execPath,
    [
      "--import",
      "tsx",
      ...(preload ? ["--import", preload] : []),
      "scripts/qualify-r2.ts",
      ...args,
    ],
    {
      env: {
        PATH: process.env.PATH,
        NODE_ENV: "test",
        // Sentinels must never reach local transport or receipts.
        ZOEN_R2_QUALIFICATION_ACCESS_KEY: "private-access-sentinel",
        ZOEN_R2_QUALIFICATION_SECRET_KEY: "private-secret-sentinel",
        ZOEN_R2_QUALIFICATION_API_TOKEN: "private-control-sentinel",
      },
      stdio: ["ignore", "pipe", "pipe"],
    }
  );
  let output = "";
  child.stdout.on("data", (chunk: Buffer) => {
    output += chunk.toString();
  });
  child.stderr.on("data", (chunk: Buffer) => {
    output += chunk.toString();
  });
  const completion = new Promise<number | null>((resolve, reject) => {
    child.once("error", reject);
    child.once("close", resolve);
  });
  try {
    await beforeCompletion?.(child);
  } catch (error) {
    child.kill();
    await completion;
    throw error;
  }
  const code = await completion;
  expect(output).not.toContain("private-access-sentinel");
  expect(output).not.toContain("private-secret-sentinel");
  expect(output).not.toContain("private-control-sentinel");
  return {
    code,
    result: z.record(z.string(), z.unknown()).parse(JSON.parse(output.trim())),
  };
}

/** Native SDK over HTTP; the fixture owns only synthetic objects. */
async function s3(anonymous?: { status: number; body: string }) {
  const objects = new Map<
    string,
    { bytes: Buffer; metadata: Record<string, string> }
  >();
  const attempts: { method: string; path: string; authorized: boolean }[] = [];
  let losePut = false;
  let refuseHead = false;
  let corruptOwnership = false;
  let holdDelete = false;
  let releaseDelete: (() => void) | undefined;
  async function handle(request: IncomingMessage, response: ServerResponse) {
    const path = new URL(request.url ?? "/", "http://127.0.0.1").pathname;
    const method = request.method ?? "GET";
    const authorization = request.headers.authorization;
    const authorized =
      authorization?.includes("Credential=zoen-local-qualification/") ?? false;
    attempts.push({ method, path, authorized });
    function error(status: number, code: string) {
      response.writeHead(status, { "content-type": "application/xml" });
      response.end(
        `<Error><Code>${code}</Code><Message>synthetic fixture</Message></Error>`
      );
    }
    if (!authorized) {
      if (anonymous) {
        response.writeHead(anonymous.status, {
          "content-type": "application/xml",
          ...(anonymous.status === 302 ? { location: "/must-not-follow" } : {}),
        });
        response.end(anonymous.body);
      } else error(403, "AccessDenied");
      return;
    }
    if (path === "/qualification-bucket/" || path === "/qualification-bucket") {
      response.writeHead(200);
      response.end();
      return;
    }
    if (method === "PUT") {
      if (objects.has(path) && request.headers["if-none-match"] === "*") {
        request.resume();
        error(412, "PreconditionFailed");
        return;
      }
      const chunks: Buffer[] = [];
      for await (const chunk of request)
        chunks.push(Buffer.from(z.instanceof(Uint8Array).parse(chunk)));
      const metadata: Record<string, string> = {};
      for (const [name, value] of Object.entries(request.headers)) {
        if (name.startsWith("x-amz-meta-") && typeof value === "string")
          metadata[name.slice(11)] = value;
      }
      objects.set(path, { bytes: Buffer.concat(chunks), metadata });
      if (losePut) {
        request.socket.destroy();
        return;
      }
      response.writeHead(200, { etag: '"synthetic-etag"' });
      response.end();
      return;
    }
    const object = objects.get(path);
    if (!object) {
      error(404, "NoSuchKey");
      return;
    }
    if (method === "HEAD" && refuseHead) {
      error(503, "SlowDown");
      return;
    }
    if (method === "DELETE") {
      objects.delete(path);
      if (holdDelete) {
        holdDelete = false;
        await new Promise<void>((resolve) => {
          releaseDelete = resolve;
        });
      }
      response.writeHead(204);
      response.end();
      return;
    }
    const metadata = { ...object.metadata };
    if (corruptOwnership) metadata["qualification-run"] = "foreign-owner";
    response.writeHead(200, {
      "content-length": object.bytes.byteLength,
      ...Object.fromEntries(
        Object.entries(metadata).map(([name, value]) => [
          `x-amz-meta-${name}`,
          value,
        ])
      ),
    });
    response.end(method === "HEAD" ? undefined : object.bytes);
  }
  const server = createServer((request, response) => {
    void handle(request, response).catch(() => {
      response.destroy();
    });
  });
  await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
  const address = server.address();
  if (!address || typeof address === "string")
    throw new Error("Missing HTTP fixture address");
  return {
    endpoint: `http://127.0.0.1:${address.port}`,
    objects,
    attempts,
    losePut: () => {
      losePut = true;
    },
    refuseHead: () => {
      refuseHead = true;
    },
    corruptOwnership: () => {
      corruptOwnership = true;
    },
    recover: () => {
      losePut = false;
      refuseHead = false;
      corruptOwnership = false;
    },
    holdDelete: () => {
      holdDelete = true;
    },
    waitingForDelete: () => releaseDelete !== undefined,
    releaseDelete: () => {
      releaseDelete?.();
    },
    async [Symbol.asyncDispose]() {
      server.closeAllConnections();
      await new Promise<void>((resolve, reject) =>
        server.close((error) => {
          if (error) reject(error);
          else resolve();
        })
      );
    },
  };
}
function runArgs(endpoint: string, path: string, extra: string[] = []) {
  return [
    "run",
    "--local",
    "--endpoint",
    endpoint,
    "--bucket",
    "qualification-bucket",
    "--output-dir",
    path,
    ...extra,
  ];
}
function cleanupArgs(endpoint: string, path: string) {
  return [
    "cleanup",
    "--local",
    "--endpoint",
    endpoint,
    "--bucket",
    "qualification-bucket",
    "--manifest",
    join(path, "manifest.json"),
  ];
}

it("plans a Cloudflare run without credentials, network, or filesystem effects", async () => {
  const result = await cli([
    "plan",
    "--endpoint",
    `https://${"a".repeat(32)}.eu.r2.cloudflarestorage.com`,
    "--bucket",
    "qualification-bucket",
    "--denied-bucket",
    "denied-bucket",
  ]);
  expect(result.code).toBe(0);
  expect(result.result).toMatchObject({
    providerQualified: false,
    networkRequests: 0,
    maxRequests: 100,
    maxPutBytes: 1048576,
  });
});

it.each([
  "managed-public",
  "custom-public",
  "unsuccessful",
  "wrong-bucket",
  "oversized",
])(
  "fails closed on Cloudflare control response %s before any object write",
  async (scenario) => {
    const root = await directory();
    const preload = join(root, "control-fixture.mjs");
    // Imported fetch boundary only; these synthetic token values never reach a network.
    await writeFile(
      preload,
      `
globalThis.fetch = async (url, options) => {
  if (!String(url).startsWith("https://api.cloudflare.com/client/v4/accounts/")) throw new Error("Unexpected network target");
  if (options.redirect !== "error" || options.headers.Authorization !== "Bearer private-control-sentinel") throw new Error("Invalid control request");
  const scenario = ${JSON.stringify(scenario)};
  const suffix = String(url).split("/").at(-1);
  const result = suffix === "managed" ? { enabled: scenario === "managed-public" } : suffix === "custom" ? { domains: [{ enabled: scenario === "custom-public" }] } : { name: "different-bucket" };
  return new Response(scenario === "oversized" ? "x".repeat(65537) : JSON.stringify({ success: scenario !== "unsuccessful", result }), { status: 200 });
};`,
      { mode: 0o600 }
    );
    const path = join(root, "run");
    const failed = await cli(
      [
        "run",
        "--endpoint",
        `https://${"a".repeat(32)}.r2.cloudflarestorage.com`,
        "--bucket",
        "qualification-bucket",
        "--denied-bucket",
        "denied-bucket",
        "--output-dir",
        path,
      ],
      preload
    );
    expect(failed.code).toBe(1);
    expect(failed.result).toMatchObject({
      providerQualified: false,
      cleanupComplete: true,
      putBytes: 0,
    });
    const manifest = z
      .object({
        objects: z.array(z.unknown()),
        requests: z.number(),
        phase: z.literal("failed"),
      })
      .parse(JSON.parse(await readFile(join(path, "manifest.json"), "utf8")));
    expect(manifest.objects).toEqual([]);
    expect(manifest.requests).toBe(
      scenario === "custom-public" ? 2 : scenario === "wrong-bucket" ? 3 : 1
    );
  }
);

it.each([
  ["https://example.com", false],
  ["http://127.0.0.1:9000/path", true],
  ["http://localhost:9000", true],
  ["http://169.254.169.254", true],
  [`https://secret@${"a".repeat(32)}.r2.cloudflarestorage.com`, false],
])("refuses unsafe endpoint %s", async (endpoint, local) => {
  const result = await cli([
    "plan",
    ...(local ? ["--local"] : []),
    "--endpoint",
    endpoint,
    "--bucket",
    "qualification-bucket",
    "--denied-bucket",
    "denied-bucket",
  ]);
  expect(result.code).toBe(1);
  expect(result.result.providerQualified).toBe(false);
});

it("uses real SDK conditional writes, bounded digest reads, and exact-key cleanup without qualifying Cloudflare", async () => {
  await using fixture = await s3();
  const path = join(await directory(), "run");
  const result = await cli(runArgs(fixture.endpoint, path));
  expect(result.code).toBe(0);
  expect(result.result).toMatchObject({
    localTransportPassed: true,
    providerQualified: false,
    cleanupComplete: true,
    requests: 25,
    putBytes: 24576,
    anonymousRead: {
      method: "GET",
      status: 403,
      responseBytes: 76,
      responseSha256: createHash("sha256")
        .update(
          "<Error><Code>AccessDenied</Code><Message>synthetic fixture</Message></Error>"
        )
        .digest("hex"),
    },
  });
  expect(result.result.checks).toEqual([
    "immutable-write",
    "missing-object",
    "bounded-read",
    "digest-rejection",
    "discarded-receipt-retry",
    "anonymous-denial",
  ]);
  expect(fixture.objects.size).toBe(0);
  expect(fixture.attempts).toHaveLength(25);
  expect(
    fixture.attempts.filter((attempt) => !attempt.authorized)
  ).toHaveLength(1);
  expect(
    fixture.attempts.some(
      (attempt) =>
        attempt.method === "DELETE" &&
        !attempt.path.includes(
          `/qualification/${z.uuid().parse(result.result.runId)}/`
        )
    )
  ).toBe(false);
  expect((await stat(path)).mode & 0o777).toBe(0o700);
  expect((await stat(join(path, "manifest.json"))).mode & 0o777).toBe(0o600);
  const manifest = await readFile(join(path, "manifest.json"), "utf8");
  expect(manifest).not.toContain("sentinel");
  const cleaned = await cli(cleanupArgs(fixture.endpoint, path));
  expect(cleaned.code).toBe(0);
  expect(fixture.attempts).toHaveLength(25);
});

it.each([
  [
    "R2 missing authorization",
    400,
    '<?xml version="1.0" encoding="UTF-8"?><Error><Code>InvalidArgument</Code><Message>Authorization</Message></Error>',
    true,
  ],
  ["generic bad request", 400, "Bad request", false],
  [
    "another invalid argument",
    400,
    '<?xml version="1.0" encoding="UTF-8"?><Error><Code>InvalidArgument</Code><Message>Bucket</Message></Error>',
    false,
  ],
  [
    "embedded authorization XML",
    400,
    '<html><?xml version="1.0" encoding="UTF-8"?><Error><Code>InvalidArgument</Code><Message>Authorization</Message></Error></html>',
    false,
  ],
  [
    "successful authorization-shaped body",
    200,
    '<?xml version="1.0" encoding="UTF-8"?><Error><Code>InvalidArgument</Code><Message>Authorization</Message></Error>',
    false,
  ],
  ["successful object read", 200, "synthetic object bytes", false],
  ["oversized error", 400, "x".repeat(4097), false],
  ["redirect", 302, "Redirect", false],
] as const)(
  "checks an actual anonymous GET and fails closed on %s",
  async (_, status, body, denied) => {
    await using fixture = await s3({ status, body });
    const path = join(await directory(), "run");
    const result = await cli(runArgs(fixture.endpoint, path));
    expect(result.code).toBe(denied ? 0 : 1);
    expect(result.result).toMatchObject({
      localTransportPassed: denied,
      providerQualified: false,
      cleanupComplete: true,
    });
    const unsigned = fixture.attempts.filter((attempt) => !attempt.authorized);
    expect(unsigned).toHaveLength(1);
    expect(unsigned[0]).toMatchObject({ method: "GET" });
    expect(fixture.objects.size).toBe(0);
    const checks = z.array(z.string()).parse(result.result.checks);
    expect(checks.includes("anonymous-denial")).toBe(denied);
  }
);

it("persists unknown writes, never retries automatically, and cleans them in a later invocation", async () => {
  await using fixture = await s3();
  fixture.losePut();
  fixture.refuseHead();
  const path = join(await directory(), "run");
  const failed = await cli(runArgs(fixture.endpoint, path));
  expect(failed.code).toBe(1);
  expect(failed.result).toMatchObject({
    providerQualified: false,
    cleanupComplete: false,
  });
  expect(
    fixture.attempts.filter((attempt) => attempt.method === "PUT")
  ).toHaveLength(1);
  expect(fixture.objects.size).toBe(1);
  fixture.recover();
  const cleaned = await cli(cleanupArgs(fixture.endpoint, path));
  expect(cleaned.code).toBe(0);
  expect(cleaned.result).toMatchObject({
    providerQualified: false,
    cleanupComplete: true,
    requests: 6,
  });
  expect(fixture.objects.size).toBe(0);
});

it("loads cleanup state under the lock after another writer advances the manifest", async () => {
  await using fixture = await s3();
  fixture.losePut();
  fixture.refuseHead();
  const root = await directory();
  const path = join(root, "run");
  expect((await cli(runArgs(fixture.endpoint, path))).code).toBe(1);
  fixture.recover();
  const preload = join(root, "pause-lock.mjs");
  const paused = join(root, "paused");
  const resume = join(root, "resume");
  await writeFile(
    preload,
    `
import fs from "node:fs/promises";
import {syncBuiltinESMExports} from "node:module";
import {setTimeout as delay} from "node:timers/promises";
const original = fs.open;
fs.open = async (...args) => {
  if (String(args[0]).endsWith("/run.lock")) {
    await fs.writeFile(${JSON.stringify(paused)}, "paused", {mode: 0o600});
    const deadline = Date.now() + 3000;
    for (;;) {
      try { await fs.access(${JSON.stringify(resume)}); break; } catch {}
      if (Date.now() > deadline) throw new Error("Fixture lock barrier timed out");
      await delay(10);
    }
  }
  return original(...args);
};
syncBuiltinESMExports();`,
    { mode: 0o600 }
  );
  let advancedRequests = 0;
  const cleaned = await cli(
    cleanupArgs(fixture.endpoint, path),
    preload,
    async () => {
      const until = Date.now() + 2000;
      for (;;) {
        const ready = await readFile(paused).then(
          () => true,
          () => false
        );
        if (ready) break;
        if (Date.now() > until)
          throw new Error("Cleanup never reached lock barrier");
        await delay(10);
      }
      // A separate writer holds the same public file lock while advancing durable intent.
      const lockPath = join(path, "run.lock");
      const lock = await open(lockPath, "wx", 0o600);
      try {
        const manifestPath = join(path, "manifest.json");
        const manifest = z
          .looseObject({
            runId: z.uuid(),
            requests: z.number(),
            objects: z.array(z.object({ name: z.string(), state: z.string() })),
          })
          .parse(JSON.parse(await readFile(manifestPath, "utf8")));
        manifest.requests += 7;
        advancedRequests = manifest.requests;
        manifest.objects.push({ name: "discarded-receipt", state: "pending" });
        await writeFile(manifestPath, JSON.stringify(manifest), {
          mode: 0o600,
        });
        fixture.objects.set(
          `/qualification-bucket/qualification/${manifest.runId}/discarded-receipt`,
          {
            bytes: Buffer.alloc(4096, 3),
            metadata: {
              "qualification-run": manifest.runId,
              "qualification-name": "discarded-receipt",
            },
          }
        );
      } finally {
        await lock.close();
        await rm(lockPath);
      }
      await writeFile(resume, "resume", { mode: 0o600 });
    }
  );
  expect(cleaned.code).toBe(0);
  expect(cleaned.result).toMatchObject({
    requests: advancedRequests + 6,
    cleanupComplete: true,
    providerQualified: false,
  });
  expect(fixture.objects.size).toBe(0);
});

it("finishes exact-key cleanup after interruption without qualifying the run", async () => {
  await using fixture = await s3();
  fixture.holdDelete();
  const path = join(await directory(), "run");
  const stopped = await cli(
    runArgs(fixture.endpoint, path),
    undefined,
    async (child) => {
      const until = Date.now() + 3000;
      while (!fixture.waitingForDelete()) {
        if (Date.now() > until)
          throw new Error("Cleanup did not reach the delete barrier");
        await delay(10);
      }
      child.kill("SIGTERM");
      await delay(30);
      fixture.releaseDelete();
    }
  );
  expect(stopped.code).toBe(130);
  expect(stopped.result).toMatchObject({
    cleanupComplete: true,
    providerQualified: false,
    localTransportPassed: false,
    failure: "qualification_interrupted",
  });
  expect(fixture.objects.size).toBe(0);
});

it("reserves cleanup requests when the qualification budget runs out", async () => {
  await using fixture = await s3();
  const path = join(await directory(), "run");
  const failed = await cli(
    runArgs(fixture.endpoint, path, ["--max-requests", "15"])
  );
  expect(failed.code).toBe(1);
  expect(failed.result).toMatchObject({
    failure: "request_budget_exhausted",
    cleanupComplete: true,
    providerQualified: false,
  });
  expect(fixture.attempts.length).toBeLessThanOrEqual(15);
  expect(fixture.objects.size).toBe(0);
});

it("retains objects with changed ownership and rejects a different cleanup target", async () => {
  await using fixture = await s3();
  fixture.corruptOwnership();
  const path = join(await directory(), "run");
  const failed = await cli(runArgs(fixture.endpoint, path));
  expect(failed.code).toBe(1);
  expect(failed.result.cleanupComplete).toBe(false);
  expect(fixture.attempts.some((attempt) => attempt.method === "DELETE")).toBe(
    false
  );
  const attempts = fixture.attempts.length;
  const wrong = await cli(cleanupArgs("http://127.0.0.1:1", path));
  expect(wrong.code).toBe(1);
  expect(wrong.result.failure).toBe("cleanup_target_must_match_manifest");
  expect(fixture.attempts).toHaveLength(attempts);
  fixture.recover();
  expect((await cli(cleanupArgs(fixture.endpoint, path))).code).toBe(0);
  expect(fixture.objects.size).toBe(0);
});

it("refuses symlinked or malformed private manifests before network access", async () => {
  const root = await directory();
  const original = join(root, "original.json");
  await writeFile(original, "{}", { mode: 0o600 });
  await symlink(original, join(root, "manifest.json"));
  expect((await cli(cleanupArgs("http://127.0.0.1:1", root))).code).toBe(1);
  await rm(join(root, "manifest.json"));
  await writeFile(
    join(root, "manifest.json"),
    JSON.stringify({ version: 1, objects: [{ name: "../../foreign" }] }),
    { mode: 0o600 }
  );
  expect((await cli(cleanupArgs("http://127.0.0.1:1", root))).code).toBe(1);
});
