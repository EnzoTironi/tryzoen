import { randomUUID } from "node:crypto";
import {
  chmod,
  mkdir,
  readFile,
  rm,
  stat,
  symlink,
  writeFile,
} from "node:fs/promises";
import { join } from "node:path";
import { afterAll, expect, test, vi } from "vitest";
import { publishCorpusManifest, readCorpusManifest } from "./files";
import { corpusManifestSchema, corpusPages } from "./schema";

const { directory } = await vi.hoisted(async () => {
  const { mkdtemp } = await import("node:fs/promises");
  const { tmpdir } = await import("node:os");
  const paths = await import("node:path");
  return {
    directory: await mkdtemp(paths.join(tmpdir(), "zoen-creator-files-unit-")),
  };
});
vi.mock("@shared/environment/env", async (original) => {
  const actual = await original<typeof import("@shared/environment/env")>();
  return {
    ...actual,
    env: {
      ...actual.env,
      ZOEN_SESSION_ARCHIVE_DIR: directory,
      ZOEN_AI_MEMORY_BINARY: undefined,
    },
  };
});
afterAll(() => rm(directory, { recursive: true, force: true }));
function approved(
  text = `First evidence. ${"uncited 😀 source ".repeat(600)}`
) {
  const namespace = randomUUID();
  const manifest = corpusManifestSchema.parse({
    version: 1,
    releaseId: randomUUID(),
    draftRevision: randomUUID(),
    pages: corpusPages(
      namespace,
      {
        entryId: randomUUID(),
        kind: "authored",
        rights: "original",
        attribution: "Original author",
        title: "Approved teaching",
        source: null,
      },
      text
    ),
  });
  const folder = join(directory, namespace, "creator-knowledge");
  return {
    namespace,
    manifest,
    folder,
    path: join(folder, "release-manifest.json"),
  };
}

test("the canonical file contains every approved page and exact provenance, independently of a search process", async () => {
  const f = approved();
  expect(f.manifest.pages.length).toBeGreaterThan(1);
  expect(await publishCorpusManifest(f.namespace, f.manifest)).toEqual(
    f.manifest
  );
  expect(await readCorpusManifest(f.namespace, f.manifest)).toEqual(f.manifest);
  expect(await readFile(f.path, "utf8")).toBe(JSON.stringify(f.manifest));
  expect((await stat(f.path)).mode & 0o077).toBe(0);
});

test("exact publication retry preserves the file; a conflicting approval cannot replace it", async () => {
  const f = approved();
  await publishCorpusManifest(f.namespace, f.manifest);
  const before = await stat(f.path);
  await publishCorpusManifest(f.namespace, f.manifest);
  expect((await stat(f.path)).ino).toBe(before.ino);
  await expect(
    publishCorpusManifest(f.namespace, {
      ...f.manifest,
      releaseId: randomUUID(),
    })
  ).rejects.toThrow("approved release");
  expect(await readFile(f.path, "utf8")).toBe(JSON.stringify(f.manifest));
});

test("an interrupted private staging prefix can resume the exact first publication", async () => {
  const f = approved();
  await mkdir(f.folder, { recursive: true, mode: 0o700 });
  await writeFile(
    join(f.folder, ".release-manifest.tmp"),
    Buffer.from(JSON.stringify(f.manifest)).subarray(0, 100),
    { mode: 0o600 }
  );
  await expect(
    readCorpusManifest(f.namespace, f.manifest)
  ).rejects.toMatchObject({ code: "ENOENT" });
  expect(await publishCorpusManifest(f.namespace, f.manifest)).toEqual(
    f.manifest
  );
  await expect(
    stat(join(f.folder, ".release-manifest.tmp"))
  ).rejects.toMatchObject({ code: "ENOENT" });
});

test("staging from a different approval is never accepted or served", async () => {
  const f = approved();
  await mkdir(f.folder, { recursive: true, mode: 0o700 });
  await writeFile(join(f.folder, ".release-manifest.tmp"), "FOREIGN_BODY", {
    mode: 0o600,
  });
  await expect(publishCorpusManifest(f.namespace, f.manifest)).rejects.toThrow(
    "foreign publication"
  );
  await expect(stat(f.path)).rejects.toMatchObject({ code: "ENOENT" });
});

test("a missing accepted namespace or manifest is not created by a read", async () => {
  const f = approved();
  await expect(
    readCorpusManifest(f.namespace, f.manifest)
  ).rejects.toMatchObject({ code: "ENOENT" });
  await expect(stat(join(directory, f.namespace))).rejects.toMatchObject({
    code: "ENOENT",
  });
  await publishCorpusManifest(f.namespace, f.manifest);
  await rm(f.path);
  await expect(
    readCorpusManifest(f.namespace, f.manifest)
  ).rejects.toMatchObject({ code: "ENOENT" });
  await expect(stat(f.path)).rejects.toMatchObject({ code: "ENOENT" });
});

