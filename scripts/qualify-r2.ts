import { createHash, randomUUID } from "node:crypto";
import { constants } from "node:fs";
import { lstat, mkdir, open, realpath, rename, rm } from "node:fs/promises";
import { basename, dirname, isAbsolute, join, resolve } from "node:path";
import { parseArgs } from "node:util";
import {
  DeleteObjectCommand,
  GetObjectCommand,
  HeadBucketCommand,
  HeadObjectCommand,
  PutObjectCommand,
  S3Client,
  S3ServiceException,
} from "@aws-sdk/client-s3";
import { z } from "zod";
import { r2QualificationEnvironment } from "../shared/environment/env/r2-qualification";
import { BodyTooLarge, readBody } from "../server/http/body";
import { operationSignal, withDeadline } from "../server/operations/async";

const maxBytes = 1024 * 1024;
const lifetimeMs = 15 * 60_000;
const cleanupReserve = 9;
const names = ["immutable", "wrong-digest", "discarded-receipt"] as const;
const checks = [
  "private-settings",
  "credential-scope",
  "immutable-write",
  "missing-object",
  "bounded-read",
  "digest-rejection",
  "discarded-receipt-retry",
  "anonymous-denial",
] as const;
const bucketName = z.string().regex(/^[a-z0-9][a-z0-9-]{1,61}[a-z0-9]$/u);
const manifestSchema = z.strictObject({
  version: z.literal(1),
  runId: z.uuid(),
  mode: z.enum(["cloudflare", "local"]),
  endpoint: z.url(),
  bucket: bucketName,
  deniedBucket: bucketName.optional(),
  startedAt: z.iso.datetime(),
  maxRequests: z.number().int().min(15).max(100),
  requests: z.number().int().min(0).max(100),
  putBytes: z.number().int().min(0).max(maxBytes),
  phase: z.enum(["running", "passed", "failed"]),
  checks: z.array(z.enum(checks)).max(checks.length),
  objects: z
    .array(
      z.strictObject({
        name: z.enum(names),
        state: z.enum(["pending", "deleted"]),
      })
    )
    .max(names.length),
});
type Manifest = z.infer<typeof manifestSchema>;
class QualificationFailure extends Error {}
function requireCheck(value: unknown, code: string): asserts value {
  if (!value) throw new QualificationFailure(code);
}
function digest(bytes: Uint8Array) {
  return createHash("sha256").update(bytes).digest("hex");
}
function payload(name: (typeof names)[number]) {
  return Buffer.alloc(4096, names.indexOf(name) + 1);
}
function status(error: unknown) {
  return error instanceof S3ServiceException
    ? error.$metadata.httpStatusCode
    : undefined;
}
async function expectStatus(run: () => Promise<unknown>, expected: number[]) {
  try {
    await run();
  } catch (error) {
    if (expected.includes(status(error) ?? 0)) return;
    throw error;
  }
  throw new QualificationFailure("expected_request_denial");
}

function target(endpoint: string, local: boolean) {
  const url = new URL(endpoint);
  requireCheck(
    !url.username &&
      !url.password &&
      !url.search &&
      !url.hash &&
      url.pathname === "/",
    "endpoint_must_be_an_origin"
  );
  if (local) {
    requireCheck(
      url.protocol === "http:" && ["127.0.0.1", "[::1]"].includes(url.hostname),
      "local_endpoint_must_be_loopback_http"
    );
    return {
      endpoint: url.origin,
      account: undefined,
      jurisdiction: "default",
    };
  }
  const match =
    /^([a-f0-9]{32})(?:\.(eu|fedramp))?\.r2\.cloudflarestorage\.com$/u.exec(
      url.hostname
    );
  requireCheck(
    url.protocol === "https:" && !url.port && match?.[1],
    "endpoint_must_be_a_cloudflare_r2_account"
  );
  return {
    endpoint: url.origin,
    account: match[1],
    jurisdiction: match[2] ?? "default",
  };
}

