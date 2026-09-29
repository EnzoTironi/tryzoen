import { expect, test } from "vitest";
import {
  OntologyClaimSchema,
  emptyOntology,
} from "@shared/workspaces/ontology";
import { validateOntology } from "./ontology-validation";

const citation = {
  path: "knowledge/project.md",
  revision: "a".repeat(40),
  excerpt: "Active from 2026-09-01 until 2026-10-01.",
};
test.each([
  { from: "2026-10-01", until: "2026-09-01" },
  { from: "2026-09-01", until: "2026-09-01" },
  { from: "2026-02-30", until: null },
  { from: null, until: null },
])("does not invent or normalize invalid world-valid time: %j", (validTime) => {
  expect(
    OntologyClaimSchema.safeParse({
      value: "active",
      sources: [citation],
      validTime,
    }).success
  ).toBe(false);
});
test("unknown dates stay null; explicit dates require evidence and intervals may be open", () => {
  expect(
    OntologyClaimSchema.parse({ value: "active", sources: [], validTime: null })
      .validTime
  ).toBeNull();
  expect(
    OntologyClaimSchema.parse({
      value: "active",
      sources: [citation],
      validTime: { from: "2026-09-01", until: null },
    }).validTime?.from
  ).toBe("2026-09-01");
  expect(
    OntologyClaimSchema.safeParse({
      value: "active",
      sources: [],
      validTime: { from: "2026-09-01", until: null },
    }).success
  ).toBe(false);
  expect(
    OntologyClaimSchema.safeParse({
      value: "active",
      sources: [citation, citation],
      validTime: null,
    }).success
  ).toBe(false);
});
test("relationship identity does not depend on its provenance, and citation reads are bounded", async () => {
  const entity = {
    id: "one",
    type: "project",
    name: "One",
    properties: {},
    sources: [],
  };
  const person = {
    id: "two",
    type: "person",
    name: "Two",
    properties: {},
    sources: [],
  };
  const link = {
    type: "owned_by",
    from: "one",
    to: "two",
    sources: [],
    validTime: null,
  };
  await expect(
    validateOntology({
      ...emptyOntology,
      entities: [entity, person],
      links: [link, { ...link, sources: [citation] }],
    })
  ).rejects.toMatchObject({ reason: "link" });
  await expect(
    validateOntology({
      ...emptyOntology,
      entities: Array.from({ length: 25 }, (_, index) => ({
        ...entity,
        id: `e_${index}`,
        sources: [{ ...citation, path: `knowledge/source-${index}.md` }],
      })),
    })
  ).rejects.toMatchObject({ reason: "source" });
});