test("corruption in an uncited approved page invalidates the whole corpus", async () => {
  const f = approved();
  await publishCorpusManifest(f.namespace, f.manifest);
  const changed = structuredClone(f.manifest);
  const page = changed.pages.at(-1);
  if (!page) throw new Error("Expected uncited page");
  page.body = "FOREIGN_UNCITED_BODY";
  await writeFile(f.path, JSON.stringify(changed));
  await expect(readCorpusManifest(f.namespace, f.manifest)).rejects.toThrow(
    "approved release"
  );
});

test.each(["duplicate", "path", "digest", "offset", "unicode", "sequence"])(
  "invalid %s page metadata cannot become a canonical file",
  async (kind) => {
    const f = approved();
    const changed = structuredClone(f.manifest);
    const page = changed.pages[0];
    if (!page) throw new Error("Expected page");
    if (kind === "duplicate") changed.pages.push(page);
    if (kind === "path") page.path = `notes/${randomUUID()}.md`;
    if (kind === "digest") page.digest = "0".repeat(64);
    if (kind === "offset") page.end++;
    if (kind === "unicode") page.body = "\ud800";
    if (kind === "sequence") changed.pages.reverse();
    await expect(publishCorpusManifest(f.namespace, changed)).rejects.toThrow(
      "source verification"
    );
    await expect(stat(join(directory, f.namespace))).rejects.toMatchObject({
      code: "ENOENT",
    });
  }
);

test("a foreign page on disk is refused before reading the canonical corpus", async () => {
  const f = approved();
  await publishCorpusManifest(f.namespace, f.manifest);
  await writeFile(join(f.folder, "foreign.md"), "UNAPPROVED", { mode: 0o600 });
  await expect(readCorpusManifest(f.namespace, f.manifest)).rejects.toThrow(
    "source inventory"
  );
  await expect(publishCorpusManifest(f.namespace, f.manifest)).rejects.toThrow(
    "source inventory"
  );
});

test.each([
  "directory",
  "file",
  "file-symlink",
  "directory-symlink",
  "oversize",
])("%s cannot bypass private canonical file checks", async (kind) => {
  const f = approved();
  await publishCorpusManifest(f.namespace, f.manifest);
  if (kind === "directory") await chmod(f.folder, 0o755);
  if (kind === "file") await chmod(f.path, 0o644);
  if (kind === "file-symlink") {
    const target = join(directory, `target-${randomUUID()}`);
    await writeFile(target, JSON.stringify(f.manifest), { mode: 0o600 });
    await rm(f.path);
    await symlink(target, f.path);
  }
  if (kind === "directory-symlink") {
    const target = join(directory, `target-${randomUUID()}`);
    await mkdir(target, { mode: 0o700 });
    await writeFile(
      join(target, "release-manifest.json"),
      JSON.stringify(f.manifest),
      { mode: 0o600 }
    );
    await rm(f.folder, { recursive: true });
    await symlink(target, f.folder);
  }
  if (kind === "oversize") await writeFile(f.path, Buffer.alloc(262145));
  const expected =
    kind === "file-symlink"
      ? { code: "ELOOP" }
      : {
          message: kind.includes("directory")
            ? "Creator corpus requires a private directory without symlinks."
            : "Invalid creator corpus manifest file.",
        };
  await expect(
    readCorpusManifest(f.namespace, f.manifest)
  ).rejects.toMatchObject(expected);
});

test("raw byte verification refuses invalid UTF8 that decodes to an approved replacement character", async () => {
  const f = approved("Literal � is original evidence.");
  await publishCorpusManifest(f.namespace, f.manifest);
  const bytes = await readFile(f.path);
  const at = bytes.indexOf(Buffer.from("�"));
  if (at < 0) throw new Error("Expected replacement character fixture");
  const changed = Buffer.concat([
    bytes.subarray(0, at),
    Buffer.from([255]),
    bytes.subarray(at + 3),
  ]);
  expect(changed.toString("utf8")).toBe(bytes.toString("utf8"));
  await writeFile(f.path, changed);
  await expect(readCorpusManifest(f.namespace, f.manifest)).rejects.toThrow(
    "approved release"
  );
});

test("a different namespace cannot reuse approved page identities", async () => {
  const f = approved();
  await publishCorpusManifest(f.namespace, f.manifest);
  await expect(readCorpusManifest(randomUUID(), f.manifest)).rejects.toThrow(
    "source verification"
  );
});
