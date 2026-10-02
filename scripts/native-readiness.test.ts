import {
  access,
  mkdtemp,
  mkdir,
  readFile,
  rm,
  writeFile,
  chmod,
} from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, expect, test, vi } from "vitest";
import { nativeReadiness } from "./native-readiness.ts";

vi.mock("node:fs/promises", async (importOriginal) => {
  const actual = await importOriginal<typeof import("node:fs/promises")>();
  return { ...actual, access: vi.fn<typeof actual.access>(actual.access) };
});

let root: string;

async function fixture(path: string, contents: string) {
  const fullPath = join(root, path);
  await mkdir(join(fullPath, ".."), { recursive: true });
  await writeFile(fullPath, contents);
  return fullPath;
}

beforeEach(async () => {
  root = await mkdtemp(join(tmpdir(), "zoen-native-readiness-"));
  const actual =
    await vi.importActual<typeof import("node:fs/promises")>(
      "node:fs/promises"
    );
  vi.mocked(access).mockImplementation(actual.access);
  vi.stubEnv("PATH", join(root, "bin"));
  await fixture(
    "apps/desktop/package.json",
    JSON.stringify({
      name: "@zoen/desktop",
      version: "0.1.0",
      devDependencies: { electron: "44.4.5" },
      scripts: { "build:desktop": "tsc -p tsconfig.json", dev: "electron ." },
    })
  );
  await fixture(
    "apps/mobile/package.json",
    JSON.stringify({
      name: "@zoen/mobile",
      version: "0.1.0",
      dependencies: { expo: "57.0.26" },
      scripts: {
        "build:ios": "expo export --platform ios",
        ios: "expo run:ios",
      },
    })
  );
  await fixture(
    "apps/desktop/node_modules/electron/package.json",
    '{"version":"44.4.5"}'
  );
  await fixture(
    "apps/mobile/node_modules/expo/package.json",
    '{"version":"57.0.26"}'
  );
});

afterEach(async () => {
  vi.unstubAllEnvs();
  await rm(root, { recursive: true, force: true });
});

test("installed npm packages and compiled JavaScript never imply native executable or device acceptance", async () => {
  await fixture("apps/desktop/dist/main.js", "// compiled JavaScript only");
  const report = await nativeReadiness(root);
  if (!("packages" in report.desktop))
    throw new Error("Expected package inventory");
  expect(
    report.desktop.packages.find((entry) => entry.name === "electron")
  ).toEqual({
    name: "electron",
    declared: "44.4.5",
    installed: "44.4.5",
    status: "supported",
  });
  expect(report.mobile).toMatchObject({
    scripts: { "build:ios": "expo export --platform ios", ios: "expo run:ios" },
  });
  expect(
    report.artifacts.find(
      (entry) => entry.relativePath === "apps/desktop/dist/main.js"
    )?.status
  ).toBe("supported");
  expect(
    report.artifacts.find(
      (entry) =>
        entry.relativePath === "apps/desktop/node_modules/electron/path.txt"
    )?.status
  ).toBe("unavailable");
  expect(report.nativeExecution.status).toBe("unknown");
  expect(report.ios.service.status).toBe("unknown");
  expect(report.android.connectedDevices.status).toBe("unknown");
});

test("filesystem inspection does not execute available native tools or package scripts and never dumps credential environment", async () => {
  const sentinel = join(root, "must-not-exist");
  const tool = await fixture(
    "bin/xcodebuild",
    `#!/bin/sh\ntouch '${sentinel}'\n`
  );
  await chmod(tool, 0o755);
  await fixture(
    "apps/mobile/package.json",
    JSON.stringify({
      name: "@zoen/mobile",
      version: "0.1.0",
      scripts: { ios: `touch '${sentinel}'` },
    })
  );
  vi.stubEnv("BETTER_AUTH_SECRET", "credential-must-not-enter-report");
  const report = await nativeReadiness(root);
  expect(
    report.tools.find((entry) => entry.name === "xcodebuild")?.status
  ).toBe("supported");
  await expect(readFile(sentinel)).rejects.toMatchObject({ code: "ENOENT" });
  expect(JSON.stringify(report)).not.toContain(
    "credential-must-not-enter-report"
  );
});

test("unreadable prerequisites remain unknown rather than being reported as absent", async () => {
  const actual =
    await vi.importActual<typeof import("node:fs/promises")>(
      "node:fs/promises"
    );
  vi.mocked(access).mockImplementation(async (path, mode) => {
    if (String(path) === join(root, "bin/xcodebuild")) {
      throw Object.assign(new Error("permission boundary"), { code: "EACCES" });
    }
    return actual.access(path, mode);
  });
  const report = await nativeReadiness(root);
  expect(
    report.tools.find((entry) => entry.name === "xcodebuild")
  ).toMatchObject({ status: "unknown", evidence: "Filesystem read: EACCES." });
  expect(report.tools.find((entry) => entry.name === "emulator")?.status).toBe(
    "unavailable"
  );
});

test("an executable PATH candidate must be a file, not a traversable directory", async () => {
  await mkdir(join(root, "bin/node"), { recursive: true });
  const report = await nativeReadiness(root);
  expect(report.tools.find((entry) => entry.name === "node")?.status).toBe(
    "unavailable"
  );
});

test("static notification and protocol markers remain candidates regardless of whether they are found", async () => {
  await fixture(
    "apps/desktop/src/main.ts",
    "app.setAsDefaultProtocolClient('zoen'); new Notification();"
  );
  let report = await nativeReadiness(root);
  expect(
    report.candidates.filter(
      (entry) => "markerFound" in entry && entry.markerFound
    )
  ).toHaveLength(2);
  expect(report.candidates.every((entry) => entry.status !== "supported")).toBe(
    true
  );
  await fixture("apps/desktop/src/main.ts", "// no native bridge");
  report = await nativeReadiness(root);
  expect(
    report.candidates.find((entry) =>
      entry.evidence.includes("Browser notification support")
    )
  ).toMatchObject({ status: "unknown", markerFound: false });
});

test("malformed package metadata and missing installations are distinct and do not abort the inventory", async () => {
  await fixture("apps/mobile/package.json", "invalid JSON");
  await rm(join(root, "apps/desktop/package.json"));
  const report = await nativeReadiness(root);
  expect(report.mobile.status).toBe("unknown");
  expect(report.mobile.evidence).toBe("Invalid package JSON.");
  expect(report.desktop.status).toBe("unavailable");
  expect(report.nativeExecution.status).toBe("unknown");
});

test("extracted native adapter and application call sites remain static candidates", async () => {
  await fixture(
    "apps/mobile/src/app.tsx",
    "subscribeAndroidBack(goBack); subscribeContentLinks(receive, fail);"
  );
  await fixture(
    "apps/mobile/src/navigation/native.ts",
    "BackHandler.addEventListener('hardwareBackPress', back); Linking.addEventListener('url', receive); Linking.getInitialURL();"
  );
  const report = await nativeReadiness(root);
  for (const evidence of [
    "Application back marker",
    "Application URL marker",
    "Native back adapter marker",
    "Native URL adapter marker",
  ]) {
    expect(
      report.candidates.find((entry) => entry.evidence.includes(evidence))
    ).toMatchObject({ status: "unknown", markerFound: true });
  }
  expect(report.nativeExecution.status).toBe("unknown");
});
