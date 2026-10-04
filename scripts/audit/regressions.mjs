/// <reference types="node" />
import assert from "node:assert/strict";
import {
  copyFileSync,
  mkdirSync,
  mkdtempSync,
  readFileSync,
  realpathSync,
  rmSync,
  symlinkSync,
  writeFileSync,
} from "node:fs";
import { execFileSync, spawnSync } from "node:child_process";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import test from "node:test";
import { fileURLToPath } from "node:url";
import {
  configurationHash,
  evaluateAudit,
  pathsHash,
  readAuditReport,
} from "./run.mjs";

const captured = readAuditReport(
  readFileSync(new URL("registry-fixture.json", import.meta.url), "utf8")
);
const capturedInfrastructure = readAuditReport(
  readFileSync(
    new URL("registry-infrastructure-fixture.json", import.meta.url),
    "utf8"
  )
);
import policy from "./policy.json" with { type: "json" };
const beforeExpiry = Date.parse("2026-10-05T02:58:59Z");
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
 * @param {{result?: Partial<Parameters<typeof evaluateAudit>[0]["result"]>, policy?: unknown, configuration?: string, now?: number, environment?: Record<string, unknown>, graph?: Parameters<typeof evaluateAudit>[0]["graph"]}} [changes]
 */
const evaluate = (report = captured, changes = {}) =>
  evaluateAudit({
    result: { status: 1, stdout: JSON.stringify(report), ...changes.result },
    policy: changes.policy ?? policy,
    configuration: changes.configuration ?? policy.configurationSha256,
    now: changes.now ?? beforeExpiry,
    environmentNames: Object.keys(changes.environment ?? {}),
    graph: changes.graph ?? "application",
  });

await test("accepts the exact live registry advisory and keeps the residual risk explicit", () => {
  assert.deepEqual(evaluate().ok, true);
  assert.equal(evaluate().accepted, true);
  assert.match(
    evaluate().message,
    /accepted temporary risk.*Vulnerabilities remain unfixed/u
  );
  assert.equal(
    pathsHash(firstFinding(finding(captured)).paths),
    policy.graphs.application["GHSA-86w9-cpqp-85rv"].pathsSha256
  );
});

await test("accepts only each graph's exact reviewed report and keeps graph authority separate", () => {
  const outcome = evaluate(capturedInfrastructure, { graph: "infrastructure" });
  assert.equal(outcome.ok, true);
  assert.equal(outcome.accepted, true);
  assert.match(outcome.message, /infrastructure: accepted temporary risk/u);
  assert.equal(evaluate(captured, { graph: "infrastructure" }).ok, false);
  assert.equal(evaluate(capturedInfrastructure).ok, false);
  const duplicate = structuredClone(captured);
  const items = Object.values(duplicate.advisories);
  assert.ok(items[1]);
  items[1].github_advisory_id = finding(duplicate).github_advisory_id;
  assert.equal(evaluate(duplicate).ok, false);
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
    { expiresAt: "2026-10-06T02:59:00Z" },
    { advisory: "GHSA-aaaa-bbbb-cccc" },
  ]) {
    assert.equal(
      evaluate(captured, { policy: { ...policy, ...changed } }).ok,
      false
    );
  }
  const expanded = structuredClone(policy);
  Object.assign(expanded.graphs.application, {
    "GHSA-aaaa-bbbb-cccc": expanded.graphs.application["GHSA-86w9-cpqp-85rv"],
  });
  assert.equal(evaluate(captured, { policy: expanded }).ok, false);
});

await test("rejects the expired version-two decision and the removed cache exception", () => {
  for (const changed of [
    { schemaVersion: 2 },
    { expiresAt: "2026-10-04T02:59:00Z" },
  ]) {
    for (const graph of ["application", "infrastructure"]) {
      const report =
        graph === "application" ? captured : capturedInfrastructure;
      assert.equal(
        evaluate(report, { policy: { ...policy, ...changed }, graph }).ok,
        false
      );
    }
  }
  const expanded = structuredClone(policy);
  Object.assign(expanded.graphs.application, {
    "GHSA-ch52-4w7c-c8xp": {
      package: "http-cache-semantics",
      version: "4.2.0",
      pathsSha256:
        "77abf37b86ef369a1ed1bcc53491fb978ffc1f0085f934a36f37247d26612457",
    },
  });
  assert.equal(evaluate(captured, { policy: expanded }).ok, false);
});

