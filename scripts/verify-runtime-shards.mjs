/// <reference types="node" />
/// <reference lib="es2023.array" />
import assert from "node:assert/strict";
import { lstatSync, readFileSync, readdirSync } from "node:fs";
import { join } from "node:path";

const [directory, jobResult, attemptArgument] = process.argv.slice(2);
assert.equal(jobResult, "success", "Every runtime shard job must succeed.");
assert.ok(directory, "Provide the downloaded runtime report directory.");
const currentAttempt = Number(attemptArgument);
assert.ok(
  attemptArgument &&
    /^[1-9]\d*$/u.test(attemptArgument) &&
    Number.isSafeInteger(currentAttempt),
  "Provide the current positive integer workflow attempt."
);
/** @type {Map<number, { attempt: number, path: string }>} */
const latest = new Map();
for (const artifact of readdirSync(directory, { withFileTypes: true })) {
  const match = /^runtime-report-([1-4])-attempt-([1-9]\d*)$/u.exec(
    artifact.name
  );
  assert.ok(
    artifact.isDirectory() && match,
    `Unexpected runtime report artifact: ${artifact.name}.`
  );
  const shard = Number(match[1]);
  const attempt = Number(match[2]);
  assert.ok(
    Number.isSafeInteger(attempt) && attempt <= currentAttempt,
    `${artifact.name}: attempt exceeds the current workflow attempt.`
  );
  const reportName = `shard-${shard}.json`;
  const artifactDirectory = join(directory, artifact.name);
  assert.deepEqual(
    readdirSync(artifactDirectory),
    [reportName],
    `${artifact.name}: exactly its own shard report is required.`
  );
  const path = join(artifactDirectory, reportName);
  assert.ok(
    lstatSync(path).isFile(),
    `${path}: report must be a regular file.`
  );
  if (attempt > (latest.get(shard)?.attempt ?? 0)) {
    latest.set(shard, { attempt, path });
  }
}
const reports = [1, 2, 3, 4].map((shard) => {
  const report = latest.get(shard);
  assert.ok(report, `Missing runtime report for shard ${shard}.`);
  return report.path;
});
// These files are the union of both projects in vitest.runtime.config.ts.
const expectedFiles = readdirSync(new URL("../tests/runtime/", import.meta.url))
  .filter((name) => name.endsWith(".integration.ts"))
  .map((name) => `tests/runtime/${name}`)
  .toSorted();
/** @type {Set<string>} */
const files = new Set();
let passedTests = 0;

for (const reportName of reports) {
  /** @type {unknown} */
  const report = JSON.parse(readFileSync(reportName, "utf8"));
  assert.partialDeepStrictEqual(
    report,
    { success: true },
    `${reportName}: run did not pass.`
  );
  for (const field of [
    "numFailedTestSuites",
    "numPendingTestSuites",
    "numFailedTests",
    "numPendingTests",
    "numTodoTests",
  ]) {
    assert.partialDeepStrictEqual(
      report,
      { [field]: 0 },
      `${reportName}: ${field} must be zero.`
    );
  }
  assert.ok(
    report &&
      typeof report === "object" &&
      "testResults" in report &&
      Array.isArray(report.testResults),
    `${reportName}: missing files.`
  );
  /** @type {unknown[]} */
  const testResults = report.testResults;
  assert.ok(testResults.length > 0, `${reportName}: empty shard.`);
  let shardTests = 0;
  for (const file of testResults) {
    assert.partialDeepStrictEqual(
      file,
      { status: "passed" },
      `${reportName}: file did not pass.`
    );
    assert.ok(
      file &&
        typeof file === "object" &&
        "name" in file &&
        typeof file.name === "string",
      `${reportName}: missing file name.`
    );
    const path = file.name.slice(file.name.lastIndexOf("/tests/runtime/") + 1);
    assert.ok(
      expectedFiles.includes(path),
      `${reportName}: unexpected file ${file.name}.`
    );
    assert.ok(!files.has(path), `Runtime file ran more than once: ${path}.`);
    files.add(path);
    assert.ok(
      "assertionResults" in file && Array.isArray(file.assertionResults),
      `${path}: missing tests.`
    );
    /** @type {unknown[]} */
    const assertions = file.assertionResults;
    assert.ok(assertions.length > 0, `${path}: empty file.`);
    for (const test of assertions) {
      assert.partialDeepStrictEqual(
        test,
        { status: "passed" },
        `${path}: test did not pass.`
      );
    }
    shardTests += assertions.length;
  }
  assert.partialDeepStrictEqual(
    report,
    { numTotalTests: shardTests },
    `${reportName}: total differs from assertions.`
  );
  assert.partialDeepStrictEqual(
    report,
    { numPassedTests: shardTests },
    `${reportName}: passed count differs from assertions.`
  );
  passedTests += shardTests;
}

assert.deepEqual(
  [...files].toSorted(),
  expectedFiles,
  "Runtime file coverage is incomplete."
);
console.log(
  `Runtime shards passed: ${files.size} files, ${passedTests} tests, no failures or skips.`
);
