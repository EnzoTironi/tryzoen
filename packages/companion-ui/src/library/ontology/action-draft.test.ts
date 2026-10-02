import { expect, test } from "vitest";
import {
  OntologyActionSchema,
  OntologyActInputSchema,
  OntologyReadResultSchema,
} from "./schema";
import {
  beginOntologyAction,
  ontologyActionInput,
  rebaseOntologyAction,
} from "./action-draft";

const operationId = "81f12278-7f6e-4c3d-806b-64004c144836";
const record = () =>
  OntologyReadResultSchema.parse({
    revision: "a".repeat(40),
    asOf: null,
    validOn: null,
    sourceCheckedAtRevision: "a".repeat(40),
    sources: [],
    mayManage: true,
    graph: {
      version: 1,
      types: [
        {
          id: "project",
          name: "Project",
          properties: [
            { id: "status", name: "Status", type: "string", required: false },
          ],
        },
      ],
      relations: [],
      links: [],
      actions: [
        {
          id: "status",
          name: "Change status",
          entityType: "project",
          property: "status",
        },
      ],
      entities: [
        {
          id: "one",
          name: "First",
          type: "project",
          sources: [],
          properties: {
            status: {
              value: "planned",
              sources: [
                {
                  path: "knowledge/project.md",
                  revision: "a".repeat(40),
                  excerpt: "Planned then active during September.",
                },
              ],
              validTime: { from: "2026-09-01", until: "2026-10-01" },
            },
          },
        },
      ],
    },
  });
const draft = () => {
  const opened = beginOntologyAction(record(), "one", "status");
  if (!opened) throw new Error("Missing genuine action draft");
  return { ...opened, value: "active" };
};

test("keeping captured evidence survives replacement edits and explicit rebase", () => {
  const held = { ...draft(), sources: [], from: "", until: "" };
  const input = ontologyActionInput(held, operationId);
  expect(input).toMatchObject({
    expectedRevision: "a".repeat(40),
    value: "active",
    operationId,
    sources: record().graph.entities.find((entity) => entity.id === "one")
      ?.properties.status?.sources,
    validTime: { from: "2026-09-01", until: "2026-10-01" },
  });
  const current = record();
  current.revision = "b".repeat(40);
  const entity = current.graph.entities.find((item) => item.id === "one");
  if (!entity) throw new Error("Missing fixture entity");
  entity.properties.status = { value: "other", sources: [], validTime: null };
  const rebased = rebaseOntologyAction(held, current);
  if (!rebased) throw new Error("Missing explicit rebase");
  expect(held.expectedRevision).toBe("a".repeat(40));
  expect(
    ontologyActionInput(rebased, "349e4f16-116b-4086-8f8e-b7793e6f8ff0")
  ).toMatchObject({
    ...input,
    expectedRevision: "b".repeat(40),
    operationId: "349e4f16-116b-4086-8f8e-b7793e6f8ff0",
  });
});

test("replacement and explicit clear preserve deliberate complete-claim semantics", () => {
  const held = draft();
  expect(
    ontologyActionInput(
      {
        ...held,
        metadata: "replace",
        sources: [
          {
            sourceKey: "replacement",
            path: "knowledge/review.md",
            revision: "b".repeat(40),
            excerpt: "Active in October.",
          },
        ],
        from: "2026-10-01",
        until: "2026-11-01",
      },
      operationId
    )
  ).toMatchObject({
    sources: [
      {
        path: "knowledge/review.md",
        revision: "b".repeat(40),
        excerpt: "Active in October.",
      },
    ],
    validTime: { from: "2026-10-01", until: "2026-11-01" },
  });
  expect(
    ontologyActionInput({ ...held, metadata: "clear" }, operationId)
  ).toMatchObject({ value: "active", sources: [], validTime: null });
  expect(
    held.sources.map(({ path, revision, excerpt }) => ({
      path,
      revision,
      excerpt,
    }))
  ).toEqual(
    record().graph.entities.find((entity) => entity.id === "one")?.properties
      .status?.sources
  );
});

test("reviewed attempts hold their operation, head and body independently of later draft changes", () => {
  const held = draft();
  const attempt = ontologyActionInput(held, operationId);
  const before = structuredClone(attempt);
  held.value = "different";
  held.expectedRevision = "b".repeat(40);
  const citation = held.sources.find(
    (source) => source.path === "knowledge/project.md"
  );
  if (citation) citation.excerpt = "Different passage";
  expect(attempt).toEqual(before);
  expect(OntologyActInputSchema.parse(attempt)).toEqual(before);
  expect(OntologyActionSchema.parse(attempt)).toEqual({
    entityId: "one",
    actionId: "status",
    value: attempt.value,
    sources: attempt.sources,
    validTime: attempt.validTime,
  });
  expect(
    OntologyActInputSchema.safeParse({ ...attempt, workspaceId: "foreign" })
      .success
  ).toBe(false);
});

test("historical, valid-date and unauthorized views cannot start or rebase actions", () => {
  for (const view of [
    { ...record(), mayManage: false },
    { ...record(), asOf: "2026-10-01T10:00:00Z" },
    { ...record(), validOn: "2026-09-15" },
    { ...record(), revision: null },
  ]) {
    expect(beginOntologyAction(view, "one", "status")).toBeNull();
    expect(rebaseOntologyAction(draft(), view)).toBeNull();
  }
  const changed = record();
  const property = changed.graph.types
    .find((type) => type.id === "project")
    ?.properties.find((item) => item.id === "status");
  if (!property) throw new Error("Missing property");
  property.type = "number";
  expect(rebaseOntologyAction(draft(), changed)).toBeNull();
});

test("dates need evidence, intervals are exclusive, and typed values reject empty or invalid input", () => {
  const held = draft();
  expect(() =>
    ontologyActionInput(
      { ...held, metadata: "replace", sources: [] },
      operationId
    )
  ).toThrow("World-valid dates require cited evidence");
  expect(() =>
    ontologyActionInput(
      { ...held, metadata: "replace", from: "2026-10-01", until: "2026-10-01" },
      operationId
    )
  ).toThrow("A valid-time interval must be nonempty");
  expect(
    OntologyActInputSchema.safeParse({
      ...ontologyActionInput(held, operationId),
      sources: [],
    }).success
  ).toBe(false);
  expect(() =>
    ontologyActionInput(
      { ...held, property: { ...held.property, type: "number" }, value: "" },
      operationId
    )
  ).toThrow("Invalid input");
  expect(() =>
    ontologyActionInput(
      {
        ...held,
        property: { ...held.property, type: "boolean" },
        value: "yes",
      },
      operationId
    )
  ).toThrow("Invalid option");
  expect(() =>
    ontologyActionInput(
      {
        ...held,
        property: { ...held.property, type: "date" },
        value: "2026-02-30",
      },
      operationId
    )
  ).toThrow("Invalid ISO date");
});
