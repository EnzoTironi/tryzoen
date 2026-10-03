import { spawnSync } from "node:child_process";
import {
  mkdirSync,
  mkdtempSync,
  readdirSync,
  rmSync,
  symlinkSync,
  writeFileSync,
} from "node:fs";
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

function reportPath(shard: number, attempt = 1) {
  return join(
    directory,
    `runtime-report-${shard + 1}-attempt-${attempt}`,
    `shard-${shard + 1}.json`
  );
}

function writeReport(
  shard: number,
  value: ReturnType<typeof report>,
  attempt = 1
) {
  mkdirSync(join(directory, `runtime-report-${shard + 1}-attempt-${attempt}`), {
    recursive: true,
  });
  writeFileSync(reportPath(shard, attempt), JSON.stringify(value));
}

function verify(result = "success", attempt = "1") {
  return spawnSync(process.execPath, [script, directory, result, attempt], {
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
  rmSync(join(directory, "runtime-report-4-attempt-1"), { recursive: true });
  expect(verify().stderr).toContain("Missing runtime report for shard 4");
});

test("rejects an unexpected shard report", () => {
  writeFileSync(join(directory, "shard-5.json"), "{}");
  expect(verify().stderr).toContain("Unexpected runtime report artifact");
});

test("rejects a malformed report", () => {
  writeFileSync(reportPath(0), "{");
  expect(verify().status).not.toBe(0);
});

test("uses a passing retry while retaining the older failed report", () => {
  writeReport(1, { ...report(1), success: false });
  writeReport(1, report(1), 2);
  const result = verify("success", "2");
  expect(result.status).toBe(0);
  expect(result.stderr).toBe("");
  expect(readdirSync(directory)).toHaveLength(5);
});

test("rejects the newest failed retry even when older attempts passed", () => {
  writeReport(1, report(1), 2);
  writeReport(1, { ...report(1), success: false }, 10);
  expect(verify("success", "10").stderr).toContain("run did not pass");
});

test("rejects an empty latest artifact rather than using an older report", () => {
  writeReport(1, report(1), 2);
  rmSync(reportPath(1, 2));
  expect(verify("success", "2").stderr).toContain(
    "exactly its own shard report is required"
  );
});

test("accepts an aggregate-only retry using the latest reports of all four shards", () => {
  const result = verify("success", "2");
  expect(result.status).toBe(0);
  expect(result.stderr).toBe("");
});

test("rejects artifacts from a future attempt", () => {
  writeReport(1, report(1), 2);
  expect(verify().stderr).toContain(
    "attempt exceeds the current workflow attempt"
  );
});

test.each(["", "0", "-1", "01", "1.5", "9007199254740992"])(
  "rejects the invalid current attempt %s",
  (attempt) => {
    expect(verify("success", attempt).stderr).toContain(
      "Provide the current positive integer workflow attempt"
    );
  }
);

test.each([
  "runtime-report-5-attempt-1",
  "runtime-report-1-attempt-01",
  "runtime-report-1-attempt-0",
  "runtime-report-1-attempt-9007199254740992",
])("rejects the invalid artifact name %s", (name) => {
  mkdirSync(join(directory, name));
  expect(verify().status).not.toBe(0);
});

test("rejects an artifact containing another shard's report", () => {
  writeFileSync(
    join(directory, "runtime-report-1-attempt-1", "shard-2.json"),
    JSON.stringify(report(1))
  );
  expect(verify().stderr).toContain("exactly its own shard report is required");
});

test("rejects a report linked outside its artifact", () => {
  rmSync(reportPath(0));
  symlinkSync(reportPath(1), reportPath(0));
  expect(verify().stderr).toContain("report must be a regular file");
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