async function privateDirectory(path: string) {
  const info = await lstat(path);
  requireCheck(
    info.isDirectory() &&
      (info.mode & 0o077) === 0 &&
      (process.getuid === undefined || info.uid === process.getuid()) &&
      (await realpath(path)) === resolve(path),
    "manifest_directory_must_be_private_and_not_symlinked"
  );
}
async function save(path: string, manifest: Manifest) {
  const temporary = `${path}.${randomUUID()}.tmp`;
  const file = await open(temporary, "wx", 0o600);
  try {
    await file.writeFile(JSON.stringify(manifest, null, 2));
    await file.sync();
  } finally {
    await file.close();
  }
  await rename(temporary, path);
  const directory = await open(dirname(path), "r");
  try {
    await directory.sync();
  } finally {
    await directory.close();
  }
}
async function load(path: string) {
  requireCheck(
    isAbsolute(path) && basename(path) === "manifest.json",
    "invalid_manifest_path"
  );
  await privateDirectory(dirname(path));
  const file = await open(path, constants.O_RDONLY | constants.O_NOFOLLOW);
  try {
    const info = await file.stat();
    requireCheck(
      info.isFile() &&
        info.size <= 64 * 1024 &&
        (info.mode & 0o077) === 0 &&
        (process.getuid === undefined || info.uid === process.getuid()),
      "manifest_must_be_a_private_regular_file"
    );
    const manifest = manifestSchema.parse(
      JSON.parse(await file.readFile("utf8"))
    );
    requireCheck(
      manifest.requests <= manifest.maxRequests &&
        new Set(manifest.objects.map((object) => object.name)).size ===
          manifest.objects.length &&
        new Set(manifest.checks).size === manifest.checks.length,
      "invalid_manifest_state"
    );
    return manifest;
  } finally {
    await file.close();
  }
}

async function locked<Value>(path: string, run: () => Promise<Value>) {
  const lockPath = join(dirname(path), "run.lock");
  const lock = await open(lockPath, "wx", 0o600);
  try {
    await lock.writeFile(String(process.pid));
    return await run();
  } finally {
    await lock.close();
    await rm(lockPath);
  }
}

const stopping = new AbortController();
for (const signal of ["SIGINT", "SIGTERM"] as const)
  process.once(signal, () => {
    stopping.abort();
  });

