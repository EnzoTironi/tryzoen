/// <reference types="node" />
/// <reference lib="es2023.array" />
import { spawnSync, execFileSync } from "node:child_process";
import { createHash } from "node:crypto";
import { appendFileSync, readFileSync } from "node:fs";
import { resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { z } from "zod";
import { readAuditEnvironment } from "./env.mjs";

const directory = fileURLToPath(new URL("../../", import.meta.url));
const advisoryId = "GHSA-86w9-cpqp-85rv";
const deadline = "2026-10-04T02:59:00Z";
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
const policySchema = z.looseObject({
  schemaVersion: z.literal(1),
  advisory: z.literal(advisoryId),
  package: z.literal("node-forge"),
  version: z.literal("1.4.0"),
  expiresAt: z.literal(deadline),
  classification: z.literal("accepted temporary risk"),
  expoCli: z.literal("57.0.27"),
  expoCertificates: z.literal("0.0.6"),
  pathsSha256: z.string().regex(/^[a-f0-9]{64}$/u),
  configurationSha256: z.string().regex(/^[a-f0-9]{64}$/u),
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

/** @param {string} reason */
const reject = (reason) => ({ ok: false, accepted: false, message: reason });

/**
 * @param {{status: number | null, stdout: string, error?: unknown, signal?: string | null}} result
 * @param {unknown} rawPolicy
 * @param {string} configuration
 * @param {number} now
 * @param {readonly string[]} environmentNames
 */
export function evaluateAudit(
  result,
  rawPolicy,
  configuration,
  now,
  environmentNames
) {
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
  const blocking = Object.values(report.advisories).filter(
    (item) => item.severity !== "info"
  );
  if (result.status !== (blocking.length ? 1 : 0))
    return reject("Unexpected audit exit status.");
  if (!blocking.length)
    return {
      ok: true,
      accepted: false,
      message:
        "Audit completed at the existing low threshold; temporary exception was not applied.",
    };
  if (blocking.length !== 1 || blocking[0]?.github_advisory_id !== advisoryId)
    return reject("Other blocking advisory; temporary risk was not accepted.");
  const item = blocking[0];
  const parsedPolicy = policySchema.safeParse(rawPolicy);
  if (!parsedPolicy.success) return reject("Invalid temporary risk policy.");
  const policy = parsedPolicy.data;
  if (!Number.isFinite(now) || now >= Date.parse(deadline))
    return reject("Temporary risk acceptance expired.");
  if (
    configuration !== policy.configurationSha256 ||
    environmentNames.some((name) =>
      /^(EXPO_|EAS_|CSC_|WIN_CSC_|APPLE_|npm_config_audit|NPM_CONFIG_AUDIT)/u.test(
        name
      )
    )
  )
    return reject(
      "Deployment, distribution, dependency or signing configuration changed."
    );
  const finding = item.findings[0];
  if (
    item.module_name !== policy.package ||
    item.severity !== "high" ||
    item.patched_versions !== null ||
    item.findings.length !== 1 ||
    finding.version !== policy.version ||
    pathsHash(finding.paths) !== policy.pathsSha256
  )
    return reject(
      "Advisory version, dependency paths or fix availability changed."
    );
  return {
    ok: true,
    accepted: true,
    message: `${advisoryId}: accepted temporary risk for node-forge@1.4.0 until ${deadline}. Vulnerability remains unfixed. Prelaunch integration only; no deployment authorization.`,
  };
}

if (
  process.argv[1] &&
  resolve(process.argv[1]) === fileURLToPath(import.meta.url)
) {
  const result = spawnSync(
    "pnpm",
    [
      "audit",
      "--audit-level=low",
      "--json",
      "--registry=https://registry.npmjs.org",
    ],
    {
      cwd: directory,
      encoding: "utf8",
      maxBuffer: 16 * 1024 * 1024,
    }
  );
  // Keep the current registry report intact, including the accepted advisory.
  process.stdout.write(auditOutput(result.stdout));
  process.stderr.write(auditOutput(result.stderr));
  let outcome;
  try {
    /** @type {unknown} */
    const policy = JSON.parse(
      readFileSync(new URL("policy.json", import.meta.url), "utf8")
    );
    const auditEnvironment = readAuditEnvironment();
    outcome = evaluateAudit(
      result,
      policy,
      configurationHash(directory),
      Date.now(),
      auditEnvironment.names
    );
    if (auditEnvironment.summaryPath)
      appendFileSync(auditEnvironment.summaryPath, `\n${outcome.message}\n`);
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
  process.exitCode = outcome.ok
    ? 0
    : result.status === null || result.status === 0
      ? 1
      : result.status;
}
