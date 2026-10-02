/// <reference types="node" />
/// <reference lib="es2023.array" />
import assert from "node:assert/strict";
import { readFileSync, readdirSync } from "node:fs";
import { join } from "node:path";

const [directory, jobResult] = process.argv.slice(2);
assert.equal(jobResult, "success", "Every runtime shard job must succeed.");
assert.ok(directory, "Provide the downloaded runtime report directory.");
const reports = [1, 2, 3, 4].map((shard) => `shard-${shard}.json`);
assert.deepEqual(
  readdirSync(directory).toSorted(),
  reports,
  "Exactly four runtime shard reports are required."
);
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
  const report = JSON.parse(readFileSync(join(directory, reportName), "utf8"));
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
// Requalify this baseline when runtime cases are intentionally added or removed.
assert.equal(
  passedTests,
  584,
  "Runtime case count differs from the qualified baseline."
);
console.log(
  `Runtime shards passed: ${files.size} files, ${passedTests} tests, no failures or skips.`
);
