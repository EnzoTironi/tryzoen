/// <reference types="node" />
/// <reference lib="es2023.array" />
import { spawnSync, execFileSync } from "node:child_process";
import { createHash } from "node:crypto";
import { appendFileSync, readFileSync, realpathSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { parseArgs } from "node:util";
import { z } from "zod";
import { readAuditEnvironment } from "./env.mjs";

const filename = realpathSync(fileURLToPath(import.meta.url));
const directory = resolve(dirname(filename), "../..");
const deadline = "2026-10-04T02:59:00Z";
const graphSchema = z.enum(["application", "infrastructure"]);
const hashSchema = z.string().regex(/^[a-f0-9]{64}$/u);
const severitySchema = z.enum(["info", "low", "moderate", "high", "critical"]);
const severities = severitySchema.options;
const reportSchema = z.strictObject({
  advisories: z.record(
    z.string(),
    z.looseObject({
      severity: severitySchema,
      findings: z
        .array(
          z.looseObject({
            version: z.string(),
            paths: z.array(z.string().min(1)).min(1),
          })
        )
        .min(1),
      github_advisory_id: z.string(),
      module_name: z.string(),
      patched_versions: z.unknown().optional(),
    })
  ),
  metadata: z.looseObject({
    vulnerabilities: z.strictObject({
      info: z.number().int(),
      low: z.number().int(),
      moderate: z.number().int(),
      high: z.number().int(),
      critical: z.number().int(),
    }),
  }),
});
const forgePolicySchema = z.strictObject({
  package: z.literal("node-forge"),
  version: z.literal("1.4.0"),
  pathsSha256: hashSchema,
});
const cachePolicySchema = z.strictObject({
  package: z.literal("http-cache-semantics"),
  version: z.literal("4.2.0"),
  pathsSha256: hashSchema,
});
const bracesPolicySchema = z.strictObject({
  package: z.literal("braces"),
  version: z.literal("3.0.3"),
  pathsSha256: hashSchema,
});
const policySchema = z.strictObject({
  schemaVersion: z.literal(2),
  expiresAt: z.literal(deadline),
  classification: z.literal("accepted temporary risk"),
  authorization: z.literal(
    "protected integration and release after required checks"
  ),
  configurationSha256: hashSchema,
  graphs: z.strictObject({
    application: z.strictObject({
      "GHSA-86w9-cpqp-85rv": forgePolicySchema,
      "GHSA-ch52-4w7c-c8xp": cachePolicySchema,
      "GHSA-vfj7-8cjw-p6xm": bracesPolicySchema,
    }),
    infrastructure: z.strictObject({
      "GHSA-vfj7-8cjw-p6xm": bracesPolicySchema,
    }),
  }),
});

/** @param {import("node:crypto").BinaryLike} value */
const hash = (value) => createHash("sha256").update(value).digest("hex");

// Match Array.prototype.sort's default UTF-16 code-unit order, independent of locale.
/** @param {string} left @param {string} right */
const comparePaths = (left, right) =>
  left < right ? -1 : left > right ? 1 : 0;

/** @param {readonly string[]} paths */
export function pathsHash(paths) {
  return hash(JSON.stringify(paths.toSorted(comparePaths)));
}

/** @param {string} json */
export function readAuditReport(json) {
  /** @type {unknown} */
  const value = JSON.parse(json);
  // Zod records ignore __proto__; reject that raw key before schema parsing.
  if (
    value &&
    typeof value === "object" &&
    "advisories" in value &&
    value.advisories &&
    typeof value.advisories === "object" &&
    Object.hasOwn(value.advisories, "__proto__")
  )
    throw new Error("Unexpected advisory key.");
  const report = reportSchema.parse(value);
  const observed = { info: 0, low: 0, moderate: 0, high: 0, critical: 0 };
  for (const item of Object.values(report.advisories))
    observed[item.severity] += 1;
  if (
    severities.some(
      (severity) =>
        report.metadata.vulnerabilities[severity] !== observed[severity]
    )
  )
    throw new Error("Inconsistent audit severity counts.");
  return report;
}

/** @param {string} path */
function guardedPath(path) {
  return (
    path.startsWith(".github/workflows/") ||
    path.startsWith("infrastructure/") ||
    /^apps\/(mobile|desktop)\/(?!src\/|tests\/)/u.test(path) ||
    /^scripts\/(fly-[^/]+|start\.ts|set-channel-webhooks\.sh)$/u.test(path) ||
    /(^|\/)(Dockerfile[^/]*|\.dockerignore|compose[^/]*\.ya?ml|fly\.toml|vercel\.json|\.vercelignore|app\.json|app\.config\.[^/]+|eas\.json|\.easignore|credentials\.json|package\.json|pnpm-workspace\.yaml|pnpm-lock\.yaml|\.npmrc|\.node-version|turbo\.json|next\.config\.[^/]+)$/u.test(
      path
    ) ||
    /\.(pem|key|p12|pfx|keystore|jks|mobileprovision|entitlements)$/u.test(path)
  );
}

// Include added/deleted configuration, not just edits to known files.
/** @param {string} root */
export function configurationHash(root) {
  const files = execFileSync(
    "git",
    ["ls-files", "--cached", "--others", "--exclude-standard", "-z"],
    { cwd: root, encoding: "utf8" }
  )
    .split("\0")
    .filter((path) => path.length > 0 && guardedPath(path));
  return hash(
    JSON.stringify(
      [...new Set(files)]
        .toSorted(comparePaths)
        .map((path) => [path, hash(readFileSync(resolve(root, path)))])
    )
  );
}

/** @param {unknown} value */
const auditOutput = (value) => (typeof value === "string" ? value : "");

/** @param {string} reason @returns {{ok: false, accepted: false, message: string}} */
const reject = (reason) => ({ ok: false, accepted: false, message: reason });

/** @param {string} name */
const blockedAuditEnvironment = (name) =>
  /^(EXPO_|EAS_|CSC_|WIN_CSC_|APPLE_|npm_config_audit|NPM_CONFIG_AUDIT)/u.test(
    name
  ) ||
  /^(?:pnpm_config_|npm_config_)(?:(?:lockfile_dir|dir|prefix|production|dev|optional|only)$|audit(?:_|$))/iu.test(
    name
  );

/**
 * @param {unknown} rawPolicy
 * @param {string} configuration
 * @param {number} now
 * @param {readonly string[]} environmentNames
 * @returns {{ok: true, policy: import("zod").infer<typeof policySchema>} | {ok: false, accepted: false, message: string}}
 */
function checkAuditContext(rawPolicy, configuration, now, environmentNames) {
  const parsedPolicy = policySchema.safeParse(rawPolicy);
  if (!parsedPolicy.success) return reject("Invalid temporary risk policy.");
  const policy = parsedPolicy.data;
  if (!Number.isFinite(now) || now >= Date.parse(deadline))
    return reject("Temporary risk acceptance expired.");
  if (
    configuration !== policy.configurationSha256 ||
    environmentNames.some(blockedAuditEnvironment)
  )
    return reject(
      "Deployment, distribution, dependency or signing configuration changed."
    );
  return { ok: true, policy };
}

/**
 * @param {{result: {status: number | null, stdout: string, error?: unknown, signal?: string | null}, policy: unknown, configuration: string, now: number, environmentNames: readonly string[], graph: import("zod").infer<typeof graphSchema>}} input
 */
export function evaluateAudit({
  result,
  policy: rawPolicy,
  configuration,
  now,
  environmentNames,
  graph,
}) {
  const context = checkAuditContext(
    rawPolicy,
    configuration,
    now,
    environmentNames
  );
  if (!context.ok) return context;
  const policy = context.policy;
  if (result.error || result.signal || ![0, 1].includes(result.status ?? -1)) {
    return reject(
      "Audit transport/process failure; temporary risk was not accepted."
    );
  }
  let report;
  try {
    report = readAuditReport(result.stdout);
  } catch {
    return reject(
      "Malformed or inconsistent audit JSON; temporary risk was not accepted."
    );
  }
  const items = Object.values(report.advisories);
  const blocking = items.filter((item) => item.severity !== "info");
  if (result.status !== (blocking.length ? 1 : 0))
    return reject("Unexpected audit exit status.");
  if (!items.length)
    return {
      ok: true,
      accepted: false,
      message:
        "Audit completed at the existing low threshold; temporary exception was not applied.",
    };
  const expected = new Map(Object.entries(policy.graphs[graph]));
  if (
    items.length !== expected.size ||
    new Set(items.map((item) => item.github_advisory_id)).size !==
      items.length ||
    items.some((item) => !expected.has(item.github_advisory_id))
  )
    return reject("Other blocking advisory; temporary risk was not accepted.");
  for (const item of items) {
    const approved = expected.get(item.github_advisory_id);
    const finding = item.findings[0];
    if (
      !approved ||
      item.module_name !== approved.package ||
      item.severity !== "high" ||
      item.patched_versions !== null ||
      item.findings.length !== 1 ||
      finding.version !== approved.version ||
      pathsHash(finding.paths) !== approved.pathsSha256
    )
      return reject(
        "Advisory version, dependency paths or fix availability changed."
      );
  }
  return {
    ok: true,
    accepted: true,
    message: `${graph}: accepted temporary risk for ${items.map((item) => `${item.github_advisory_id} ${item.module_name}@${item.findings[0].version}`).join(", ")} until ${deadline}. Vulnerabilities remain unfixed. Protected integration and release require all remaining checks.`,
  };
}

if (process.argv[1] && realpathSync(process.argv[1]) === filename) {
  /** @type {import("node:child_process").SpawnSyncReturns<string> | undefined} */
  let result;
  let outcome;
  try {
    const { values } = parseArgs({
      options: {
        graph: { type: "string", default: "application" },
        help: { type: "boolean", short: "h" },
      },
    });
    if (values.help) {
      outcome = {
        ok: true,
        accepted: false,
        message:
          "Usage: node scripts/audit/run.mjs [--graph application|infrastructure]\nRuns the real official-registry audit at the low threshold with the reviewed, expiring risk policy.",
      };
    } else {
      const graph = graphSchema.parse(values.graph);
      const auditDirectory =
        graph === "application"
          ? directory
          : resolve(directory, "infrastructure");
      /** @type {unknown} */
      const policy = JSON.parse(
        readFileSync(resolve(dirname(filename), "policy.json"), "utf8")
      );
      const auditEnvironment = readAuditEnvironment();
      const configuration = configurationHash(directory);
      const context = checkAuditContext(
        policy,
        configuration,
        Date.now(),
        auditEnvironment.names
      );
      if (!context.ok) outcome = context;
      else {
        result = spawnSync(
          "pnpm",
          [
            "audit",
            `--dir=${auditDirectory}`,
            `--config.lockfile-dir=${auditDirectory}`,
            // pnpm normalizes these falsey selectors to include both prod and dev.
            "--only=null",
            "--production=false",
            "--dev=false",
            "--optional=true",
            "--audit-level=low",
            "--json",
            "--registry=https://registry.npmjs.org",
          ],
          {
            cwd: auditDirectory,
            encoding: "utf8",
            maxBuffer: 16 * 1024 * 1024,
          }
        );
        // Keep the current registry report intact, including the accepted advisory.
        process.stdout.write(auditOutput(result.stdout));
        process.stderr.write(auditOutput(result.stderr));
        outcome = evaluateAudit({
          result,
          policy,
          configuration: configurationHash(directory),
          now: Date.now(),
          environmentNames: auditEnvironment.names,
          graph,
        });
      }
      if (auditEnvironment.summaryPath)
        appendFileSync(auditEnvironment.summaryPath, `\n${outcome.message}\n`);
    }
  } catch {
    outcome = {
      ok: false,
      accepted: false,
      message: "Audit policy/configuration could not be verified.",
    };
  }
  console.log(
    outcome.accepted ? `::warning::${outcome.message}` : outcome.message
  );
  const status = result?.status ?? 1;
  process.exitCode = outcome.ok ? 0 : status === 0 ? 1 : status;
}
