import assert from "node:assert/strict";
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { execFileSync } from "node:child_process";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";
import { configurationHash, evaluateAudit, pathsHash } from "./run.mjs";

const captured = JSON.parse(
  readFileSync(new URL("registry-fixture.json", import.meta.url), "utf8")
);
const policy = JSON.parse(
  readFileSync(new URL("policy.json", import.meta.url), "utf8")
);
const beforeExpiry = Date.parse("2026-10-04T02:58:59Z");
const finding = (report) => Object.values(report.advisories)[0];
const evaluate = (report = captured, changes = {}) =>
  evaluateAudit(
    { status: 1, stdout: JSON.stringify(report), ...changes.result },
    changes.policy || policy,
    changes.configuration || policy.configurationSha256,
    changes.now ?? beforeExpiry,
    changes.environment || {}
  );

test("accepts the exact live registry advisory and keeps the residual risk explicit", () => {
  assert.deepEqual(evaluate().ok, true);
  assert.equal(evaluate().accepted, true);
  assert.match(
    evaluate().message,
    /accepted temporary risk.*Vulnerability remains unfixed/u
  );
  assert.equal(
    pathsHash(finding(captured).findings[0].paths),
    policy.pathsSha256
  );
});

test("expires at the exact deadline and remains closed afterward", () => {
  for (const now of [
    Date.parse(policy.expiresAt),
    Date.parse(policy.expiresAt) + 1,
    NaN,
  ]) {
    assert.equal(evaluate(captured, { now }).ok, false);
  }
});

test("does not allow the policy to extend the deadline or add another advisory", () => {
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

test("blocks a different or additional low-severity advisory", () => {
  const different = structuredClone(captured);
  finding(different).github_advisory_id = "GHSA-aaaa-bbbb-cccc";
  assert.equal(evaluate(different).ok, false);
  const additional = structuredClone(captured);
  additional.advisories.other = { ...finding(different), severity: "low" };
  additional.metadata.vulnerabilities.low = 1;
  assert.equal(evaluate(additional).ok, false);
});

test("blocks wrong package, version, path, duplicated paths and newly available fix", () => {
  const mutations = [
    (item) => {
      item.module_name = "another-package";
    },
    (item) => {
      item.findings[0].version = "1.3.1";
    },
    (item) => {
      item.findings[0].paths[0] = ".>another-package>node-forge";
    },
    (item) => {
      item.findings[0].paths.push(item.findings[0].paths[0]);
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
  finding(reordered).findings[0].paths.reverse();
  assert.equal(evaluate(reordered).ok, true);
});

test("fails transport/process errors, malformed JSON and inconsistent payloads", () => {
  for (const result of [
    { status: 2 },
    { status: null, signal: "SIGTERM" },
    { error: new Error("registry unavailable") },
    { stdout: "{" },
    { stdout: JSON.stringify({ error: "registry unavailable" }) },
    { stdout: "{}" },
    { status: 0 },
  ])
    assert.equal(evaluate(captured, { result }).ok, false);
  const report = structuredClone(captured);
  report.metadata.vulnerabilities.high = 0;
  assert.equal(evaluate(report).ok, false);
});

test("blocks changed configuration and signing environment without reading secret values", () => {
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

test("configuration guard detects real added/changed signing files and dependency locks", () => {
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

test("a successful audit with no blocking findings passes without applying an exception", () => {
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
