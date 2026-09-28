import { randomUUID } from "node:crypto";
import {
  mkdtemp,
  readFile,
  readdir,
  rm,
  stat,
  symlink,
  writeFile,
} from "node:fs/promises";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { afterEach, expect, test } from "vitest";
import type { HookEvent } from "eve/hooks";
import {
  eraseSessionSources,
  sessionSource,
  writeSessionSource,
} from "./session-files";

const directories: string[] = [];
afterEach(async () => {
  for (const directory of directories.splice(0))
    await rm(directory, { recursive: true, force: true });
});
async function temporary() {
  const path = await mkdtemp(join(tmpdir(), "zoen-session-files-"));
  directories.push(path);
  return path;
}
const message = (
  text: string | null,
  id = "evt_source_1"
): HookEvent<"message.completed"> => ({
  type: "message.completed",
  meta: { id, at: "2026-09-28T12:00:00.000Z" },
  data: {
    message: text,
    finishReason: "stop",
    sequence: 2,
    stepIndex: 1,
    turnId: "turn_0",
  },
});

test("archives only visible text and boundary coordinates, with explicit unsettled assistant provenance", () => {
  const source = sessionSource(
    message(
      "Reading is at Cedarfield. password=hunter2 Bearer abc123 sk-proj-12345678901234567890"
    ),
    "session_1"
  );
  expect(source).toMatchObject({
    source: "eve",
    role: "assistant",
    settlement: "unverified",
    turnId: "turn_0",
    stepIndex: 1,
    sequence: 2,
    truncated: false,
  });
  expect(source?.text).toContain("Cedarfield");
  expect(JSON.stringify(source)).not.toMatch(
    /hunter2|abc123|sk-proj-12345678901234567890/
  );
  expect(
    sessionSource(
      {
        type: "reasoning.completed",
        meta: message("").meta,
        data: {
          reasoning: "Hidden reasoning",
          sequence: 0,
          stepIndex: 0,
          turnId: "turn_0",
        },
      },
      "session_1"
    )
  ).toBeNull();
  expect(
    sessionSource(
      {
        type: "message.received",
        meta: message("").meta,
        data: {
          kind: "execution.background_task",
          message: "Internal provider payload",
          sequence: 0,
          turnId: "turn_0",
        },
      },
      "session_1"
    )
  ).toBeNull();
  expect(sessionSource(message(null), "session_1")).toBeNull();
  expect(sessionSource(message("a".repeat(65_000)), "session_1")).toMatchObject(
    { truncated: true, text: "a".repeat(64_000) }
  );
});

test("publishes private immutable files, deduplicates concurrent replay, and preserves separate attempts and accounts", async () => {
  const root = await temporary();
  const alice = randomUUID();
  const bob = randomUUID();
  const source = sessionSource(message("Cedarfield"), "../../outside");
  expect(source).not.toBeNull();
  if (!source) throw new Error("Expected source");
  const paths = await Promise.all(
    Array.from({ length: 12 }, () => writeSessionSource(root, alice, source, 1))
  );
  const path = paths[0];
  if (!path) throw new Error("Expected file");
  expect(new Set(paths).size).toBe(1);
  expect(path.startsWith(join(root, alice, "raw", "eve"))).toBe(true);
  expect((await stat(path)).mode & 0o777).toBe(0o600);
  expect((await stat(dirname(path))).mode & 0o777).toBe(0o700);
  expect(JSON.parse(await readFile(path, "utf8"))).toEqual({
    ...source,
    captureSequence: 1,
  });
  expect(await readdir(dirname(path))).toHaveLength(1);
  await expect(
    writeSessionSource(root, alice, { ...source, text: "Conflicting retry" }, 1)
  ).rejects.toThrow("conflicts");
  const retry = await writeSessionSource(
    root,
    alice,
    {
      ...source,
      eventId: "evt_source_2",
      text: "Ambertrail",
    },
    2
  );
  expect(retry).not.toBe(path);
  const other = await writeSessionSource(root, bob, source, 3);
  expect(other).not.toBe(path);
  await eraseSessionSources(root, alice);
  await expect(readFile(path)).rejects.toMatchObject({ code: "ENOENT" });
  expect(await readFile(other, "utf8")).toContain("Cedarfield");
  await eraseSessionSources(root, alice);
});

test("rejects namespace traversal and directory symlinks without touching their destination", async () => {
  const root = await temporary();
  const outside = await temporary();
  const namespace = randomUUID();
  const source = sessionSource(message("Cedarfield"), "session_1");
  if (!source) throw new Error("Expected source");
  await writeFile(join(outside, "keep.txt"), "keep");
  await symlink(outside, join(root, namespace));
  await expect(writeSessionSource(root, namespace, source, 1)).rejects.toThrow(
    "private directory"
  );
  await expect(eraseSessionSources(root, namespace)).rejects.toThrow(
    "Invalid session archive"
  );
  await expect(
    writeSessionSource(root, "../outside", source, 1)
  ).rejects.toThrow(/Invalid UUID/);
  expect(await readFile(join(outside, "keep.txt"), "utf8")).toBe("keep");
});
