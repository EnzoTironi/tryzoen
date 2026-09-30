import { deepStrictEqual, strictEqual } from "node:assert";
import {
  execFile,
  spawn,
  type ChildProcessWithoutNullStreams,
} from "node:child_process";
import { createHash } from "node:crypto";
import { mkdtemp, mkdir, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { promisify } from "node:util";
import { PGlite } from "@electric-sql/pglite";

const runProcess = promisify(execFile);
const filename = fileURLToPath(import.meta.url);
const variants = [
  "git-repeated",
  "git-captured",
  "git-batched",
  "sql-row-autocommit",
  "sql-row-transaction",
  "sql-batch-autocommit",
  "sql-batch-transaction",
  "media-copy-base64",
  "media-view-base64",
  "media-binary-contract",
] as const;
const rssGuardBytes = 768 * 1024 * 1024;
const environment = {
  PATH: "/usr/bin:/bin:/usr/sbin:/sbin:/opt/homebrew/bin",
  NODE_ENV: "production" as const,
  GIT_CONFIG_NOSYSTEM: "1",
  GIT_CONFIG_GLOBAL: "/dev/null",
  GIT_AUTHOR_NAME: "Synthetic benchmark",
  GIT_AUTHOR_EMAIL: "benchmark@zoen.invalid",
  GIT_COMMITTER_NAME: "Synthetic benchmark",
  GIT_COMMITTER_EMAIL: "benchmark@zoen.invalid",
  GIT_AUTHOR_DATE: "2026-01-01T00:00:00Z",
  GIT_COMMITTER_DATE: "2026-01-01T00:00:00Z",
};

function digest(value: string | Uint8Array) {
  return createHash("sha256").update(value).digest("hex");
}

function distribution(samples: readonly number[]) {
  const sorted = samples.toSorted((a, b) => a - b);
  const at = (p: number) => sorted[Math.ceil(p * sorted.length) - 1] ?? 0;
  return { samples, p50: at(0.5), p95: at(0.95) };
}

async function trial<T>(run: () => Promise<T>) {
  globalThis.gc?.();
  const cpuBefore = process.cpuUsage();
  const start = performance.now();
  const result = await run();
  const durationMs = performance.now() - start;
  const cpu = process.cpuUsage(cpuBefore);
  observeRss("trial");
  return { result, durationMs, cpuMs: (cpu.user + cpu.system) / 1000 };
}

function observeRss(phase: string) {
  const rss = process.memoryUsage.rss();
  if (rss > rssGuardBytes)
    throw new Error(
      `RSS guard exceeded during ${phase}: ${rss} bytes > ${rssGuardBytes}`
    );
}

const gitArguments = (directory: string, args: readonly string[]) => [
  "-c",
  "core.hooksPath=/dev/null",
  "-c",
  "protocol.allow=never",
  "-c",
  "commit.gpgSign=false",
  "--git-dir",
  directory,
  ...(args[0] === "init" ? [] : ["--work-tree", join(directory, "worktree")]),
  ...args,
];

async function gitKernel(variant: string) {
  const temporary = await mkdtemp(join(tmpdir(), "zoen-bench-git-"));
  let spawns = 0;
  async function git(directory: string, args: readonly string[]) {
    spawns++;
    return (
      await runProcess("git", gitArguments(directory, args), {
        env: environment,
        timeout: 5000,
        maxBuffer: 2 * 1024 * 1024,
      })
    ).stdout;
  }
  async function batch(directory: string, revision: string, paths: string[]) {
    spawns++;
    const output = await new Promise<Buffer>((resolve, reject) => {
      const child: ChildProcessWithoutNullStreams = spawn(
        "git",
        gitArguments(directory, ["cat-file", "--batch"]),
        {
          env: environment,
          stdio: ["pipe", "pipe", "pipe"],
          timeout: 5000,
        }
      );
      const chunks: Buffer[] = [];
      let bytes = 0;
      child.stdout.on("data", (chunk: Buffer) => {
        bytes += chunk.length;
        if (bytes > 2 * 1024 * 1024) {
          child.kill("SIGKILL");
          reject(new Error("Bounded synthetic Git output exceeded its limit"));
        } else chunks.push(chunk);
      });
      child.stderr.resume();
      child.once("error", reject);
      child.once("close", (code) => {
        if (code === 0) resolve(Buffer.concat(chunks));
        else reject(new Error("Synthetic Git batch failed"));
      });
      child.stdin.end(paths.map((path) => `${revision}:${path}\n`).join(""));
    });
    let offset = 0;
    const contents = paths.map(() => {
      const end = output.indexOf(10, offset);
      const header = output.subarray(offset, end).toString("utf8");
      const match = /^[a-f0-9]{40} blob ([0-9]+)$/u.exec(header);
      if (end < offset || !match) throw new Error("Invalid Git batch header");
      const size = Number(match[1]);
      const start = end + 1;
      strictEqual(output[start + size], 10);
      offset = start + size + 1;
      return output.subarray(start, start + size).toString("utf8");
    });
    strictEqual(offset, output.length);
    return contents;
  }
  try {
    const fixtureRepository = join(temporary, "fixture");
    await git(fixtureRepository, [
      "init",
      "--bare",
      "--initial-branch=main",
      fixtureRepository,
    ]);
    await mkdir(join(fixtureRepository, "worktree", "knowledge"), {
      recursive: true,
    });
    const files = Array.from({ length: 16 }, (_file, index) => {
      const path = `knowledge/fixture-${index}.md`;
      const content = Array.from({ length: 1024 }, (_, line) =>
        digest(`${index}:${line}`)
      ).join("\n");
      return { path, content };
    });
    for (const file of files)
      await writeFile(
        join(fixtureRepository, "worktree", file.path),
        file.content
      );
    await git(fixtureRepository, ["add", "--", "knowledge"]);
    await git(fixtureRepository, ["commit", "-m", "bounded synthetic fixture"]);
    const revision = (
      await git(fixtureRepository, ["rev-parse", "HEAD"])
    ).trim();
    const bundlePath = join(temporary, "fixture.bundle");
    await git(fixtureRepository, ["bundle", "create", bundlePath, "--all"]);
    const bundle = await readFile(bundlePath);
    const paths = files.slice(0, 3).map((file) => file.path);
    const expected = files.slice(0, 3).map((file) => file.content);
    let captureNumber = 0;
    async function capture(
      readCaptured: (repository: string) => Promise<string[]>
    ) {
      const directory = join(temporary, `capture-${captureNumber++}`);
      const repository = join(directory, "repository");
      await mkdir(directory);
      try {
        await git(repository, [
          "init",
          "--bare",
          "--initial-branch=main",
          repository,
        ]);
        await mkdir(join(repository, "worktree"));
        await writeFile(join(directory, "source.bundle"), bundle, {
          mode: 0o600,
        });
        await git(repository, [
          "bundle",
          "unbundle",
          join(directory, "source.bundle"),
        ]);
        const listed = new Set(
          (
            await git(repository, [
              "ls-tree",
              "-r",
              "--name-only",
              "-z",
              revision,
            ])
          ).split("\0")
        );
        for (const path of paths) strictEqual(listed.has(path), true);
        return await readCaptured(repository);
      } finally {
        await rm(directory, { recursive: true, force: true });
      }
    }
    async function shows(repository: string, selected: string[]) {
      return await Promise.all(
        selected.map((path) => git(repository, ["show", `${revision}:${path}`]))
      );
    }
    async function run() {
      if (variant === "git-repeated") {
        const definition = await capture((repository) =>
          shows(repository, paths.slice(0, 1))
        );
        const captured = await capture((repository) =>
          shows(repository, paths)
        );
        const final = await capture((repository) => shows(repository, paths));
        return [definition, captured, final];
      }
      const captured = await capture(async (repository) => {
        if (variant === "git-batched") {
          // The definition reveals the remaining paths: two bounded native batches.
          return [
            ...(await batch(repository, revision, paths.slice(0, 1))),
            ...(await batch(repository, revision, paths.slice(1))),
          ];
        }
        return [
          ...(await shows(repository, paths.slice(0, 1))),
          ...(await shows(repository, paths.slice(1))),
        ];
      });
      // Application authorization and final revision recheck are outside this kernel.
      return [captured.slice(0, 1), captured, captured];
    }
    const first = await trial(run);
    deepStrictEqual(first.result, [expected.slice(0, 1), expected, expected]);
    const times: number[] = [];
    const cpu: number[] = [];
    const spawnCounts: number[] = [];
    for (let index = 0; index < 6; index++) {
      spawns = 0;
      const sample = await trial(run);
      deepStrictEqual(sample.result, first.result);
      times.push(sample.durationMs);
      cpu.push(sample.cpuMs);
      spawnCounts.push(spawns);
    }
    return {
      fixture: {
        files: files.length,
        rawBytes: files.reduce(
          (sum, file) => sum + Buffer.byteLength(file.content),
          0
        ),
        bundleBytes: bundle.length,
        selectedFiles: paths.length,
      },
      firstTrialMs: first.durationMs,
      repeatedTrialMs: distribution(times),
      nodeCpuMs: distribution(cpu),
      gitSpawnsPerTrial: spawnCounts,
      reconstructedBundlesPerTrial: variant === "git-repeated" ? 3 : 1,
      bundleBytesWrittenPerTrial:
        bundle.length * (variant === "git-repeated" ? 3 : 1),
      outputDigest: digest(JSON.stringify(first.result)),
      databaseBytes: null,
      applicationTransactionMs: null,
    };
  } finally {
    await rm(temporary, { recursive: true, force: true });
  }
}

async function sqlKernel(variant: string) {
  const rows = Array.from({ length: 500 }, (_, index) => [
    index,
    `D'Água ${index}\n漢字`,
    `${9007199254740991000n + BigInt(index)}.123456789`,
    index % 2 === 0,
    "2026-01-01",
    index % 3 === 0 ? null : "text",
  ]);
  const started = performance.now();
  const db = new PGlite();
  await db.waitReady;
  const initializationMs = performance.now() - started;
  try {
    observeRss("PGlite initialization");
    await db.exec(
      "CREATE TABLE fixture (id numeric, label text, exact numeric, flag boolean, day date, optional text)"
    );
    const expected = rows.map((row) => ({
      id: String(row[0]),
      label: row[1],
      exact: row[2],
      flag: row[3],
      day: row[4],
      optional: row[5],
    }));
    const batchSize = variant.includes("batch") ? 100 : 1;
    const transactional = variant.endsWith("-transaction");
    const times: number[] = [];
    const cpu: number[] = [];
    const transactionTimes: number[] = [];
    let firstTrialMs = 0;
    let outputDigest = "";
    for (let iteration = 0; iteration < 5; iteration++) {
      await db.exec("TRUNCATE fixture");
      const sample = await trial(async () => {
        const begin = performance.now();
        if (transactional) await db.exec("BEGIN");
        try {
          for (let offset = 0; offset < rows.length; offset += batchSize) {
            const selected = rows.slice(offset, offset + batchSize);
            const placeholders = selected
              .map(
                (row, rowIndex) =>
                  `(${row.map((_, column) => `$${rowIndex * row.length + column + 1}`).join(",")})`
              )
              .join(",");
            await db.query(
              `INSERT INTO fixture VALUES ${placeholders}`,
              selected.flat()
            );
            if ((offset + selected.length) % 100 === 0)
              observeRss("PGlite input loading");
          }
          if (transactional) {
            await db.exec("COMMIT");
          }
          return transactional ? performance.now() - begin : null;
        } catch (error) {
          if (transactional) await db.exec("ROLLBACK");
          throw error;
        }
      });
      const result = await db.query(
        "SELECT id::text, label, exact::text, flag, day::text, optional FROM fixture ORDER BY id"
      );
      deepStrictEqual(result.rows, expected);
      outputDigest = digest(JSON.stringify(result.rows));
      if (iteration === 0) firstTrialMs = sample.durationMs;
      else {
        times.push(sample.durationMs);
        cpu.push(sample.cpuMs);
        if (sample.result !== null) transactionTimes.push(sample.result);
      }
    }
    return {
      fixture: {
        rows: rows.length,
        columns: rows[0]?.length,
        jsonBytes: Buffer.byteLength(JSON.stringify(rows)),
      },
      initializationMs,
      firstTrialMs,
      warmTrialMs: distribution(times),
      cpuMs: distribution(cpu),
      insertCallsPerTrial: Math.ceil(rows.length / batchSize),
      insertCommitsPerTrial: transactional
        ? 1
        : Math.ceil(rows.length / batchSize),
      pgliteExplicitTransactionMs: transactional
        ? distribution(transactionTimes)
        : null,
      applicationTransactionMs: null,
      outputDigest,
    };
  } finally {
    await db.close();
  }
}

async function mediaKernel(variant: string) {
  const backing = new Uint8Array(3 * 1024 * 1024 + 32).fill(0x11);
  backing.fill(0x5a, 16, backing.length - 16);
  const bytes = backing.subarray(16, backing.length - 16);
  const expected = Buffer.from(bytes).toString("base64");
  const times: number[] = [];
  const cpu: number[] = [];
  let firstTrialMs = 0;
  for (let iteration = 0; iteration < 13; iteration++) {
    const sample = await trial(async () => {
      if (variant === "media-copy-base64")
        return Buffer.from(bytes).toString("base64");
      if (variant === "media-view-base64")
        return Buffer.from(
          bytes.buffer,
          bytes.byteOffset,
          bytes.byteLength
        ).toString("base64");
      return bytes;
    });
    if (typeof sample.result === "string") strictEqual(sample.result, expected);
    else strictEqual(sample.result, bytes);
    if (iteration === 0) firstTrialMs = sample.durationMs;
    else {
      times.push(sample.durationMs);
      cpu.push(sample.cpuMs);
    }
  }
  return {
    fixture: {
      inputBytes: bytes.length,
      inputByteOffset: bytes.byteOffset,
      base64Bytes: Buffer.byteLength(expected),
    },
    firstTrialMs,
    warmTrialMs: distribution(times),
    cpuMs: distribution(cpu),
    extraBufferCopyBytesPerTrial:
      variant === "media-copy-base64" ? bytes.length : 0,
    encodedPayloadBytesPerTrial:
      variant === "media-binary-contract"
        ? bytes.length
        : Buffer.byteLength(expected),
    outputContract:
      variant === "media-binary-contract"
        ? "Uint8Array; different client API, no transport measured"
        : "identical base64 string",
    outputDigest:
      variant === "media-binary-contract" ? digest(bytes) : digest(expected),
    applicationTransactionMs: null,
  };
}

const [mode, selected] = process.argv.slice(2);
if (mode === "--child") {
  if (!variants.some((variant) => variant === selected))
    throw new Error("Unknown benchmark variant");
  const result = await Promise.try(async () => {
    return selected?.startsWith("git-")
      ? await gitKernel(selected)
      : selected?.startsWith("sql-")
        ? await sqlKernel(selected)
        : await mediaKernel(selected ?? "");
  }).catch((error: unknown) => {
    if (
      error instanceof Error &&
      error.message.startsWith("RSS guard exceeded")
    )
      return { status: "blocked-rss-guard", reason: error.message };
    throw error;
  });
  process.stdout.write(
    JSON.stringify({
      variant: selected,
      status: "passed",
      ...result,
      processPeakRssBytes: process.resourceUsage().maxRSS * 1024,
      processFinalRssBytes: process.memoryUsage.rss(),
      scope:
        "single Node child including initialization, fixtures and correctness checks; excludes native Git child RSS",
    })
  );
} else {
  if (mode && mode !== "--only")
    throw new Error(
      "Usage: node --import tsx benchmarks/performance/run.ts [--only git|sql|media]"
    );
  if (mode === "--only" && !["git", "sql", "media"].includes(selected ?? ""))
    throw new Error("Unknown kernel");
  const results: unknown[] = [];
  for (const variant of variants.filter(
    (value) => mode !== "--only" || value.startsWith(`${selected ?? ""}-`)
  )) {
    process.stderr.write(`Synthetic benchmark: ${variant}\n`);
    const response = await runProcess(
      process.execPath,
      [
        "--expose-gc",
        "--max-old-space-size=192",
        "--import",
        "tsx",
        filename,
        "--child",
        variant,
      ],
      {
        cwd: join(dirname(filename), "../.."),
        env: environment,
        timeout: 45000,
        maxBuffer: 1024 * 1024,
        killSignal: "SIGKILL",
      }
    );
    const result: unknown = JSON.parse(response.stdout);
    results.push(result);
    if (
      typeof result === "object" &&
      result !== null &&
      "status" in result &&
      result.status === "blocked-rss-guard"
    )
      break;
  }
  process.stdout.write(
    JSON.stringify(
      {
        capturedAt: new Date().toISOString(),
        node: process.version,
        git: (
          await runProcess("git", ["--version"], { env: environment })
        ).stdout.trim(),
        platform: process.platform,
        architecture: process.arch,
        serialChildProcesses: results.length,
        v8OldSpaceLimitMiB: 192,
        observedRssGuardBytes: rssGuardBytes,
        notes: [
          "Synthetic kernels, not application latency or financial savings.",
          "First trial is not a cold machine/filesystem cache measurement; no OS caches flushed.",
          "Nearest-rank p95 with low trial counts is descriptive, not a production estimate.",
          "RSS guard is checked between operations; V8 heap limit is not a WASM/OS memory ceiling.",
          "No services, environment files, application credentials or PostgreSQL connections.",
        ],
        results,
      },
      null,
      2
    ) + "\n"
  );
}
