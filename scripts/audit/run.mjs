import { spawnSync, execFileSync } from "node:child_process";
import { createHash } from "node:crypto";
import { appendFileSync, readFileSync } from "node:fs";
import { resolve } from "node:path";
import { fileURLToPath } from "node:url";

const directory = fileURLToPath(new URL("../../", import.meta.url));
const advisoryId = "GHSA-86w9-cpqp-85rv";
const deadline = "2026-10-04T02:59:00Z";
const severities = ["info", "low", "moderate", "high", "critical"];
const hash = (value) => createHash("sha256").update(value).digest("hex");

export function pathsHash(paths) {
  return hash(JSON.stringify([...paths].sort()));
}

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
export function configurationHash(root) {
  const files = execFileSync(
    "git",
    ["ls-files", "--cached", "--others", "--exclude-standard", "-z"],
    { cwd: root, encoding: "utf8" }
  )
    .split("\0")
    .filter((path) => path && guardedPath(path));
  return hash(
    JSON.stringify(
      [...new Set(files)]
        .sort()
        .map((path) => [path, hash(readFileSync(resolve(root, path)))])
    )
  );
}

export function evaluateAudit(result, policy, configuration, now, environment) {
  const reject = (reason) => ({ ok: false, accepted: false, message: reason });
  if (result.error || result.signal || ![0, 1].includes(result.status)) {
    return reject(
      "Audit transport/process failure; temporary risk was not accepted."
    );
  }
  let report;
  try {
    report = JSON.parse(result.stdout);
    if (
      !report ||
      Object.keys(report).sort().join(",") !== "advisories,metadata" ||
      !report.advisories ||
      Array.isArray(report.advisories) ||
      typeof report.advisories !== "object" ||
      !report.metadata
    )
      throw new Error();
    const counts = report.metadata.vulnerabilities;
    if (
      !counts ||
      Object.keys(counts).sort().join(",") !== [...severities].sort().join(",")
    )
      throw new Error();
    const observed = Object.fromEntries(
      severities.map((severity) => [severity, 0])
    );
    for (const item of Object.values(report.advisories)) {
      if (
        !item ||
        !severities.includes(item.severity) ||
        !Array.isArray(item.findings) ||
        item.findings.length === 0 ||
        typeof item.github_advisory_id !== "string" ||
        typeof item.module_name !== "string"
      )
        throw new Error();
      for (const finding of item.findings) {
        if (
          typeof finding.version !== "string" ||
          !Array.isArray(finding.paths) ||
          finding.paths.length === 0 ||
          finding.paths.some((path) => typeof path !== "string" || !path)
        )
          throw new Error();
      }
      observed[item.severity] += 1;
    }
    if (
      severities.some(
        (severity) =>
          !Number.isInteger(counts[severity]) ||
          counts[severity] !== observed[severity]
      )
    )
      throw new Error();
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
  if (blocking.length !== 1 || blocking[0].github_advisory_id !== advisoryId)
    return reject("Other blocking advisory; temporary risk was not accepted.");
  const item = blocking[0];
  if (
    !policy ||
    policy.schemaVersion !== 1 ||
    policy.advisory !== advisoryId ||
    policy.package !== "node-forge" ||
    policy.version !== "1.4.0" ||
    policy.expiresAt !== deadline ||
    policy.classification !== "accepted temporary risk" ||
    policy.expoCli !== "57.0.27" ||
    policy.expoCertificates !== "0.0.6" ||
    !/^[a-f0-9]{64}$/u.test(policy.pathsSha256) ||
    !/^[a-f0-9]{64}$/u.test(policy.configurationSha256)
  )
    return reject("Invalid temporary risk policy.");
  if (!Number.isFinite(now) || now >= Date.parse(deadline))
    return reject("Temporary risk acceptance expired.");
  if (
    configuration !== policy.configurationSha256 ||
    Object.keys(environment).some((name) =>
      /^(EXPO_|EAS_|CSC_|WIN_CSC_|APPLE_|npm_config_audit|NPM_CONFIG_AUDIT)/u.test(
        name
      )
    )
  )
    return reject(
      "Deployment, distribution, dependency or signing configuration changed."
    );
  if (
    item.module_name !== policy.package ||
    item.severity !== "high" ||
    item.patched_versions !== null ||
    item.findings.length !== 1 ||
    item.findings[0].version !== policy.version ||
    pathsHash(item.findings[0].paths) !== policy.pathsSha256
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
  process.stdout.write(result.stdout || "");
  process.stderr.write(result.stderr || "");
  let outcome;
  try {
    const policy = JSON.parse(
      readFileSync(new URL("policy.json", import.meta.url), "utf8")
    );
    outcome = evaluateAudit(
      result,
      policy,
      configurationHash(directory),
      Date.now(),
      process.env
    );
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
  if (process.env.GITHUB_STEP_SUMMARY)
    appendFileSync(process.env.GITHUB_STEP_SUMMARY, `\n${outcome.message}\n`);
  process.exitCode = outcome.ok ? 0 : result.status || 1;
}
