/// <reference types="node" />
import assert from "node:assert/strict";
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { execFileSync } from "node:child_process";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";
import {
  configurationHash,
  evaluateAudit,
  pathsHash,
  readAuditReport,
} from "./run.mjs";

const captured = readAuditReport(
  readFileSync(new URL("registry-fixture.json", import.meta.url), "utf8")
);
import policy from "./policy.json" with { type: "json" };
const beforeExpiry = Date.parse("2026-10-04T02:58:59Z");
/** @param {ReturnType<typeof readAuditReport>} report */
const finding = (report) => {
  const item = Object.values(report.advisories)[0];
  assert.ok(item);
  return item;
};
/** @param {ReturnType<typeof finding>} item */
const firstFinding = (item) => {
  const entry = item.findings[0];
  assert.ok(entry);
  return entry;
};
/**
 * @param {ReturnType<typeof readAuditReport>} [report]
 * @param {{result?: Partial<Parameters<typeof evaluateAudit>[0]>, policy?: unknown, configuration?: string, now?: number, environment?: Record<string, unknown>}} [changes]
 */
const evaluate = (report = captured, changes = {}) =>
  evaluateAudit(
    { status: 1, stdout: JSON.stringify(report), ...changes.result },
    changes.policy ?? policy,
    changes.configuration ?? policy.configurationSha256,
    changes.now ?? beforeExpiry,
    Object.keys(changes.environment ?? {})
  );

await test("accepts the exact live registry advisory and keeps the residual risk explicit", () => {
  assert.deepEqual(evaluate().ok, true);
  assert.equal(evaluate().accepted, true);
  assert.match(
    evaluate().message,
    /accepted temporary risk.*Vulnerability remains unfixed/u
  );
  assert.equal(
    pathsHash(firstFinding(finding(captured)).paths),
    policy.pathsSha256
  );
});

await test("expires at the exact deadline and remains closed afterward", () => {
  for (const now of [
    Date.parse(policy.expiresAt),
    Date.parse(policy.expiresAt) + 1,
    NaN,
  ]) {
    assert.equal(evaluate(captured, { now }).ok, false);
  }
});

await test("does not allow the policy to extend the deadline or add another advisory", () => {
  for (const changed of [
    { expiresAt: "2026-10-05T02:59:00Z" },
    { advisory: "GHSA-aaaa-bbbb-cccc" },
  ]) {
    assert.equal(
      evaluate(captured, { policy: { ...policy, ...changed } }).ok,
      false
    );
  }
});

await test("blocks a different or additional low-severity advisory", () => {
  const different = structuredClone(captured);
  finding(different).github_advisory_id = "GHSA-aaaa-bbbb-cccc";
  assert.equal(evaluate(different).ok, false);
  const additional = structuredClone(captured);
  additional.advisories.other = { ...finding(different), severity: "low" };
  additional.metadata.vulnerabilities.low = 1;
  assert.equal(evaluate(additional).ok, false);
});

await test("blocks wrong package, version, path, duplicated paths and newly available fix", () => {
  /** @type {((item: ReturnType<typeof finding>) => void)[]} */
  const mutations = [
    (item) => {
      item.module_name = "another-package";
    },
    (item) => {
      firstFinding(item).version = "1.3.1";
    },
    (item) => {
      firstFinding(item).paths[0] = ".>another-package>node-forge";
    },
    (item) => {
      const path = firstFinding(item).paths[0];
      assert.ok(path);
      firstFinding(item).paths.push(path);
    },
    (item) => {
      item.patched_versions = ">=1.4.1";
    },
  ];
  for (const mutate of mutations) {
    const report = structuredClone(captured);
    mutate(finding(report));
    assert.equal(evaluate(report).ok, false);
  }
  const reordered = structuredClone(captured);
  firstFinding(finding(reordered)).paths.reverse();
  assert.equal(evaluate(reordered).ok, true);
});

await test("fails transport/process errors, malformed JSON and inconsistent payloads", () => {
  for (const result of [
    { status: 2 },
    { status: null, signal: "SIGTERM" },
    { error: new Error("registry unavailable") },
    { stdout: "{" },
    { stdout: JSON.stringify({ error: "registry unavailable" }) },
    { stdout: "{}" },
    { status: 0 },
    {
      status: 0,
      stdout:
        '{"advisories":{"__proto__":null},"metadata":{"vulnerabilities":{"info":0,"low":0,"moderate":0,"high":0,"critical":0}}}',
    },
    {
      stdout: JSON.stringify(captured).replace(
        '"advisories":{',
        '"advisories":{"__proto__":null,'
      ),
    },
  ])
    assert.equal(evaluate(captured, { result }).ok, false);
  const report = structuredClone(captured);
  report.metadata.vulnerabilities.high = 0;
  assert.equal(evaluate(report).ok, false);
});

await test("blocks changed configuration and signing environment without reading secret values", () => {
  assert.equal(evaluate(captured, { configuration: "changed" }).ok, false);
  for (const name of [
    "EXPO_PROJECT_ID",
    "EXPO_UPDATES_CODE_SIGNING_CERTIFICATE",
    "EAS_BUILD_PROFILE",
    "CSC_LINK",
    "WIN_CSC_LINK",
    "APPLE_ID",
    "npm_config_audit_ignore",
  ]) {
    assert.equal(
      evaluate(captured, { environment: { [name]: "configured" } }).ok,
      false
    );
  }
});

await test("configuration guard detects real added/changed signing files and dependency locks", () => {
  const root = mkdtempSync(join(tmpdir(), "zoen-audit-"));
  try {
    execFileSync("git", ["init", "--quiet"], { cwd: root });
    const baseline = configurationHash(root);
    for (const name of [
      "app.json",
      "app.config.ts",
      "eas.json",
      ".easignore",
      "credentials.json",
      "pnpm-lock.yaml",
      "Dockerfile",
      "vercel.json",
      "signing.pem",
      "turbo.json",
    ]) {
      writeFileSync(join(root, name), "initial");
      assert.notEqual(configurationHash(root), baseline);
      const initial = configurationHash(root);
      writeFileSync(join(root, name), "changed");
      assert.notEqual(configurationHash(root), initial);
      rmSync(join(root, name));
    }
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});

await test("a successful audit with no blocking findings passes without applying an exception", () => {
  const report = structuredClone(captured);
  report.advisories = {};
  report.metadata.vulnerabilities.high = 0;
  const outcome = evaluate(report, {
    result: { status: 0 },
    now: Date.parse(policy.expiresAt),
  });
  assert.equal(outcome.ok, true);
  assert.equal(outcome.accepted, false);
});
