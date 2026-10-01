import { randomUUID } from "node:crypto";
import { readFile, rm, stat } from "node:fs/promises";
import { join } from "node:path";
import { PgDialect } from "drizzle-orm/pg-core";
import { afterAll, beforeEach, expect, test, vi } from "vitest";
import type { SQL } from "drizzle-orm";
import type { authorizedCreatorCorpus } from "./access";
import { buildCreatorCorpus, creatorCorpusStatus } from "./index";
import { corpusDigest, corpusManifestSchema, corpusPages } from "./schema";
import { WorkspaceAccessDenied } from "../../workspaces/access";

const owners = await vi.hoisted(async () => {
  const { mkdtemp } = await import("node:fs/promises");
  const { tmpdir } = await import("node:os");
  const paths = await import("node:path");
  return {
    directory: await mkdtemp(paths.join(tmpdir(), "zoen-creator-build-unit-")),
    authorize: vi.fn<typeof authorizedCreatorCorpus>(),
    query: vi.fn<(statement: SQL) => Promise<Record<string, unknown>[]>>(),
    depth: 0,
  };
});
vi.mock("./access", () => ({ authorizedCreatorCorpus: owners.authorize }));
vi.mock("../../../db/queries", () => ({
  query: owners.query,
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
    },
  };
});
afterAll(() => rm(owners.directory, { recursive: true, force: true }));
beforeEach(() => {
  owners.authorize.mockReset();
  owners.query.mockReset().mockResolvedValue([]);
  owners.depth = 0;
});
const actor = { userId: "creator", workspaceId: "workspace" };
function approved(initialized = false) {
  const namespace = randomUUID();
  const manifest = corpusManifestSchema.parse({
    version: 1,
    releaseId: randomUUID(),
    draftRevision: randomUUID(),
    pages: corpusPages(
      namespace,
      {
        entryId: randomUUID(),
        title: "Complete source",
        attribution: "Original teaching",
        rights: "original",
        kind: "authored",
        source: null,
      },
      "Published first page. " + "uncited source ".repeat(650)
    ),
  });
  return {
    namespace,
    manifest,
    digest: corpusDigest(JSON.stringify(manifest)),
    initialized,
  };
}
function path(corpus: ReturnType<typeof approved>) {
  return join(
    owners.directory,
    corpus.namespace,
    "creator-knowledge",
    "release-manifest.json"
  );
}

test("build publishes every approved page and acknowledges only after authority recheck", async () => {
  const corpus = approved();
  owners.authorize.mockImplementation(async () => {
    expect(owners.depth).toBeGreaterThan(0);
    return corpus;
  });
  expect(
    await buildCreatorCorpus(actor, corpus.manifest.releaseId)
  ).toMatchObject({
    state: "indexed",
    pages: corpus.manifest.pages.length,
    digest: corpus.digest,
  });
  expect(corpus.manifest.pages.length).toBeGreaterThan(1);
  expect(await readFile(path(corpus), "utf8")).toBe(
    JSON.stringify(corpus.manifest)
  );
  expect(owners.authorize).toHaveBeenCalledTimes(2);
  expect(owners.query).toHaveBeenCalledTimes(1);
  const statement = owners.query.mock.calls[0]?.[0];
  if (!statement) throw new Error("Expected publication acknowledgement");
  expect(new PgDialect().sqlToQuery(statement).sql).toContain(
    "initialized=true"
  );
  expect(new PgDialect().sqlToQuery(statement).params).toEqual([
    corpus.manifest.releaseId,
  ]);
});

test("initial authority denial cannot create a namespace or acknowledge publication", async () => {
  const corpus = approved();
  owners.authorize.mockRejectedValue(new WorkspaceAccessDenied());
  await expect(
    buildCreatorCorpus(actor, corpus.manifest.releaseId)
  ).rejects.toBeInstanceOf(WorkspaceAccessDenied);
  await expect(
    stat(join(owners.directory, corpus.namespace))
  ).rejects.toMatchObject({ code: "ENOENT" });
  expect(owners.query).not.toHaveBeenCalled();
});

test("post-file erasure or revocation denial leaves a durable publication unacknowledged", async () => {
  const corpus = approved();
  owners.authorize
    .mockResolvedValueOnce(corpus)
    .mockRejectedValueOnce(new WorkspaceAccessDenied());
  await expect(
    buildCreatorCorpus(actor, corpus.manifest.releaseId)
  ).rejects.toBeInstanceOf(WorkspaceAccessDenied);
  expect(await readFile(path(corpus), "utf8")).toBe(
    JSON.stringify(corpus.manifest)
  );
  expect(owners.query).not.toHaveBeenCalled();
  // A retry after acknowledgement loss verifies the same file, rather than replacing it.
  const before = await stat(path(corpus));
  owners.authorize.mockResolvedValue(corpus);
  await buildCreatorCorpus(actor, corpus.manifest.releaseId);
  expect((await stat(path(corpus))).ino).toBe(before.ino);
});

test("an initialized lost corpus cannot be reconstructed from the SQL approval", async () => {
  const corpus = approved(true);
  owners.authorize.mockResolvedValue(corpus);
  await expect(
    buildCreatorCorpus(actor, corpus.manifest.releaseId)
  ).rejects.toMatchObject({ code: "ENOENT" });
  await expect(
    stat(join(owners.directory, corpus.namespace))
  ).rejects.toMatchObject({ code: "ENOENT" });
  expect(owners.query).not.toHaveBeenCalled();
});

test("an initialized build verifies the existing complete file without replacing it", async () => {
  const corpus = approved();
  owners.authorize.mockResolvedValue(corpus);
  await buildCreatorCorpus(actor, corpus.manifest.releaseId);
  const before = await stat(path(corpus));
  owners.authorize.mockResolvedValue({ ...corpus, initialized: true });
  await buildCreatorCorpus(actor, corpus.manifest.releaseId);
  expect((await stat(path(corpus))).ino).toBe(before.ino);
});

test("status keeps the existing bounded metadata contract behind current authority", async () => {
  const corpus = approved();
  owners.authorize.mockResolvedValue(corpus);
  expect(
    await creatorCorpusStatus(actor, {
      kind: "creator",
      releaseId: corpus.manifest.releaseId,
    })
  ).toMatchObject({
    state: "not-indexed",
    availability: "checked-on-search",
    retrieval: "lexical",
    answerMode: "snapshot",
  });
  owners.authorize.mockRejectedValue(new WorkspaceAccessDenied());
  await expect(
    creatorCorpusStatus(actor, {
      kind: "creator",
      releaseId: corpus.manifest.releaseId,
    })
  ).rejects.toBeInstanceOf(WorkspaceAccessDenied);
});
