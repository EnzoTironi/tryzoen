import { randomUUID } from "node:crypto";
import { readFile, rm, stat, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { afterAll, beforeEach, expect, test, vi } from "vitest";
import type { authorizedCreatorCorpus } from "./access";
import { publishCorpusManifest } from "./files";
import { searchCreatorCorpus } from "./retrieval";
import { corpusDigest, corpusManifestSchema, corpusPages } from "./schema";
import { WorkspaceAccessDenied } from "../../workspaces/access";

const owners = await vi.hoisted(async () => {
  const { mkdtemp } = await import("node:fs/promises");
  const { tmpdir } = await import("node:os");
  const paths = await import("node:path");
  return {
    directory: await mkdtemp(paths.join(tmpdir(), "zoen-creator-search-unit-")),
    authorize: vi.fn<typeof authorizedCreatorCorpus>(),
    depth: 0,
  };
});
vi.mock("./access", () => ({ authorizedCreatorCorpus: owners.authorize }));
vi.mock("../../../db/queries", () => ({
  transaction: async (run: () => Promise<unknown>) => {
    owners.depth++;
    try {
      return await run();
    } finally {
      owners.depth--;
    }
  },
}));
vi.mock("@shared/environment/env", async (original) => {
  const actual = await original<typeof import("@shared/environment/env")>();
  return {
    ...actual,
    env: {
      ...actual.env,
      ZOEN_SESSION_ARCHIVE_DIR: owners.directory,
      ZOEN_AI_MEMORY_BINARY: undefined,
    },
  };
});
afterAll(() => rm(owners.directory, { recursive: true, force: true }));
beforeEach(() => {
  owners.authorize.mockReset();
  owners.depth = 0;
});
const actor = { userId: "creator", workspaceId: "workspace" };
async function approved(bodies: string[]) {
  const namespace = randomUUID();
  const manifest = corpusManifestSchema.parse({
    version: 1,
    releaseId: randomUUID(),
    draftRevision: randomUUID(),
    pages: bodies.flatMap((body, index) =>
      corpusPages(
        namespace,
        {
          entryId: randomUUID(),
          title: `Source ${index}`,
          attribution: `Author ${index}`,
          rights: "original",
          kind: "authored",
          source: null,
        },
        body
      )
    ),
  });
  const corpus = {
    namespace,
    manifest,
    digest: corpusDigest(JSON.stringify(manifest)),
    initialized: true,
  };
  await publishCorpusManifest(namespace, manifest);
  owners.authorize.mockImplementation(async () => {
    expect(owners.depth).toBeGreaterThan(0);
    return corpus;
  });
  return {
    corpus,
    path: join(
      owners.directory,
      namespace,
      "creator-knowledge/release-manifest.json"
    ),
    access: { kind: "creator" as const, releaseId: manifest.releaseId },
  };
}

test("all approved pages remain searchable, with exact bounded provenance and no persisted query", async () => {
  const f = await approved([
    "Previously cited citrus evidence.",
    "Uncited quartz evidence.",
  ]);
  const before = await readFile(f.path);
  const result = await searchCreatorCorpus(actor, {
    access: f.access,
    query: "quartz",
  });
  const page = f.corpus.manifest.pages[1];
  if (!page) throw new Error("Expected uncited page");
  expect(result.hits).toEqual([
    {
      title: page.title,
      attribution: page.attribution,
      rights: page.rights,
      kind: page.kind,
      entryId: page.entryId,
      excerpt: page.body,
      source: page.source,
      releaseId: f.corpus.manifest.releaseId,
      manifestDigest: f.corpus.digest,
      pageDigest: page.digest,
      excerptDigest: page.digest,
      start: page.start,
      end: page.end,
      offsetUnit: "utf16",
    },
  ]);
  expect(owners.authorize).toHaveBeenCalledTimes(2);
  expect(
    (
      await searchCreatorCorpus(actor, {
        access: f.access,
        query: "PRIVATE_QUERY_CANARY",
      })
    ).hits
  ).toEqual([]);
  expect(await readFile(f.path)).toEqual(before);
  expect(result).toMatchObject({
    retrieval: "lexical",
    answerMode: "snapshot",
  });
});

test("ranking uses distinct lexical matches then stable page identity, regardless of manifest order", async () => {
  const f = await approved(["Alpha omega", "Alpha", "Omega alpha", "No match"]);
  const result = await searchCreatorCorpus(actor, {
    access: f.access,
    query: "ALPHA omega alpha",
  });
  const tied = [f.corpus.manifest.pages[0], f.corpus.manifest.pages[2]]
    .filter((page) => page !== undefined)
    .toSorted((a, b) => (a.path < b.path ? -1 : 1));
  expect(result.hits.map((hit) => hit.entryId)).toEqual([
    ...tied.map((page) => page.entryId),
    f.corpus.manifest.pages[1]?.entryId,
  ]);
  const reversed = {
    ...f.corpus.manifest,
    pages: f.corpus.manifest.pages.toReversed(),
  };
  const reordered = {
    ...f.corpus,
    manifest: reversed,
    digest: corpusDigest(JSON.stringify(reversed)),
  };
  await writeFile(f.path, JSON.stringify(reversed));
  owners.authorize.mockResolvedValue(reordered);
  expect(
    (
      await searchCreatorCorpus(actor, {
        access: f.access,
        query: "alpha omega",
      })
    ).hits.map((hit) => hit.entryId)
  ).toEqual(result.hits.map((hit) => hit.entryId));
});

test("Unicode normalization/case and punctuation-only input have deterministic lexical semantics", async () => {
  const f = await approved(["Café Quartz teaches 漢字."]);
  expect(
    (
      await searchCreatorCorpus(actor, {
        access: f.access,
        query: "ＣＡＦＥ\u0301 ＱＵＡＲＴＺ",
      })
    ).hits
  ).toHaveLength(1);
  expect(
    (await searchCreatorCorpus(actor, { access: f.access, query: "漢字" })).hits
  ).toHaveLength(1);
  expect(
    (await searchCreatorCorpus(actor, { access: f.access, query: "!!!" })).hits
  ).toEqual([]);
});

test("the whole64-page corpus is bounded to8 hits and32 distinct query terms", async () => {
  const f = await approved(
    Array.from({ length: 64 }, (_, index) => `needle t${index}`)
  );
  expect(
    (await searchCreatorCorpus(actor, { access: f.access, query: "needle" }))
      .hits
  ).toHaveLength(8);
  const result = await searchCreatorCorpus(actor, {
    access: f.access,
    query: Array.from({ length: 33 }, (_, index) => `t${index}`).join(" "),
  });
  expect(result.hits).toHaveLength(8);
  expect(result.hits.some((hit) => hit.excerpt === "needle t32")).toBe(false);
  expect(
    (await searchCreatorCorpus(actor, { access: f.access, query: "t63" }))
      .hits[0]?.excerpt
  ).toBe("needle t63");
});

test("the16k UTF16 excerpt budget never cuts a Unicode scalar", async () => {
  const first = "needle amber cobalt " + "a".repeat(7980);
  const second = "needle amber " + "b".repeat(7986);
  expect(first).toHaveLength(8000);
  expect(second).toHaveLength(7999);
  const f = await approved([first, second, "😀needle"]);
  const result = await searchCreatorCorpus(actor, {
    access: f.access,
    query: "needle amber cobalt",
  });
  expect(result.hits).toHaveLength(2);
  expect(result.hits.reduce((sum, hit) => sum + hit.excerpt.length, 0)).toBe(
    15999
  );
  for (const hit of result.hits) {
    expect(hit.end - hit.start).toBe(hit.excerpt.length);
    expect(hit.excerptDigest).toBe(corpusDigest(hit.excerpt));
    expect(hit.excerpt).not.toMatch(/[\uD800-\uDBFF]$/u);
  }
});

test.each(["initial", "post-file"])(
  "%s authority denial returns no content",
  async (phase) => {
    const f = await approved(["needle evidence"]);
    if (phase === "initial")
      owners.authorize.mockRejectedValue(new WorkspaceAccessDenied());
    else
      owners.authorize
        .mockResolvedValueOnce(f.corpus)
        .mockRejectedValueOnce(new WorkspaceAccessDenied());
    await expect(
      searchCreatorCorpus(actor, { access: f.access, query: "needle" })
    ).rejects.toBeInstanceOf(WorkspaceAccessDenied);
  }
);

test("corruption of an uncited page denies a matching query rather than falling back to SQL bodies", async () => {
  const f = await approved(["needle evidence", "unrelated uncited source"]);
  const changed = structuredClone(f.corpus.manifest);
  const page = changed.pages[1];
  if (!page) throw new Error("Expected uncited page");
  page.body = "FORGED_UNCITED_BODY";
  await writeFile(f.path, JSON.stringify(changed));
  await expect(
    searchCreatorCorpus(actor, { access: f.access, query: "needle" })
  ).rejects.toThrow("approved release");
  await rm(f.path);
  await expect(
    searchCreatorCorpus(actor, { access: f.access, query: "needle" })
  ).rejects.toMatchObject({ code: "ENOENT" });
  await expect(stat(f.path)).rejects.toMatchObject({ code: "ENOENT" });
});

test("another release selects only its own canonical namespace", async () => {
  const a = await approved(["Firstrelease citrus"]);
  const b = await approved(["Secondrelease quartz"]);
  owners.authorize.mockImplementation(async (_actor, access) => {
    if (access.kind !== "creator") throw new WorkspaceAccessDenied();
    return access.releaseId === a.corpus.manifest.releaseId
      ? a.corpus
      : b.corpus;
  });
  expect(
    (await searchCreatorCorpus(actor, { access: a.access, query: "quartz" }))
      .hits
  ).toEqual([]);
  expect(
    (await searchCreatorCorpus(actor, { access: b.access, query: "citrus" }))
      .hits
  ).toEqual([]);
});