async function qualify(
  command: "run" | "cleanup",
  path: string,
  manifest: Manifest
) {
  const selected = target(manifest.endpoint, manifest.mode === "local");
  // Local qualification cannot forward any Cloudflare or application credentials.
  const credentials =
    manifest.mode === "local" ? undefined : r2QualificationEnvironment();
  const accessKeyId = credentials?.ZOEN_R2_QUALIFICATION_ACCESS_KEY?.reveal();
  const secretAccessKey =
    credentials?.ZOEN_R2_QUALIFICATION_SECRET_KEY?.reveal();
  const apiToken = credentials?.ZOEN_R2_QUALIFICATION_API_TOKEN?.reveal();
  requireCheck(
    manifest.mode === "local" ||
      (accessKeyId && secretAccessKey && (command === "cleanup" || apiToken)),
    "missing_r2_qualification_credential_reference"
  );
  let cleaning = command === "cleanup";
  const deadline = Date.now() + lifetimeMs;
  const client = new S3Client({
    endpoint: selected.endpoint,
    region: "auto",
    forcePathStyle: true,
    maxAttempts: 1,
    followRegionRedirects: false,
    requestChecksumCalculation: "WHEN_REQUIRED",
    responseChecksumValidation: "WHEN_REQUIRED",
    credentials: {
      accessKeyId: accessKeyId ?? "zoen-local-qualification",
      secretAccessKey: secretAccessKey ?? "zoen-local-qualification-secret",
      sessionToken: credentials?.ZOEN_R2_QUALIFICATION_SESSION_TOKEN?.reveal(),
    },
  });
  async function reserve(bytes = 0) {
    requireCheck(
      manifest.requests <
        manifest.maxRequests - (cleaning ? 0 : cleanupReserve),
      "request_budget_exhausted"
    );
    requireCheck(
      manifest.putBytes + bytes <= maxBytes,
      "put_byte_budget_exhausted"
    );
    requireCheck(Date.now() < deadline, "run_deadline_exceeded");
    manifest.requests++;
    manifest.putBytes += bytes;
    await save(path, manifest);
  }
  client.middlewareStack.add(
    (next) => async (args) => {
      const wireRequest = z
        .object({
          method: z.string(),
          body: z.instanceof(Uint8Array).optional(),
        })
        .parse(args.request);
      await reserve(
        wireRequest.method === "PUT" ? (wireRequest.body?.byteLength ?? 0) : 0
      );
      return next(args);
    },
    { step: "finalizeRequest", priority: "low", name: "qualificationBudget" }
  );
  async function request<Value>(run: () => Promise<Value>) {
    if (!cleaning) stopping.signal.throwIfAborted();
    return withDeadline(run, Math.min(deadline, Date.now() + 10_000));
  }
  function signal() {
    return cleaning
      ? operationSignal()
      : AbortSignal.any([operationSignal(), stopping.signal]);
  }
  const key = (name: (typeof names)[number]) =>
    `qualification/${manifest.runId}/${name}`;
  async function head(name: (typeof names)[number]) {
    return request(() =>
      client.send(
        new HeadObjectCommand({ Bucket: manifest.bucket, Key: key(name) }),
        { abortSignal: signal() }
      )
    );
  }
  async function put(name: (typeof names)[number], bytes = payload(name)) {
    if (!manifest.objects.some((object) => object.name === name)) {
      manifest.objects.push({ name, state: "pending" });
      await save(path, manifest);
    }
    return request(() =>
      client.send(
        new PutObjectCommand({
          Bucket: manifest.bucket,
          Key: key(name),
          Body: bytes,
          IfNoneMatch: "*",
          Metadata: {
            "qualification-run": manifest.runId,
            "qualification-name": name,
            sha256: name === "wrong-digest" ? "0".repeat(64) : digest(bytes),
          },
        }),
        { abortSignal: signal() }
      )
    );
  }
  async function read(name: (typeof names)[number], limit = 4096) {
    return request(async () => {
      const object = await client.send(
        new GetObjectCommand({ Bucket: manifest.bucket, Key: key(name) }),
        { abortSignal: signal() }
      );
      requireCheck(object.Body, "missing_response_body");
      const bytes = await readBody(object.Body.transformToWebStream(), limit);
      const metadata = object.Metadata ?? {};
      requireCheck(
        bytes.byteLength === 4096 &&
          object.ContentLength === bytes.byteLength &&
          metadata["qualification-run"] === manifest.runId &&
          metadata["qualification-name"] === name &&
          metadata.sha256 === digest(bytes) &&
          digest(bytes) === digest(payload(name)),
        "object_integrity_rejected"
      );
    });
  }
  async function control(suffix: string, schema: z.ZodType) {
    requireCheck(
      selected.account && apiToken,
      "missing_cloudflare_control_credentials"
    );
    return request(async () => {
      await reserve();
      const response = await fetch(
        `https://api.cloudflare.com/client/v4/accounts/${selected.account}/r2/buckets/${suffix}`,
        {
          headers: {
            Authorization: `Bearer ${apiToken}`,
            "cf-r2-jurisdiction": selected.jurisdiction,
          },
          redirect: "error",
          signal: signal(),
        }
      );
      const bytes = await readBody(response.body, 64 * 1024);
      requireCheck(response.ok, "cloudflare_control_read_failed");
      return z
        .object({ success: z.literal(true), result: schema })
        .parse(JSON.parse(bytes.toString("utf8"))).result;
    });
  }
  async function privateSettings() {
    const managed = await control(
      `${manifest.bucket}/domains/managed`,
      z.object({ enabled: z.literal(false) })
    );
    const custom = await control(
      `${manifest.bucket}/domains/custom`,
      z.object({ domains: z.array(z.object({ enabled: z.literal(false) })) })
    );
    requireCheck(managed && custom, "public_bucket_access_enabled");
  }
  async function clean() {
    cleaning = true;
    for (const object of manifest.objects) {
      if (object.state === "deleted") continue;
      try {
        const existing = await head(object.name).catch((error: unknown) => {
          if (status(error) === 404) return undefined;
          throw error;
        });
        if (existing) {
          const metadata = existing.Metadata ?? {};
          requireCheck(
            metadata["qualification-run"] === manifest.runId &&
              metadata["qualification-name"] === object.name,
            "cleanup_object_ownership_mismatch"
          );
          await request(() =>
            client.send(
              new DeleteObjectCommand({
                Bucket: manifest.bucket,
                Key: key(object.name),
              }),
              { abortSignal: signal() }
            )
          );
          await expectStatus(() => head(object.name), [404]);
        }
        object.state = "deleted";
        await save(path, manifest);
      } catch {
        // Retain the exact key for a separate bounded cleanup; never list a prefix.
      }
    }
  }
  let failure: string | undefined;
  try {
    if (command === "run") {
      if (manifest.mode === "cloudflare") {
        await privateSettings();
        manifest.checks.push("private-settings");
        requireCheck(
          manifest.deniedBucket && manifest.deniedBucket !== manifest.bucket,
          "distinct_existing_denied_bucket_required"
        );
        await control(
          manifest.deniedBucket,
          z.object({ name: z.literal(manifest.deniedBucket) })
        );
      }
      await request(() =>
        client.send(new HeadBucketCommand({ Bucket: manifest.bucket }), {
          abortSignal: signal(),
        })
      );
      if (manifest.mode === "cloudflare") {
        await expectStatus(
          () =>
            request(() =>
              client.send(
                new HeadBucketCommand({ Bucket: manifest.deniedBucket }),
                { abortSignal: signal() }
              )
            ),
          [403, 404]
        );
        manifest.checks.push("credential-scope");
      }
      await put("immutable");
      await head("immutable");
      await read("immutable");
      await expectStatus(() => put("immutable"), [412]);
      await expectStatus(() => put("immutable", Buffer.alloc(4096, 9)), [412]);
      await read("immutable");
      manifest.checks.push("immutable-write");
      await expectStatus(
        () =>
          request(() =>
            client.send(
              new GetObjectCommand({
                Bucket: manifest.bucket,
                Key: `qualification/${manifest.runId}/missing`,
              }),
              { abortSignal: signal() }
            )
          ),
        [404]
      );
      manifest.checks.push("missing-object");
      try {
        await read("immutable", 1024);
        throw new QualificationFailure("read_limit_not_enforced");
      } catch (error) {
        if (!(error instanceof BodyTooLarge)) throw error;
      }
      manifest.checks.push("bounded-read");
      await put("wrong-digest");
      try {
        await read("wrong-digest");
        throw new QualificationFailure("wrong_digest_not_rejected");
      } catch (error) {
        if (
          !(
            error instanceof QualificationFailure &&
            error.message === "object_integrity_rejected"
          )
        )
          throw error;
      }
      manifest.checks.push("digest-rejection");
      // Deliberately discard this successful acknowledgement, then reconcile by key.
      await put("discarded-receipt");
      await head("discarded-receipt");
      await read("discarded-receipt");
      await expectStatus(() => put("discarded-receipt"), [412]);
      manifest.checks.push("discarded-receipt-retry");
      await request(async () => {
        await reserve();
        const response = await fetch(
          `${selected.endpoint}/${manifest.bucket}/${key("immutable")}`,
          { method: "HEAD", redirect: "error", signal: signal() }
        );
        requireCheck(
          [401, 403].includes(response.status),
          "anonymous_object_read_not_denied"
        );
      });
      manifest.checks.push("anonymous-denial");
      if (manifest.mode === "cloudflare") await privateSettings();
      manifest.phase = "passed";
      await save(path, manifest);
    }
  } catch (error) {
    failure =
      error instanceof QualificationFailure
        ? error.message
        : "qualification_request_failed";
    manifest.phase = "failed";
    await save(path, manifest);
  } finally {
    try {
      await clean();
    } finally {
      client.destroy();
    }
  }
  if (stopping.signal.aborted && command === "run") {
    manifest.phase = "failed";
    failure = "qualification_interrupted";
    await save(path, manifest);
  }
  const cleanupComplete = manifest.objects.every(
    (object) => object.state === "deleted"
  );
  const passed = manifest.phase === "passed" && cleanupComplete;
  const providerQualified =
    command === "run" &&
    passed &&
    manifest.mode === "cloudflare" &&
    checks.every((check) => manifest.checks.includes(check));
  console.log(
    JSON.stringify({
      command,
      manifest: path,
      runId: manifest.runId,
      mode: manifest.mode,
      requests: manifest.requests,
      maxRequests: manifest.maxRequests,
      putBytes: manifest.putBytes,
      checks: manifest.checks,
      cleanupComplete,
      localTransportPassed:
        command === "run" && passed && manifest.mode === "local",
      providerQualified,
      failure,
    })
  );
  if (stopping.signal.aborted) process.exitCode = 130;
  else if (!cleanupComplete || (command === "run" && !passed))
    process.exitCode = 1;
}

