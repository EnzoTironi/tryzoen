import { randomUUID } from "node:crypto";
import { PayloadReferenceSchema } from "../payloads/contract";
import { payloadDigest } from "../payloads/s3";
import { beforeAll, beforeEach, expect, test, vi } from "vitest";
import type { SQL } from "drizzle-orm";
import { PgDialect } from "drizzle-orm/pg-core";
import { z } from "zod";
import { jsonString } from "@shared/validation";
import { sourceBindingSchema } from "@zoen/companion-ui/workspace-sources";
import { ontologyPath } from "@zoen/companion-ui/ontology";
import {
  studioOntology,
  studioProjectBinding,
} from "../../tests/fixtures/analytics/postgres-ontology";
import { publishWorkspaceGit, readWorkspaceGit } from "./git";
import { WorkspaceAccessDenied } from "./access";
import { WorkspaceRepository } from "./repository";
import { knowledgeSourceValidationLimits } from "./knowledge/validation";

// Mock database, access and external payload publication at their owning
// boundaries. Candidate Git and complete source validation remain real; native
// runtime suites separately prove PostgreSQL transactions and S3 behavior.
const boundary = vi.hoisted(() => ({
  query: vi.fn<(statement: SQL) => Promise<Record<string, unknown>[]>>(),
  access: vi.fn<(actor: unknown, admin?: boolean) => Promise<void>>(),
  payloadRead: vi.fn<typeof import("../payloads/publication").readPayload>(),
  payloadRegister:
    vi.fn<typeof import("../payloads/publication").registerPayload>(),
  payloadPut: vi.fn<typeof import("../payloads/publication").putRegistered>(),
  payloadAdopt: vi.fn<typeof import("../payloads/publication").adoptPayload>(),
}));
vi.mock("@db/queries", () => ({
  query: boundary.query,
  transaction: async (run: () => Promise<unknown>) => run(),
  SqlError: class extends Error {},
}));
vi.mock("../payloads/publication", () => ({
  readPayload: boundary.payloadRead,
  registerPayload: boundary.payloadRegister,
  putRegistered: boundary.payloadPut,
  adoptPayload: boundary.payloadAdopt,
}));
vi.mock("./access", () => ({
  requireWorkspaceAccess: boundary.access,
  WorkspaceAccessDenied: class extends Error {},
}));
vi.mock("./bots", () => ({
  readAgentGrantCapabilities: vi.fn<() => Promise<null>>(),
}));

const actor = { userId: "synthetic-reviewer", workspaceId: "synthetic-studio" };
const path = "knowledge/sources/studio.json";
const targetPath = "knowledge/sources/related.json";
const proposal =
  "proposals/knowledge/e30ae98d-af19-4913-86bc-ec5d4c056935.json";
const reviewed = { kind: "knowledge-publication" as const, proposal };
const operationId = "4b931332-e4a7-4818-bef8-d314a7e3f604";
const binding = studioProjectBinding("a".repeat(64));
const target = { ...binding, id: "68798e7a-e7f2-4c0d-a317-179061ce6b37" };
const linked = {
  ...binding,
  ontology: {
    ...binding.ontology,
    relations: [
      {
        relation: "related_to",
        columns: ["id"],
        targetBindingId: target.id,
        targetColumns: ["id"],
      },
    ],
  },
};
const draft = JSON.stringify({
  title: "Review studio sources",
  summary: "Original synthetic proposal",
  baseRevision: null,
  changes: [{ path, content: JSON.stringify(binding) }],
  dependencies: [ontologyPath],
  evidence: [
    {
      kind: "link",
      url: "https://example.com/synthetic",
      title: "Synthetic fixture",
      excerpt: "Original fictional studio data",
    },
  ],
});
let initial: Awaited<ReturnType<typeof publishWorkspaceGit>>;
let related: typeof initial;
let stored: typeof initial;
const receipts = new Map<string, { revision: string; request_hash: string }>();
let casAttempts = 0;
let raced = false;
const generation = "07f23860-f3a8-4ad6-a42e-a27dc891ed98";
const originalPayload = "bff42ef5-ecb4-4b44-890b-5e9ee316b86b";
const candidates = new Map<string, Uint8Array>();
const dialect = new PgDialect();