await test("blocks a different or additional low-severity advisory", () => {
  const different = structuredClone(captured);
  finding(different).github_advisory_id = "GHSA-aaaa-bbbb-cccc";
  assert.equal(evaluate(different).ok, false);
  const additional = structuredClone(captured);
  additional.advisories.other = { ...finding(different), severity: "low" };
  additional.metadata.vulnerabilities.low = 1;
  assert.equal(evaluate(additional).ok, false);
  additional.advisories.other.severity = "info";
  additional.metadata.vulnerabilities.low = 0;
  additional.metadata.vulnerabilities.info = 1;
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

await test("rejects a changed version, severity, dependency path or available fix in every approved graph entry", () => {
  /** @type {((item: ReturnType<typeof finding>) => void)[]} */
  const mutations = [
    (item) => {
      firstFinding(item).version = "0.0.0";
    },
    (item) => {
      item.severity = "moderate";
    },
    (item) => {
      firstFinding(item).paths.push(".>unreviewed>dependency");
    },
    (item) => {
      item.patched_versions = ">=99.0.0";
    },
  ];
  for (const report of [captured, capturedInfrastructure]) {
    const graph = report === captured ? "application" : "infrastructure";
    for (const id of Object.keys(report.advisories)) {
      for (const mutate of mutations) {
        const changed = structuredClone(report);
        const item = changed.advisories[id];
        assert.ok(item);
        mutate(item);
        if (item.severity === "moderate") {
          changed.metadata.vulnerabilities.high -= 1;
          changed.metadata.vulnerabilities.moderate += 1;
        }
        assert.equal(evaluate(changed, { graph }).ok, false);
      }
    }
  }
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
  });
  assert.equal(outcome.ok, true);
  assert.equal(outcome.accepted, false);
});

await test("clean audit reports cannot bypass expiry, configuration or inherited selector guards", () => {
  const report = structuredClone(captured);
  report.advisories = {};
  report.metadata.vulnerabilities.high = 0;
  for (const changes of [
    { now: Date.parse(policy.expiresAt) },
    { configuration: "changed" },
    { policy: { ...policy, expiresAt: "2026-10-06T02:59:00Z" } },
    ...[
      "PNPM_CONFIG_LOCKFILE_DIR",
      "pnpm_config_lockfile_dir",
      "NPM_CONFIG_LOCKFILE_DIR",
      "npm_config_lockfile_dir",
      "PNPM_CONFIG_DIR",
      "npm_config_prefix",
      "PNPM_CONFIG_ONLY",
      "PNPM_CONFIG_PRODUCTION",
      "pnpm_config_dev",
      "NPM_CONFIG_OPTIONAL",
      "PNPM_CONFIG_AUDIT_LEVEL",
      "pnpm_config_audit_ignore",
      "EXPO_PROJECT_ID",
      "EAS_BUILD_PROFILE",
      "CSC_LINK",
      "WIN_CSC_LINK",
      "APPLE_ID",
    ].map((name) => ({ environment: { [name]: "configured" } })),
  ]) {
    const outcome = evaluate(report, { result: { status: 0 }, ...changes });
    assert.equal(outcome.ok, false);
    assert.equal(outcome.accepted, false);
  }
});

