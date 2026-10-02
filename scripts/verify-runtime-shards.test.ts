import { spawnSync } from "node:child_process";
import { mkdtempSync, readdirSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { afterEach, beforeEach, expect, test } from "vitest";

const script = fileURLToPath(
  new URL("./verify-runtime-shards.mjs", import.meta.url)
);
const files = readdirSync(new URL("../tests/runtime/", import.meta.url))
  .filter((name) => name.endsWith(".integration.ts"))
  .toSorted();
let directory: string;

function report(shard: number) {
  const testResults = files.flatMap((name, index) =>
    index % 4 === shard
      ? [
          {
            name: `/home/runner/work/app/app/tests/runtime/${name}`,
            status: "passed",
            assertionResults: Array.from({ length: (index % 3) + 1 }, () => ({
              status: "passed",
            })),
          },
        ]
      : []
  );
  const tests = testResults.reduce(
    (count, file) => count + file.assertionResults.length,
    0
  );
  return {
    success: true,
    // Vitest counts nested describe blocks as suites, not only files.
    numTotalTestSuites: testResults.length + 10,
    numPassedTestSuites: testResults.length + 10,
    numFailedTestSuites: 0,
    numPendingTestSuites: 0,
    numTotalTests: tests,
    numPassedTests: tests,
    numFailedTests: 0,
    numPendingTests: 0,
    numTodoTests: 0,
    testResults,
  };
}

function writeReport(shard: number, value: ReturnType<typeof report>) {
  writeFileSync(
    join(directory, `shard-${shard + 1}.json`),
    JSON.stringify(value)
  );
}

function verify(result = "success") {
  return spawnSync(process.execPath, [script, directory, result], {
    encoding: "utf8",
  });
}

beforeEach(() => {
  directory = mkdtempSync(join(tmpdir(), "zoen-runtime-reports-"));
  for (let shard = 0; shard < 4; shard += 1) writeReport(shard, report(shard));
});

afterEach(() => {
  rmSync(directory, { recursive: true, force: true });
});

test("accepts passing cases for every current runtime file with nested suites", () => {
  const passedTests = [0, 1, 2, 3].reduce(
    (count, shard) => count + report(shard).numPassedTests,
    0
  );
  const result = verify();
  expect(result.stderr).toBe("");
  expect(result.status).toBe(0);
  expect(result.stdout).toContain(
    `${files.length} files, ${passedTests} tests, no failures or skips`
  );
});

test.each(["failure", "cancelled", "skipped", ""])(
  "rejects %s matrix results even when all reports say passed",
  (jobResult) => {
    const result = verify(jobResult);
    expect(result.status).not.toBe(0);
    expect(result.stderr).toContain("Every runtime shard job must succeed");
  }
);

test("rejects a missing shard report", () => {
  rmSync(join(directory, "shard-4.json"));
  expect(verify().stderr).toContain(
    "Exactly four runtime shard reports are required"
  );
});

test("rejects an unexpected shard report", () => {
  writeFileSync(join(directory, "shard-5.json"), "{}");
  expect(verify().stderr).toContain(
    "Exactly four runtime shard reports are required"
  );
});

test("rejects a malformed report", () => {
  writeFileSync(join(directory, "shard-1.json"), "{");
  expect(verify().status).not.toBe(0);
});

test.each([
  "numFailedTestSuites",
  "numPendingTestSuites",
  "numFailedTests",
  "numPendingTests",
  "numTodoTests",
] satisfies (keyof ReturnType<typeof report>)[])(
  "rejects a nonzero %s",
  (field) => {
    const value = report(0);
    value[field] = 1;
    writeReport(0, value);
    expect(verify().stderr).toContain(`${field} must be zero`);
  }
);

test("rejects a report that marks the run failed", () => {
  writeReport(0, { ...report(0), success: false });
  expect(verify().stderr).toContain("run did not pass");
});

test.each(["numTotalTests", "numPassedTests"])(
  "cross-checks %s against assertions",
  (field) => {
    writeReport(0, { ...report(0), [field]: 0 });
    expect(verify().stderr).toContain("differs from assertions");
  }
);

test.each(["failed", "pending", "skipped", "todo"])(
  "rejects %s assertions even when report counters claim success",
  (status) => {
    const value = report(0);
    const file = value.testResults[0];
    if (!file) throw new Error("Fixture must contain a file.");
    file.assertionResults[0] = { status };
    writeReport(0, value);
    expect(verify().stderr).toContain("test did not pass");
  }
);

test("rejects a failed file even when its assertions pass", () => {
  const value = report(0);
  const file = value.testResults[0];
  if (!file) throw new Error("Fixture must contain a file.");
  file.status = "failed";
  writeReport(0, value);
  expect(verify().stderr).toContain("file did not pass");
});

test("rejects overlapping shards", () => {
  writeReport(1, report(0));
  expect(verify().stderr).toContain("Runtime file ran more than once");
});

test("rejects a repeated file within one shard", () => {
  const value = report(0);
  value.testResults.push(...value.testResults);
  writeReport(0, value);
  expect(verify().stderr).toContain("Runtime file ran more than once");
});

test("rejects files outside the configured runtime selection", () => {
  const value = report(0);
  const file = value.testResults[0];
  if (!file) throw new Error("Fixture must contain a file.");
  file.name =
    "/home/runner/work/app/app/tests/runtime/matrix-lock-order.proof.ts";
  writeReport(0, value);
  expect(verify().stderr).toContain("unexpected file");
});

test("rejects an omitted file even with internally consistent totals", () => {
  const value = report(0);
  const file = value.testResults.pop();
  if (!file) throw new Error("Fixture must contain a file.");
  value.numTotalTests -= file.assertionResults.length;
  value.numPassedTests = value.numTotalTests;
  writeReport(0, value);
  expect(verify().stderr).toContain("Runtime file coverage is incomplete");
});