try {
  const { values, positionals } = parseArgs({
    allowPositionals: true,
    options: {
      help: { type: "boolean", short: "h" },
      endpoint: { type: "string" },
      bucket: { type: "string" },
      "denied-bucket": { type: "string" },
      "output-dir": { type: "string" },
      manifest: { type: "string" },
      local: { type: "boolean", default: false },
      "max-requests": { type: "string", default: "100" },
    },
  });
  if (values.help) {
    console.log(`Qualify an existing private Cloudflare R2 bucket with synthetic objects.

Commands: plan (no network), run, cleanup
Flags:
  --endpoint <origin>     HTTPS account R2 endpoint, or numeric loopback HTTP with --local
  --bucket <name>         Dedicated existing qualification bucket
  --denied-bucket <name>  Existing bucket outside the selected S3 credential scope
  --output-dir <path>     Absolute NEW private directory for this run
  --manifest <path>       Existing private manifest.json for cleanup
  --max-requests <15..100> Persisted HTTP attempt cap, including cleanup
  --local                Synthetic credentials only; never qualifies Cloudflare

Secure environment references (run/cleanup only; never flags):
  ZOEN_R2_QUALIFICATION_ACCESS_KEY, ZOEN_R2_QUALIFICATION_SECRET_KEY
  ZOEN_R2_QUALIFICATION_SESSION_TOKEN (optional)
  ZOEN_R2_QUALIFICATION_API_TOKEN (Cloudflare read token; run only)

Examples:
  pnpm qualify:r2 plan --endpoint https://<account-id>.r2.cloudflarestorage.com --bucket zoen-payload-qualification --denied-bucket zoen-denied-qualification
  pnpm qualify:r2 run --endpoint https://<account-id>.r2.cloudflarestorage.com --bucket zoen-payload-qualification --denied-bucket zoen-denied-qualification --output-dir /private/r2-run
  pnpm qualify:r2 cleanup --endpoint https://<account-id>.r2.cloudflarestorage.com --bucket zoen-payload-qualification --manifest /private/r2-run/manifest.json

Hard bounds: 100 HTTP attempts, 1 MiB cumulative PUT bytes, 15 minutes per invocation.
No bucket creation, public settings changes, prefix listing, or database writes.`);
  } else {
    requireCheck(positionals.length === 1, "select_plan_run_or_cleanup");
    const command = z.enum(["plan", "run", "cleanup"]).parse(positionals[0]);
    requireCheck(
      values.endpoint && values.bucket,
      "endpoint_and_bucket_required"
    );
    const selected = target(values.endpoint, values.local);
    const bucket = bucketName.parse(values.bucket);
    if (command === "cleanup") {
      requireCheck(
        values.manifest && !values["output-dir"] && !values["denied-bucket"],
        "cleanup_requires_only_manifest_and_target"
      );
      requireCheck(
        isAbsolute(values.manifest) &&
          basename(values.manifest) === "manifest.json",
        "invalid_manifest_path"
      );
      await privateDirectory(dirname(values.manifest));
      const path = values.manifest;
      await locked(path, async () => {
        const manifest = await load(path);
        requireCheck(
          manifest.endpoint === selected.endpoint &&
            manifest.bucket === bucket &&
            manifest.mode === (values.local ? "local" : "cloudflare"),
          "cleanup_target_must_match_manifest"
        );
        await qualify(command, path, manifest);
      });
    } else {
      requireCheck(!values.manifest, "manifest_is_only_for_cleanup");
      const deniedBucket = values["denied-bucket"]
        ? bucketName.parse(values["denied-bucket"])
        : undefined;
      requireCheck(
        values.local || (deniedBucket && deniedBucket !== bucket),
        "distinct_existing_denied_bucket_required"
      );
      const maximum = z.coerce
        .number()
        .int()
        .min(15)
        .max(100)
        .parse(values["max-requests"]);
      if (command === "plan") {
        console.log(
          JSON.stringify({
            command,
            mode: values.local ? "local" : "cloudflare",
            endpoint: selected.endpoint,
            bucket,
            deniedBucket,
            maxRequests: maximum,
            maxPutBytes: maxBytes,
            lifetimeMs,
            prefix: "qualification/<fresh-uuid>/",
            providerQualified: false,
            networkRequests: 0,
          })
        );
      } else {
        requireCheck(
          values["output-dir"] && isAbsolute(values["output-dir"]),
          "absolute_new_output_directory_required"
        );
        // Validate required secure references before creating a run directory.
        if (!values.local) {
          const credentials = r2QualificationEnvironment();
          requireCheck(
            credentials.ZOEN_R2_QUALIFICATION_ACCESS_KEY &&
              credentials.ZOEN_R2_QUALIFICATION_SECRET_KEY &&
              credentials.ZOEN_R2_QUALIFICATION_API_TOKEN,
            "missing_r2_qualification_credential_reference"
          );
        }
        await mkdir(values["output-dir"], { mode: 0o700 });
        await privateDirectory(values["output-dir"]);
        const path = join(values["output-dir"], "manifest.json");
        const manifest: Manifest = {
          version: 1,
          runId: randomUUID(),
          mode: values.local ? "local" : "cloudflare",
          endpoint: selected.endpoint,
          bucket,
          deniedBucket,
          startedAt: new Date().toISOString(),
          maxRequests: maximum,
          requests: 0,
          putBytes: 0,
          phase: "running",
          checks: [],
          objects: [],
        };
        await locked(path, async () => {
          await save(path, manifest);
          await qualify(command, path, manifest);
        });
      }
    }
  }
} catch (error) {
  console.log(
    JSON.stringify({
      providerQualified: false,
      failure:
        error instanceof QualificationFailure
          ? error.message
          : "invalid_arguments_credentials_or_private_manifest",
    })
  );
  process.exitCode = 1;
}
