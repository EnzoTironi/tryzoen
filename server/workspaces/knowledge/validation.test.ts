import { expect, test } from "vitest";
import { ontologyPath } from "@zoen/companion-ui/ontology";
import {
  studioProjectBinding,
  studioOntology,
} from "../../../tests/fixtures/analytics/postgres-ontology";
import {
  knowledgeSourceValidationLimits,
  validateKnowledgeProposal,
  validateKnowledgeSources,
} from "./validation";

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
function documents(bindings = [binding], ontology = studioOntology) {
  return [
    { path: ontologyPath, content: JSON.stringify(ontology) },
    ...bindings.map((item, index) => ({
      path: `knowledge/sources/studio_${index}.json`,
      content: JSON.stringify(item),
    })),
  ];
}
test("validates complete declared mappings, relations and exact decimal text without granting access", async () => {
  await expect(
    validateKnowledgeSources(documents([linked, target]))
  ).resolves.toBeUndefined();
  await expect(validateKnowledgeSources([])).resolves.toBeUndefined();
});
test("binding IDs are stable across a move and unique within one candidate", async () => {
  const moved = documents();
  moved[1] = {
    path: "knowledge/sources/renamed.json",
    content: JSON.stringify(binding),
  };
  await expect(validateKnowledgeSources(moved)).resolves.toBeUndefined();
  await expect(
    validateKnowledgeSources(documents([binding, binding]))
  ).rejects.toMatchObject({ reason: "duplicate" });
});
test("a binding needs the actual published ontology and a complete primary key", async () => {
  await expect(
    validateKnowledgeSources(documents().slice(1))
  ).rejects.toMatchObject({ reason: "type" });
  await expect(
    validateKnowledgeSources(
      documents([
        { ...binding, relation: { ...binding.relation, primaryKeySize: 2 } },
      ])
    )
  ).rejects.toMatchObject({ reason: "source" });
});
test("ontology-only removal or type change invalidates unchanged bindings", async () => {
  await expect(
    validateKnowledgeSources(
      documents([binding], { ...studioOntology, types: [] })
    )
  ).rejects.toMatchObject({ reason: "link" });
  const deleted = {
    ...studioOntology,
    types: studioOntology.types.map((type) => ({
      ...type,
      properties: type.properties.filter(({ id }) => id !== "name"),
    })),
  };
  await expect(
    validateKnowledgeSources(documents([binding], deleted))
  ).rejects.toMatchObject({ reason: "property" });
  const numeric = {
    ...studioOntology,
    types: studioOntology.types.map((type) => ({
      ...type,
      properties: type.properties.map((property) =>
        property.id === "planned_budget"
          ? { ...property, type: "number" as const }
          : property
      ),
    })),
  };
  await expect(
    validateKnowledgeSources(documents([binding], numeric))
  ).rejects.toMatchObject({ reason: "property" });
});
test("required properties cannot be omitted or mapped to nullable columns", async () => {
  const missing = {
    ...binding,
    ontology: {
      ...binding.ontology,
      properties: { active: "active", planned_budget: "budget" },
    },
  };
  await expect(
    validateKnowledgeSources(documents([missing]))
  ).rejects.toMatchObject({ reason: "property" });
  const nullable = {
    ...binding,
    columns: binding.columns.map((column) => ({
      ...column,
      nullable: column.id === "title" || column.nullable,
    })),
  };
  await expect(
    validateKnowledgeSources(documents([nullable]))
  ).rejects.toMatchObject({ reason: "property" });
});
test("unknown entities, properties and relations fail instead of being inferred", async () => {
  for (const ontology of [
    { ...binding.ontology, entityType: "unknown" },
    {
      ...binding.ontology,
      properties: { ...binding.ontology.properties, unknown: "title" },
    },
    {
      ...linked.ontology,
      relations: linked.ontology.relations.map((relation) => ({
        ...relation,
        relation: "unknown",
      })),
    },
  ])
    await expect(
      validateKnowledgeSources(documents([{ ...binding, ontology }, target]))
    ).rejects.toBeInstanceOf(Error);
});
test("relations require the surviving target identity, matching column types and declared direction", async () => {
  await expect(
    validateKnowledgeSources(documents([linked]))
  ).rejects.toMatchObject({ reason: "link" });
  const wrongIdentity = {
    ...linked,
    ontology: {
      ...linked.ontology,
      relations: linked.ontology.relations.map((relation) => ({
        ...relation,
        targetColumns: ["title"],
      })),
    },
  };
  await expect(
    validateKnowledgeSources(documents([wrongIdentity, target]))
  ).rejects.toMatchObject({ reason: "link" });
  const wrongType = {
    ...linked,
    ontology: {
      ...linked.ontology,
      relations: linked.ontology.relations.map((relation) => ({
        ...relation,
        columns: ["title"],
      })),
    },
  };
  await expect(
    validateKnowledgeSources(documents([wrongType, target]))
  ).rejects.toMatchObject({ reason: "link" });
  const wrongDirection = {
    ...studioOntology,
    types: [
      ...studioOntology.types,
      { id: "person", name: "Person", properties: [] },
    ],
    relations: studioOntology.relations.map((relation) =>
      Object.assign({}, relation, { to: "person" })
    ),
  };
  await expect(
    validateKnowledgeSources(documents([linked, target], wrongDirection))
  ).rejects.toMatchObject({ reason: "link" });
});
test("a single candidate can remove dependents and then their target", async () => {
  await expect(
    validateKnowledgeSources(documents([linked]))
  ).rejects.toMatchObject({ reason: "link" });
  await expect(
    validateKnowledgeSources(documents([binding]))
  ).resolves.toBeUndefined();
});
test("validation rejects duplicate documents, invalid paths, too many files and aggregate bytes", async () => {
  const initial = documents();
  await expect(
    validateKnowledgeSources([
      ...initial,
      {
        path: "knowledge/sources/studio_0.json",
        content: JSON.stringify(binding),
      },
    ])
  ).rejects.toMatchObject({ reason: "source" });
  await expect(
    validateKnowledgeSources(
      initial.map((item) =>
        item.path.startsWith("knowledge/sources/")
          ? { ...item, path: "knowledge/sources/nested/file.json" }
          : item
      )
    )
  ).rejects.toBeInstanceOf(Error);
  await expect(
    validateKnowledgeSources(
      documents(
        Array.from(
          { length: knowledgeSourceValidationLimits.bindings + 1 },
          () => binding
        )
      )
    )
  ).rejects.toMatchObject({ reason: "source" });
  await expect(
    validateKnowledgeSources(
      initial.map((item) =>
        item.path === ontologyPath
          ? Object.assign({}, item, {
              content:
                item.content +
                " ".repeat(knowledgeSourceValidationLimits.bytes),
            })
          : item
      )
    )
  ).rejects.toMatchObject({ reason: "source" });
});
test("draft binding syntax is checked without pretending a partial proposal is a complete tree", async () => {
  const draft = {
    title: "Studio mapping",
    summary: "Review exact source mappings",
    baseRevision: null,
    changes: [
      {
        path: "knowledge/sources/studio.json",
        content: JSON.stringify(binding),
      },
    ],
    dependencies: [ontologyPath],
    evidence: [
      {
        kind: "link" as const,
        url: "https://example.com/synthetic",
        title: "Synthetic fixture",
        excerpt: "Original fictional data",
      },
    ],
  };
  await expect(validateKnowledgeProposal(draft)).resolves.toMatchObject({
    paths: ["knowledge/sources/studio.json", ontologyPath],
  });
  await expect(
    validateKnowledgeProposal({
      ...draft,
      changes: [
        {
          path: "knowledge/sources/studio.json",
          content: JSON.stringify({ ...binding, credentials: "forbidden" }),
        },
      ],
    })
  ).rejects.toBeInstanceOf(Error);
});
