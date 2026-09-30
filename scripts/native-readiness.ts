import { constants } from "node:fs";
import { access, readFile, readdir, stat } from "node:fs/promises";
import { arch, homedir, platform, release } from "node:os";
import { delimiter, dirname, join, resolve } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
import { parseArgs } from "node:util";
import { z } from "zod";

type EvidenceStatus = "supported" | "unknown" | "unavailable";
interface Observation {
  status: EvidenceStatus;
  evidence: string;
  path?: string;
  entries?: string[];
}

const packageSchema = z.object({
  name: z.string(),
  version: z.string(),
  scripts: z.record(z.string(), z.string()).default({}),
  dependencies: z.record(z.string(), z.string()).default({}),
  devDependencies: z.record(z.string(), z.string()).default({}),
});

function readFailure(error: unknown, path: string): Observation {
  const code = z.object({ code: z.string() }).safeParse(error);
  return {
    status:
      code.success && code.data.code === "ENOENT" ? "unavailable" : "unknown",
    evidence: code.success
      ? `Filesystem read: ${code.data.code}.`
      : error instanceof SyntaxError
        ? "Invalid package JSON."
        : error instanceof z.ZodError
          ? "Invalid installed package metadata."
          : "Filesystem read failed.",
    path,
  };
}

async function presence(
  path: string,
  executable = false
): Promise<Observation> {
  try {
    await access(path, executable ? constants.X_OK : constants.F_OK);
    if (executable && !(await stat(path)).isFile()) {
      return {
        status: "unavailable",
        evidence: "Path is not an executable file.",
        path,
      };
    }
    return {
      status: "supported",
      evidence: "Present; not executed or validated.",
      path,
    };
  } catch (error) {
    return readFailure(error, path);
  }
}

async function directory(path: string): Promise<Observation> {
  try {
    const entries = (await readdir(path, { withFileTypes: true }))
      .filter((entry) => entry.isDirectory())
      .map((entry) => entry.name)
      .toSorted();
    return {
      status: entries.length > 0 ? "supported" : "unavailable",
      evidence: `${String(entries.length)} on-disk directories; not a live device/service query. Names capped at 32.`,
      path,
      entries: entries.slice(0, 32),
    };
  } catch (error) {
    return readFailure(error, path);
  }
}

async function commandPath(name: string): Promise<Observation> {
  // Only PATH is read; paths are reported, but raw environment/credential values are not.
  /* oxlint-disable eslint/no-restricted-properties, turbo/no-undeclared-env-vars -- PATH locates files only; no native execution is performed. */
  const paths = (process.env.PATH ?? "").split(delimiter).filter(Boolean);
  /* oxlint-enable eslint/no-restricted-properties, turbo/no-undeclared-env-vars */
  const candidates = await Promise.all(
    paths.map((path) => presence(join(path, name), true))
  );
  return (
    candidates.find((candidate) => candidate.status !== "unavailable") ?? {
      status: "unavailable",
      evidence: `${name} was not found on PATH.`,
    }
  );
}

async function packageInventory(
  root: string,
  owner: string,
  names: string[],
  scripts: string[]
) {
  const path = join(root, owner, "package.json");
  try {
    const parsed = packageSchema.safeParse(
      JSON.parse(await readFile(path, "utf8"))
    );
    if (!parsed.success)
      return {
        status: "unknown" as const,
        evidence: "Package manifest is invalid.",
        path,
      };
    const installed = await Promise.all(
      names.map(async (name) => {
        const installedPath = join(
          root,
          owner,
          "node_modules",
          name,
          "package.json"
        );
        try {
          const version = z
            .object({ version: z.string() })
            .parse(JSON.parse(await readFile(installedPath, "utf8")));
          return {
            name,
            declared:
              parsed.data.dependencies[name] ??
              parsed.data.devDependencies[name],
            installed: version.version,
            status: "supported" as const,
          };
        } catch (error) {
          return {
            name,
            declared:
              parsed.data.dependencies[name] ??
              parsed.data.devDependencies[name],
            ...readFailure(error, installedPath),
          };
        }
      })
    );
    return {
      status: "supported" as const,
      evidence:
        "Manifest and installed versions only; no compatibility or execution check.",
      path,
      name: parsed.data.name,
      packages: installed,
      scripts: Object.fromEntries(
        scripts.map((name) => [name, parsed.data.scripts[name] ?? null])
      ),
    };
  } catch (error) {
    return readFailure(error, path);
  }
}