beforeAll(async () => {
  initial = await publishWorkspaceGit({
    bundle: null,
    parent: null,
    changes: [
      { path: ontologyPath, content: JSON.stringify(studioOntology) },
      { path, content: JSON.stringify(binding) },
      { path: proposal, content: draft },
    ],
    message: "Original synthetic source review fixture",
  });
  related = await publishWorkspaceGit({
    bundle: initial.bundle,
    parent: initial.revision,
    changes: [
      { path, content: JSON.stringify(linked) },
      { path: targetPath, content: JSON.stringify(target) },
    ],
    message: "Synthetic dependent source fixture",
  });
});
beforeEach(() => {
  stored = initial;
  receipts.clear();
  casAttempts = 0;
  raced = false;
  boundary.access.mockReset().mockResolvedValue(undefined);
  candidates.clear();
  boundary.payloadRead
    .mockReset()
    .mockImplementation(async () => Uint8Array.from(stored.bundle));
  boundary.payloadRegister
    .mockReset()
    .mockImplementation(async (scope, bytes) =>
      PayloadReferenceSchema.parse({
        ...scope,
        candidateId: randomUUID(),
        sha256: payloadDigest(bytes),
        byteLength: bytes.byteLength,
      })
    );
  boundary.payloadPut
    .mockReset()
    .mockImplementation(async (reference, bytes) => {
      if (
        payloadDigest(bytes) !== reference.sha256 ||
        bytes.byteLength !== reference.byteLength
      )
        throw new Error("Invalid synthetic publication bytes");
      candidates.set(reference.candidateId, Uint8Array.from(bytes));
    });
  boundary.payloadAdopt.mockReset().mockImplementation(async (reference) => {
    if (!candidates.has(reference.candidateId))
      throw new Error("Synthetic candidate has not been verified");
  });
  boundary.query.mockReset().mockImplementation(async (statement) => {
    const { sql, params } = dialect.sqlToQuery(statement);
    if (params[0] !== actor.workspaceId)
      throw new Error("Unexpected workspace scope");
    if (sql.startsWith("SELECT revision, request_hash")) {
      const receipt = receipts.get(z.string().parse(params[1]));
      return receipt ? [receipt] : [];
    }
    if (sql.startsWith("SELECT payload_generation AS generation"))
      return [{ generation }];
    if (sql.startsWith("SELECT pg_advisory_xact_lock")) return [];
    if (sql.startsWith("SELECT r.head_sha AS head")) {
      return [
        {
          head: stored.revision,
          payloadId: originalPayload,
          generation,
          recordedRevision: null,
        },
      ];
    }
    if (sql.startsWith("INSERT INTO workspace_repository")) {
      casAttempts++;
      if (raced || params[3] !== stored.revision) return [];
      const bytes = candidates.get(z.uuid().parse(params[2]));
      if (!bytes) throw new Error("Missing verified candidate");
      stored = {
        revision: z.string().parse(params[1]),
        bundle: Buffer.from(bytes),
        files: [],
      };
      return [{ head_sha: stored.revision }];
    }
    if (sql.startsWith("INSERT INTO workspace_revision")) {
      receipts.set(z.string().parse(params[3]), {
        revision: z.string().parse(params[1]),
        request_hash: z.string().parse(params[4]),
      });
      return [];
    }
    throw new Error(`Unexpected database boundary: ${sql}`);
  });
});

function input(
  changes: Parameters<typeof WorkspaceRepository.publish>[1]["changes"]
) {
  return { operationId, expectedRevision: stored.revision, changes };
}
function unchanged(previous = initial) {
  expect(stored.revision).toBe(previous.revision);
  expect(stored.bundle).toBe(previous.bundle);
  expect(receipts.size).toBe(0);
}

