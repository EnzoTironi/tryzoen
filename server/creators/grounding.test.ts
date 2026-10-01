import { randomUUID } from "node:crypto";
import { readFile, rm, stat, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { afterAll, beforeEach, expect, test, vi } from "vitest";
import {
  creatorGroundingSchema,
  creatorPilotTeachingSchema,
} from "@zoen/companion-ui/creators";
import type { authorizedCreatorCorpus } from "./corpus/access";
import type { requireActiveCreatorPilot } from "./pilots";
import { publishCorpusManifest } from "./corpus/files";
import {
  corpusDigest,
  corpusManifestSchema,
  corpusPages,
} from "./corpus/schema";
import { verifyCreatorGrounding, validateGroundedAnswer } from "./grounding";
import { WorkspaceAccessDenied } from "../workspaces/access";

const owners = await vi.hoisted(async () => {
  const { mkdtemp } = await import("node:fs/promises");
  const { tmpdir } = await import("node:os");
  const paths = await import("node:path");
  return {
    directory: await mkdtemp(paths.join(tmpdir(), "zoen-creator-ground-unit-")),
    authorize: vi.fn<typeof authorizedCreatorCorpus>(),
    pilot: vi.fn<typeof requireActiveCreatorPilot>(),
    depth: 0,
  };
});
vi.mock("./corpus/access", () => ({
  authorizedCreatorCorpus: owners.authorize,
}));
vi.mock("./pilots", () => ({ requireActiveCreatorPilot: owners.pilot }));
vi.mock("../../db/queries", () => ({
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
  owners.pilot.mockReset();
  owners.depth = 0;
});
const actor = { userId: "creator", workspaceId: "workspace" };
async function approved(
  kind: Parameters<typeof corpusPages>[1]["kind"] = "authored"
) {
  const namespace = randomUUID();
  const manifest = corpusManifestSchema.parse({
    version: 1,
    releaseId: randomUUID(),
    draftRevision: randomUUID(),
    pages: [
      ...corpusPages(
        namespace,
        {
          entryId: randomUUID(),
          kind,
          title: "Approved source",
          attribution: "Original creator",
          rights: "original",
          source: null,
        },
        "Needle is the approved answer. 😀"
      ),
      ...corpusPages(
        namespace,
        {
          entryId: randomUUID(),
          kind: "authored",
          title: "Uncited source",
          attribution: "Original creator",
          rights: "original",
          source: null,
        },
        "Complete uncited reference."
      ),
    ],
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
  const page = manifest.pages[0];
  if (!page) throw new Error("Expected source page");
  const evidence = creatorGroundingSchema.parse({
    releaseId: manifest.releaseId,
    manifestDigest: corpus.digest,
    retrieval: "lexical",
    citations: [
      {
        id: "S1",
        title: page.title,
        attribution: page.attribution,
        excerpt: page.body,
        excerptDigest: page.digest,
        pageDigest: page.digest,
        entryId: page.entryId,
        start: page.start,
        end: page.end,
        offsetUnit: page.offsetUnit,
      },
    ],
  });
  const pilot = creatorPilotTeachingSchema.parse({
    qualificationId: randomUUID(),
    answerMode: "grounded",
    username: "synthetic",
    id: randomUUID(),
    releaseId: manifest.releaseId,
    draftId: randomUUID(),
    revision: manifest.draftRevision,
    title: "Pilot",
    description: "Synthetic pilot",
    creatorName: "Creator",
    recipientName: "Recipient",
    isCreator: false,
    status: "active",
    createdAt: 0,
    content: {
      title: "Pilot",
      description: "Synthetic pilot",
      playbook: "Quoted evidence only",
      examples: [],
    },
    manifestDigest: corpus.digest,
  });
  return {
    corpus,
    evidence,
    pilot,
    path: join(
      owners.directory,
      namespace,
      "creator-knowledge/release-manifest.json"
    ),
  };
}

test("direct grounding acceptance verifies complete files and rechecks authority inside one transaction", async () => {
  const f = await approved();
  await expect(
    verifyCreatorGrounding(actor, f.evidence)
  ).resolves.toBeUndefined();
  expect(owners.authorize).toHaveBeenCalledTimes(2);
  expect(owners.authorize.mock.calls).toEqual([
    [actor, { kind: "creator", releaseId: f.evidence.releaseId }],
    [actor, { kind: "creator", releaseId: f.evidence.releaseId }],
  ]);
  expect(owners.depth).toBe(0);
  expect(owners.pilot).not.toHaveBeenCalled();
});

test.each(["initial", "post-file"])(
  "%s pending erasure or revocation denial prevents grounding acceptance",
  async (phase) => {
    const f = await approved();
    if (phase === "initial")
      owners.authorize.mockRejectedValue(new WorkspaceAccessDenied());
    else
      owners.authorize
        .mockResolvedValueOnce(f.corpus)
        .mockRejectedValueOnce(new WorkspaceAccessDenied());
    await expect(
      verifyCreatorGrounding(actor, f.evidence)
    ).rejects.toBeInstanceOf(WorkspaceAccessDenied);
    expect(owners.depth).toBe(0);
  }
);

test.each([
  "entry",
  "page-digest",
  "start",
  "end",
  "title",
  "attribution",
  "excerpt",
  "excerpt-digest",
  "manifest",
])(
  "a changed %s citation cannot pass canonical file verification",
  async (kind) => {
    const f = await approved();
    const evidence = structuredClone(f.evidence);
    const citation = evidence.citations[0];
    if (!citation) throw new Error("Expected citation");
    if (kind === "entry") citation.entryId = randomUUID();
    if (kind === "page-digest") citation.pageDigest = "0".repeat(64);
    if (kind === "start") {
      citation.start++;
      citation.end++;
    }
    if (kind === "end") citation.end++;
    if (kind === "title") citation.title = "Foreign title";
    if (kind === "attribution") citation.attribution = "Foreign author";
    if (kind === "excerpt") {
      citation.excerpt = citation.excerpt.replace("Needle", "Forged");
      citation.excerptDigest = corpusDigest(citation.excerpt);
    }
    if (kind === "excerpt-digest") citation.excerptDigest = "0".repeat(64);
    if (kind === "manifest") evidence.manifestDigest = "0".repeat(64);
    await expect(verifyCreatorGrounding(actor, evidence)).rejects.toThrow(
      /Grounded|Citation offsets/
    );
  }
);

test("corruption in an uncited page refuses acceptance even when every cited page is unchanged", async () => {
  const f = await approved();
  const corrupted = structuredClone(f.corpus.manifest);
  const page = corrupted.pages[1];
  if (!page) throw new Error("Expected uncited page");
  page.body = "FOREIGN_UNCITED_BODY";
  await writeFile(f.path, JSON.stringify(corrupted));
  await expect(verifyCreatorGrounding(actor, f.evidence)).rejects.toThrow(
    "approved release"
  );
  expect(owners.authorize).toHaveBeenCalledTimes(1);
});

test("grounding refuses a lost corpus rather than serving SQL bodies or recreating the file", async () => {
  const f = await approved();
  await rm(f.path);
  await expect(verifyCreatorGrounding(actor, f.evidence)).rejects.toMatchObject(
    { code: "ENOENT" }
  );
  await expect(stat(f.path)).rejects.toMatchObject({ code: "ENOENT" });
});

test("guidance cannot become an attributed source citation", async () => {
  const f = await approved("guidance");
  await expect(verifyCreatorGrounding(actor, f.evidence)).rejects.toThrow(
    "outside the approved corpus"
  );
});

test("an active qualified pilot uses the same pre/post corpus permission owner", async () => {
  const f = await approved();
  owners.pilot.mockImplementation(async () => {
    expect(owners.depth).toBeGreaterThan(0);
    return f.pilot;
  });
  await verifyCreatorGrounding(actor, f.evidence, f.pilot.id);
  expect(owners.authorize.mock.calls).toEqual([
    [actor, { kind: "pilot", pilotId: f.pilot.id }],
    [actor, { kind: "pilot", pilotId: f.pilot.id }],
  ]);
});

test.each(["snapshot", "qualification", "release", "digest"])(
  "a pilot with %s mismatch is refused before reading the corpus",
  async (kind) => {
    const f = await approved();
    const pilot = { ...f.pilot };
    if (kind === "snapshot") pilot.answerMode = "snapshot";
    if (kind === "qualification") pilot.qualificationId = null;
    if (kind === "release") pilot.releaseId = randomUUID();
    if (kind === "digest") pilot.manifestDigest = "0".repeat(64);
    owners.pilot.mockResolvedValue(pilot);
    await expect(
      verifyCreatorGrounding(actor, f.evidence, pilot.id)
    ).rejects.toThrow("This grounded pilot is no longer authorized.");
    expect(owners.authorize).not.toHaveBeenCalled();
  }
);

test("a revoked pilot is refused before corpus or filesystem access", async () => {
  const f = await approved();
  owners.pilot.mockRejectedValue(new WorkspaceAccessDenied());
  await expect(
    verifyCreatorGrounding(actor, f.evidence, f.pilot.id)
  ).rejects.toBeInstanceOf(WorkspaceAccessDenied);
  expect(owners.authorize).not.toHaveBeenCalled();
});

test("supported and insufficient-evidence answers retain their existing citation contract", async () => {
  const f = await approved();
  expect(
    validateGroundedAnswer(
      { status: "supported", answer: "Quoted answer", citations: ["S1"] },
      f.evidence
    ).status
  ).toBe("supported");
  expect(
    validateGroundedAnswer(
      { status: "insufficient-evidence", answer: "No support", citations: [] },
      f.evidence
    ).status
  ).toBe("insufficient-evidence");
  expect(() =>
    validateGroundedAnswer(
      { status: "supported", answer: "Missing citation", citations: [] },
      f.evidence
    )
  ).toThrow("require citations");
  expect(() =>
    validateGroundedAnswer(
      { status: "supported", answer: "Foreign citation", citations: ["S2"] },
      f.evidence
    )
  ).toThrow("outside its frozen package");
  expect(await readFile(f.path, "utf8")).toBe(
    JSON.stringify(f.corpus.manifest)
  );
});