async function sourceCandidate(
  root: string,
  path: string,
  pattern: RegExp,
  found: string,
  absent: string
) {
  try {
    const matched = pattern.test(await readFile(join(root, path), "utf8"));
    return {
      status: "unknown" as const,
      path,
      markerFound: matched,
      evidence: matched ? found : absent,
      requires:
        "Validate in the running native application; source markers are candidates, not capability proof.",
    };
  } catch (error) {
    return readFailure(error, path);
  }
}

/** Read local manifests, paths and source markers without executing native tools. */
export async function nativeReadiness(root: string) {
  const repositoryRoot = resolve(root);
  const home = homedir();
  const sdkRoots = [
    join(home, "Library/Android/sdk"),
    "/opt/homebrew/share/android-commandlinetools",
    "/usr/local/share/android-commandlinetools",
  ];
  const [desktop, mobile, tools, androidSdks, artifacts, candidates] =
    await Promise.all([
      packageInventory(
        repositoryRoot,
        "apps/desktop",
        ["electron", "electron-builder"],
        ["build:desktop", "dev", "package", "dist"]
      ),
      packageInventory(
        repositoryRoot,
        "apps/mobile",
        [
          "expo",
          "react-native",
          "typescript",
          "expo-document-picker",
          "expo-notifications",
        ],
        [
          "typecheck",
          "start",
          "ios",
          "android",
          "build:web",
          "build:ios",
          "build:android",
        ]
      ),
      Promise.all(
        [
          "node",
          "pnpm",
          "xcodebuild",
          "xcrun",
          "pod",
          "java",
          "javac",
          "adb",
          "emulator",
          "sdkmanager",
          "watchman",
        ].map(async (name) => Object.assign({ name }, await commandPath(name)))
      ),
      Promise.all(
        sdkRoots.map(async (path) => ({
          path,
          platforms: await directory(join(path, "platforms")),
          buildTools: await directory(join(path, "build-tools")),
          emulator: await presence(join(path, "emulator", "emulator"), true),
          systemImages: await directory(join(path, "system-images")),
        }))
      ),
      Promise.all(
        [
          "apps/desktop/dist/main.js",
          "apps/desktop/node_modules/electron/path.txt",
          "apps/desktop/node_modules/electron/dist/Electron.app/Contents/MacOS/Electron",
          "apps/desktop/node_modules/electron/dist/electron",
          "apps/desktop/node_modules/electron/dist/electron.exe",
          "apps/desktop/release",
          "apps/mobile/dist/metadata.json",
          "apps/mobile/ios",
          "apps/mobile/android",
          "apps/mobile/eas.json",
          "packages/companion-ui/dist/index.js",
        ].map(async (path) =>
          Object.assign(
            { relativePath: path },
            await presence(join(repositoryRoot, path))
          )
        )
      ),
      Promise.all([
        sourceCandidate(
          repositoryRoot,
          "apps/desktop/src/main.ts",
          /open-url|setAsDefaultProtocolClient/u,
          "Desktop protocol marker found; cold/warm handoff remains unverified.",
          "No protocol marker in desktop main.ts; inspect authentication and URL handoff at runtime."
        ),
        sourceCandidate(
          repositoryRoot,
          "apps/desktop/src/main.ts",
          /\bNotification\b/u,
          "Electron Notification marker found; delivery remains unverified.",
          "No Electron Notification marker in main.ts. Browser notification support is not determined by this scan."
        ),
        sourceCandidate(
          repositoryRoot,
          "apps/desktop/src/audio-access.ts",
          /setPermissionCheckHandler\(\(\) => false\)/u,
          "Static permission-check denial is present. Browser notification requests must be tested, including the request handler.",
          "No blanket permission-check denial marker found; runtime permission behavior remains unknown."
        ),
        sourceCandidate(
          repositoryRoot,
          "apps/mobile/src/app.tsx",
          /SafeAreaProvider|SafeAreaView/u,
          "Safe-area wrapper found; overlays, rotations and keyboard insets remain unverified.",
          "No safe-area wrapper marker found in app.tsx."
        ),
        sourceCandidate(
          repositoryRoot,
          "apps/mobile/src/app.tsx",
          /BackHandler/u,
          "Application back marker found; navigation and draft protection remain unverified.",
          "No application back marker in app.tsx; shared overlay dismissal does not qualify app-level back navigation."
        ),
        sourceCandidate(
          repositoryRoot,
          "apps/mobile/src/app.tsx",
          /getInitialURL|addEventListener\(\s*["']url/u,
          "Application URL marker found; cold/warm routing and account boundaries remain unverified.",
          "No application URL listener marker in app.tsx; inspect auth callbacks separately from content-link routing."
        ),
        sourceCandidate(
          repositoryRoot,
          "apps/mobile/src/auth.ts",
          /expoClient\(\{ scheme: ["']zoen/u,
          "Zoen auth callback adapter found; device OAuth success/cancel/return remains unverified.",
          "No Zoen auth callback adapter marker found."
        ),
        sourceCandidate(
          repositoryRoot,
          "apps/mobile/src/attachments.native.ts",
          /getDocumentAsync/u,
          "Native document picker marker found; selection/send/reopen/share remains unverified.",
          "No native document picker marker found."
        ),
      ]),
    ]);
  return {
    schemaVersion: 1,
    observedAt: new Date().toISOString(),
    repositoryRoot,
    scope:
      "Read-only filesystem inventory containing local path metadata. No builds, subprocesses, GUI, device queries or network. No credential/provisioning contents are read, and raw environment values are not emitted.",
    statusMeanings: {
      supported:
        "The described file, executable path or installed package was observed; not proof of a working native capability.",
      unknown:
        "Not inspected live, unreadable, invalid, or only a static candidate requiring runtime validation.",
      unavailable:
        "The described filesystem prerequisite is absent at the checked path; not a claim about all possible installations or attached devices.",
    },
    host: {
      platform: platform(),
      architecture: arch(),
      osRelease: release(),
      nodeVersion: process.version,
    },
    desktop,
    mobile,
    tools,
    androidSdks,
    ios: {
      xcode: await presence("/Applications/Xcode.app/Contents/Developer"),
      simulatorRuntimeDirectories: await directory(
        "/Library/Developer/CoreSimulator/Profiles/Runtimes"
      ),
      simulatorVolumes: await directory(
        "/Library/Developer/CoreSimulator/Volumes"
      ),
      deviceDirectoryCandidates: await directory(
        join(home, "Library/Developer/CoreSimulator/Devices")
      ),
      service: {
        status: "unknown",
        evidence:
          "CoreSimulator was not queried. Permission boundaries are not bypassed.",
      },
      connectedDevices: {
        status: "unknown",
        evidence: "No device/service query performed.",
      },
    },
    android: {
      javaInstallations: await directory("/Library/Java/JavaVirtualMachines"),
      avdDirectoryCandidates: await directory(join(home, ".android/avd")),
      connectedDevices: {
        status: "unknown",
        evidence: "ADB was not invoked; no daemon is started.",
      },
      customSdkRoots: {
        status: "unknown",
        evidence:
          "Only conventional SDK locations are inspected; custom environment configuration is not read.",
      },
    },
    artifacts,
    candidates,
    nativeExecution: {
      status: "unknown",
      evidence:
        "Neither Electron nor an installed iOS/Android application was launched. Exports and JavaScript compilation do not qualify native execution.",
    },
  };
}

const help = `Read-only native readiness inventory (JSON on stdout).

Usage: node --import tsx scripts/native-readiness.ts [--root <repository>] [--help]

Examples:
  node --import tsx scripts/native-readiness.ts
  node --import tsx scripts/native-readiness.ts --root /path/to/checkout

No installs, builds, subprocesses, network, GUI, emulator boot or device queries.
No credentials or provisioning files are read. Exit 0 means the inventory ran,
not that native acceptance passed; inspect supported/unknown/unavailable values.
Invalid options exit 1. Permission failures are reported as unknown.`;

if (
  process.argv[1] &&
  pathToFileURL(resolve(process.argv[1])).href === import.meta.url
) {
  try {
    const { values } = parseArgs({
      options: {
        root: { type: "string" },
        help: { type: "boolean", short: "h" },
      },
    });
    if (values.help) console.log(help);
    else {
      const root =
        values.root ?? resolve(dirname(fileURLToPath(import.meta.url)), "..");
      const check = await presence(join(root, "package.json"));
      if (check.status !== "supported")
        throw new Error(
          "Cannot read repository package.json. Supply --root <repository> or use --help."
        );
      console.log(JSON.stringify(await nativeReadiness(root), null, 2));
    }
  } catch (error) {
    console.error(
      error instanceof Error ? error.message : "Inventory failed. Use --help."
    );
    process.exitCode = 1;
  }
}