test.each(["editor", "agent", "import"] as const)(
  "%s cannot create, replace or delete source files, even with an administrator actor",
  async (kind) => {
    const source =
      kind === "import"
        ? { kind, filename: "synthetic.csv", bytes: new Uint8Array([1]) }
        : { kind };
    for (const change of [
      { path: "knowledge/sources/new.json", content: JSON.stringify(target) },
      { path, content: JSON.stringify({ ...binding, title: "Changed" }) },
      { path, content: null },
    ])
      await expect(
        WorkspaceRepository.publish(actor, input([change]), source)
      ).rejects.toBeInstanceOf(WorkspaceAccessDenied);
    expect(boundary.query).not.toHaveBeenCalled();
    expect(casAttempts).toBe(0);
    unchanged();
  }
);
test("reviewed publication validates files before CAS and consumes its draft atomically", async () => {
  const result = await WorkspaceRepository.publish(
    actor,
    input([
      {
        path,
        content: JSON.stringify({ ...binding, title: "Reviewed exact source" }),
      },
    ]),
    reviewed
  );
  expect(result.revision).toBe(stored.revision);
  expect(result.revision).not.toBe(initial.revision);
  expect(casAttempts).toBe(1);
  expect(receipts.size).toBe(1);
  expect(boundary.access.mock.calls).toEqual([
    [actor, true],
    [actor, true],
    [actor, true],
  ]);
  const tree = await readWorkspaceGit(stored.bundle, stored.revision);
  expect(tree.files).toEqual([path, ontologyPath]);
  expect(
    jsonString(sourceBindingSchema).parse(
      (await readWorkspaceGit(stored.bundle, stored.revision, path)).content
    ).title
  ).toBe("Reviewed exact source");
});
test("ontology-only property changes validate every unchanged source", async () => {
  const graph = {
    ...studioOntology,
    types: studioOntology.types.map((type) => ({
      ...type,
      properties: type.properties.map((property) =>
        property.id === "planned_budget"
          ? { ...property, type: "number" }
          : property
      ),
    })),
  };
  await expect(
    WorkspaceRepository.publish(
      actor,
      input([{ path: ontologyPath, content: JSON.stringify(graph) }]),
      { kind: "ontology" }
    )
  ).rejects.toMatchObject({ reason: "property" });
  expect(casAttempts).toBe(0);
  unchanged();
});
test("ontology-only deletion of a mapped entity type cannot leave a dangling binding", async () => {
  await expect(
    WorkspaceRepository.publish(
      actor,
      input([
        {
          path: ontologyPath,
          content: JSON.stringify({
            ...studioOntology,
            types: [],
            relations: [],
          }),
        },
      ]),
      { kind: "ontology" }
    )
  ).rejects.toMatchObject({ reason: "type" });
  expect(casAttempts).toBe(0);
  unchanged();
});
test("a reviewed multi-file change repairs a renamed property in one candidate", async () => {
  const graph = {
    ...studioOntology,
    types: studioOntology.types.map((type) =>
      Object.assign({}, type, {
        properties: type.properties.map((property) =>
          property.id === "name"
            ? Object.assign({}, property, { id: "label" })
            : property
        ),
      })
    ),
  };
  const { name, ...properties } = binding.ontology.properties;
  const updated = {
    ...binding,
    ontology: {
      ...binding.ontology,
      properties: { ...properties, label: z.string().parse(name) },
    },
  };
  await WorkspaceRepository.publish(
    actor,
    input([
      { path: ontologyPath, content: JSON.stringify(graph) },
      { path, content: JSON.stringify(updated) },
    ]),
    reviewed
  );
  expect(casAttempts).toBe(1);
  expect(receipts.size).toBe(1);
});
test("deleting a referenced target fails; repairing its dependent in the same review succeeds", async () => {
  stored = related;
  await expect(
    WorkspaceRepository.publish(
      actor,
      input([{ path: targetPath, content: null }]),
      reviewed
    )
  ).rejects.toMatchObject({ reason: "link" });
  expect(casAttempts).toBe(0);
  unchanged(related);
  await WorkspaceRepository.publish(
    actor,
    input([
      { path: targetPath, content: null },
      { path, content: JSON.stringify(binding) },
    ]),
    reviewed
  );
  expect(casAttempts).toBe(1);
  expect(
    (await readWorkspaceGit(stored.bundle, stored.revision)).files
  ).toEqual([path, ontologyPath]);
});
test("deleting or changing a referenced target identity column fails before CAS", async () => {
  stored = related;
  const changed = {
    ...target,
    columns: target.columns.map((column) =>
      column.id === "id" ? Object.assign({}, column, { type: "text" }) : column
    ),
  };
  await expect(
    WorkspaceRepository.publish(
      actor,
      input([{ path: targetPath, content: JSON.stringify(changed) }]),
      reviewed
    )
  ).rejects.toMatchObject({ reason: "link" });
  expect(casAttempts).toBe(0);
  unchanged(related);
});
test("relevant knowledge edits cannot preserve an invalid existing source tree", async () => {
  const invalid = await publishWorkspaceGit({
    bundle: initial.bundle,
    parent: initial.revision,
    changes: [
      {
        path,
        content: JSON.stringify({
          ...binding,
          ontology: { ...binding.ontology, entityType: "unknown" },
        }),
      },
    ],
    message: "Synthetic invalid candidate fixture",
  });
  stored = invalid;
  await expect(
    WorkspaceRepository.publish(
      actor,
      input([{ path: "knowledge/note.md", content: "Synthetic note" }]),
      { kind: "editor" }
    )
  ).rejects.toMatchObject({ reason: "type" });
  expect(casAttempts).toBe(0);
  unchanged(invalid);
});
test("stale revision and a raced CAS leave the bundle and receipts unchanged", async () => {
  const publish = input([
    { path, content: JSON.stringify({ ...binding, title: "Reviewed source" }) },
  ]);
  await expect(
    WorkspaceRepository.publish(
      actor,
      { ...publish, expectedRevision: "b".repeat(40) },
      reviewed
    )
  ).rejects.toMatchObject({ reason: "conflict" });
  expect(casAttempts).toBe(0);
  unchanged();
  raced = true;
  await expect(
    WorkspaceRepository.publish(actor, publish, reviewed)
  ).rejects.toMatchObject({ reason: "conflict" });
  expect(casAttempts).toBe(1);
  unchanged();
});
test("operation replay returns its original revision; reusing it with another payload conflicts", async () => {
  const publish = input([
    { path, content: JSON.stringify({ ...binding, title: "Reviewed source" }) },
  ]);
  const first = await WorkspaceRepository.publish(actor, publish, reviewed);
  await expect(
    WorkspaceRepository.publish(actor, publish, reviewed)
  ).resolves.toEqual(first);
  expect(casAttempts).toBe(1);
  await expect(
    WorkspaceRepository.publish(
      actor,
      {
        ...publish,
        changes: [
          {
            path,
            content: JSON.stringify({ ...binding, title: "Different payload" }),
          },
        ],
      },
      reviewed
    )
  ).rejects.toMatchObject({ reason: "conflict" });
  expect(casAttempts).toBe(1);
  expect(receipts.size).toBe(1);
});
test("revoked publication authority after candidate validation exposes no new head or receipt", async () => {
  boundary.access
    .mockResolvedValueOnce(undefined)
    .mockRejectedValueOnce(new WorkspaceAccessDenied());
  await expect(
    WorkspaceRepository.publish(
      actor,
      input([
        {
          path,
          content: JSON.stringify({ ...binding, title: "Reviewed source" }),
        },
      ]),
      reviewed
    )
  ).rejects.toBeInstanceOf(WorkspaceAccessDenied);
  expect(boundary.access).toHaveBeenCalledTimes(2);
  expect(casAttempts).toBe(0);
  unchanged();
});

test("too many source files fail the complete candidate rather than validating a subset", async () => {
  const changes = Array.from(
    { length: knowledgeSourceValidationLimits.bindings },
    (_, index) => ({
      path: `knowledge/sources/additional_${index}.json`,
      content: JSON.stringify({
        ...binding,
        id: `de6325a5-9342-47bb-a1bc-${index.toString(16).padStart(12, "0")}`,
      }),
    })
  );
  await expect(
    WorkspaceRepository.publish(actor, input(changes), reviewed)
  ).rejects.toMatchObject({ reason: "invalid_input" });
  expect(casAttempts).toBe(0);
  unchanged();
});
test("invalid authored bindings are rejected as input before any database mutation", async () => {
  await expect(
    WorkspaceRepository.publish(
      actor,
      input([
        {
          path,
          content: JSON.stringify({ ...binding, credentials: "forbidden" }),
        },
      ]),
      reviewed
    )
  ).rejects.toMatchObject({ reason: "invalid_input" });
  expect(boundary.query).not.toHaveBeenCalled();
  unchanged();
});
