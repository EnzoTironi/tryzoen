import { spawn } from "node:child_process";
import {
  mkdtemp,
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
async function cli(args: string[], preload?: string) {
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
  const code = await new Promise<number | null>((resolve, reject) => {
    child.once("error", reject);
    child.once("close", resolve);
  });
  expect(output).not.toContain("private-access-sentinel");
  expect(output).not.toContain("private-secret-sentinel");
  expect(output).not.toContain("private-control-sentinel");
  return {
    code,
    result: z.record(z.string(), z.unknown()).parse(JSON.parse(output.trim())),
  };
}

/** Native SDK over HTTP; the fixture owns only synthetic objects. */
async function s3() {
  const objects = new Map<
    string,
    { bytes: Buffer; metadata: Record<string, string> }
  >();
  const attempts: { method: string; path: string; authorized: boolean }[] = [];
  let losePut = false;
  let refuseHead = false;
  let corruptOwnership = false;
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
      error(403, "AccessDenied");
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