await test("the real wrapper through a symlink rejects alternate-lockfile selection and pins its source", () => {
  const root = realpathSync(mkdtempSync(join(tmpdir(), "zoen-audit-source-")));
  const marker = join(root, "invoked");
  const argumentsPath = join(root, "arguments.json");
  const alternate = join(root, "alternate");
  const repository = join(root, "repository");
  const script = join(repository, "scripts/audit/run.mjs");
  const alias = join(root, "audit-alias.mjs");
  const repositoryAlias = join(root, "repository-alias");
  const clock = join(root, "clock.mjs");
  try {
    mkdirSync(dirname(script), { recursive: true });
    for (const name of ["run.mjs", "env.mjs"]) {
      const source = new URL(name, import.meta.url);
      const destination = join(dirname(script), name);
      copyFileSync(source, destination);
      assert.deepEqual(readFileSync(destination), readFileSync(source));
    }
    symlinkSync(script, alias);
    symlinkSync(repository, repositoryAlias, "dir");
    symlinkSync(
      fileURLToPath(new URL("../../node_modules", import.meta.url)),
      join(repository, "node_modules"),
      "dir"
    );
    writeFileSync(join(repository, ".gitignore"), "node_modules\n");
    writeFileSync(join(repository, "package.json"), '{"type":"module"}\n');
    writeFileSync(
      join(repository, "pnpm-lock.yaml"),
      "lockfileVersion: '9.0'\nimporters:\n  .: {}\n"
    );
    const infrastructure = join(repository, "infrastructure");
    mkdirSync(infrastructure);
    writeFileSync(join(infrastructure, "package.json"), '{"type":"module"}\n');
    writeFileSync(
      join(infrastructure, "pnpm-lock.yaml"),
      "lockfileVersion: '9.0'\nimporters:\n  .: {}\n"
    );
    execFileSync("git", ["init", "--quiet"], { cwd: repository });
    execFileSync("git", ["add", "package.json", "pnpm-lock.yaml"], {
      cwd: repository,
    });
    writeFileSync(
      join(dirname(script), "policy.json"),
      JSON.stringify({
        ...policy,
        configurationSha256: configurationHash(repository),
      })
    );
    writeFileSync(clock, `Date.now = () => ${beforeExpiry};\n`);
    mkdirSync(alternate);
    writeFileSync(
      join(alternate, "pnpm-lock.yaml"),
      "lockfileVersion: '9.0'\nimporters:\n  .: {}\n"
    );
    const clean = JSON.stringify({
      advisories: {},
      metadata: {
        vulnerabilities: { info: 0, low: 0, moderate: 0, high: 0, critical: 0 },
      },
    });
    /** @param {string} output @param {string} ending */
    const writeAuditCommand = (output, ending) => {
      writeFileSync(
        join(root, "pnpm"),
        `#!${process.execPath}\nimport { writeFileSync } from "node:fs";\nwriteFileSync(${JSON.stringify(marker)}, "invoked");\nwriteFileSync(${JSON.stringify(argumentsPath)}, JSON.stringify(process.argv.slice(2)));\nprocess.stdout.write(${JSON.stringify(output)});\n${ending}\n`,
        { mode: 0o700 }
      );
    };
    // Stub the external audit report, then exercise the actual wrapper process.
    writeAuditCommand(clean, "process.exitCode = 0;");
    const environment = {
      PATH: `${root}:${dirname(process.execPath)}:/usr/bin:/bin`,
    };
    for (const name of [
      "PNPM_CONFIG_LOCKFILE_DIR",
      "pnpm_config_lockfile_dir",
      "NPM_CONFIG_LOCKFILE_DIR",
      "npm_config_lockfile_dir",
    ]) {
      const denied = spawnSync(process.execPath, ["--import", clock, alias], {
        cwd: alternate,
        env: { ...environment, [name]: alternate },
        encoding: "utf8",
      });
      assert.equal(denied.status, 1);
      assert.match(denied.stdout, /configuration changed/u);
      assert.throws(() => readFileSync(marker), { code: "ENOENT" });
    }
    const success = spawnSync(process.execPath, ["--import", clock, alias], {
      cwd: alternate,
      env: environment,
      encoding: "utf8",
    });
    assert.equal(
      success.status,
      0,
      `stdout:\n${success.stdout}\nstderr:\n${success.stderr}`
    );
    assert.equal(readFileSync(marker, "utf8"), "invoked");
    const pinnedArguments = JSON.stringify([
      "audit",
      `--dir=${repository}`,
      `--config.lockfile-dir=${repository}`,
      "--only=null",
      "--production=false",
      "--dev=false",
      "--optional=true",
      "--audit-level=low",
      "--json",
      "--registry=https://registry.npmjs.org",
    ]);
    assert.equal(readFileSync(argumentsPath, "utf8"), pinnedArguments);
    for (const graph of ["unreviewed", "../alternate"]) {
      rmSync(marker, { force: true });
      const invalid = spawnSync(
        process.execPath,
        ["--import", clock, alias, "--graph", graph],
        {
          cwd: alternate,
          env: environment,
          encoding: "utf8",
        }
      );
      assert.equal(invalid.status, 1);
      assert.throws(() => readFileSync(marker), { code: "ENOENT" });
    }
    writeAuditCommand(
      JSON.stringify(capturedInfrastructure),
      "process.exitCode = 1;"
    );
    const infrastructureResult = spawnSync(
      process.execPath,
      ["--import", clock, alias, "--graph", "infrastructure"],
      {
        cwd: alternate,
        env: environment,
        encoding: "utf8",
      }
    );
    assert.equal(
      infrastructureResult.status,
      0,
      infrastructureResult.stdout + infrastructureResult.stderr
    );
    assert.ok(
      infrastructureResult.stdout.startsWith(
        JSON.stringify(capturedInfrastructure)
      )
    );
    assert.equal(
      readFileSync(argumentsPath, "utf8"),
      JSON.stringify([
        "audit",
        `--dir=${infrastructure}`,
        `--config.lockfile-dir=${infrastructure}`,
        "--only=null",
        "--production=false",
        "--dev=false",
        "--optional=true",
        "--audit-level=low",
        "--json",
        "--registry=https://registry.npmjs.org",
      ])
    );
    writeAuditCommand(clean, "process.exitCode = 0;");
    rmSync(marker);
    rmSync(argumentsPath);
    const preserved = spawnSync(
      process.execPath,
      [
        "--preserve-symlinks-main",
        "--import",
        clock,
        join(repositoryAlias, "scripts/audit/run.mjs"),
      ],
      { cwd: alternate, env: environment, encoding: "utf8" }
    );
    assert.equal(
      preserved.status,
      0,
      `stdout:\n${preserved.stdout}\nstderr:\n${preserved.stderr}`
    );
    assert.equal(readFileSync(marker, "utf8"), "invoked");
    assert.equal(readFileSync(argumentsPath, "utf8"), pinnedArguments);
    const unknown = structuredClone(captured);
    finding(unknown).github_advisory_id = "GHSA-aaaa-bbbb-cccc";
    for (const { output, ending, expectedStatus, message } of [
      {
        output: "{",
        ending: "process.exitCode = 0;",
        expectedStatus: 1,
        message: "Malformed or inconsistent audit JSON",
      },
      {
        output: JSON.stringify(unknown),
        ending: "process.exitCode = 1;",
        expectedStatus: 1,
        message: "Other blocking advisory",
      },
      {
        output: JSON.stringify(captured),
        ending: "process.exitCode = 2;",
        expectedStatus: 2,
        message: "Audit transport/process failure",
      },
      {
        output: "",
        ending: 'process.kill(process.pid, "SIGTERM");',
        expectedStatus: 1,
        message: "Audit transport/process failure",
      },
    ]) {
      writeAuditCommand(output, ending);
      const failure = spawnSync(process.execPath, ["--import", clock, alias], {
        cwd: alternate,
        env: environment,
        encoding: "utf8",
      });
      assert.equal(failure.status, expectedStatus);
      assert.ok(failure.stdout.includes(message));
    }
    writeAuditCommand(clean, "process.exitCode = 0;");
    rmSync(marker);
    mkdirSync(join(repository, ".github/workflows"), { recursive: true });
    const workflow = join(repository, ".github/workflows/checks.yml");
    writeFileSync(workflow, "name: added guarded configuration\n");
    const changed = spawnSync(process.execPath, ["--import", clock, alias], {
      cwd: alternate,
      env: environment,
      encoding: "utf8",
    });
    assert.equal(changed.status, 1);
    assert.match(changed.stdout, /configuration changed/u);
    assert.throws(() => readFileSync(marker), { code: "ENOENT" });
    rmSync(workflow);
    writeFileSync(clock, `Date.now = () => ${Date.parse(policy.expiresAt)};\n`);
    const expired = spawnSync(process.execPath, ["--import", clock, alias], {
      cwd: alternate,
      env: environment,
      encoding: "utf8",
    });
    assert.equal(expired.status, 1);
    assert.match(expired.stdout, /Temporary risk acceptance expired/u);
    assert.throws(() => readFileSync(marker), { code: "ENOENT" });
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});
