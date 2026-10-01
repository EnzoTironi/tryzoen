import { expect, test } from "vitest";
import {
  postgresIdentifierSchema,
  postgresReadArgumentsSchema,
  publishedSourceBindingSchema,
  sourceBindingSchema,
} from "./sources-schema";
import { studioProjectBinding } from "../../../../tests/fixtures/analytics/postgres-ontology";

const binding = studioProjectBinding("a".repeat(64));
test("a reviewed file has stable identity independent of its path and a pinned read revision", () => {
  const initial = publishedSourceBindingSchema.parse({
    path: "knowledge/sources/studio.json",
    revision: "b".repeat(40),
    binding,
  });
  const renamed = publishedSourceBindingSchema.parse({
    ...initial,
    path: "knowledge/sources/projects.json",
  });
  expect(renamed.binding.id).toBe(initial.binding.id);
  expect(initial.binding.ontology.properties.planned_budget).toBe("budget");
  expect(initial.binding.freshness.upstream).toBe("unknown");
});
test.each(["permission", "credentials", "scope", "approved"])(
  "authored %s metadata cannot grant authority",
  (key) => {
    expect(
      sourceBindingSchema.safeParse({ ...binding, [key]: "admin" }).success
    ).toBe(false);
  }
);
test.each([
  { ...binding, ontology: { ...binding.ontology, identity: ["missing"] } },
  { ...binding, ontology: { ...binding.ontology, identity: ["launch_day"] } },
  {
    ...binding,
    ontology: { ...binding.ontology, properties: { budget: "missing" } },
  },
  { ...binding, columns: [...binding.columns, binding.columns[0]] },
  { ...binding, filters: [...binding.filters, binding.filters[0]] },
  {
    ...binding,
    filters: [{ column: "title", parameter: "minimum", operator: "gte" }],
  },
  { ...binding, freshness: { ...binding.freshness, upstream: "live" } },
])("rejects ambiguous or invented mappings and freshness", (invalid) => {
  expect(sourceBindingSchema.safeParse(invalid).success).toBe(false);
});
test("self-referential ontology relations are descriptions, not permission grants", () => {
  expect(
    sourceBindingSchema.parse({
      ...binding,
      ontology: {
        ...binding.ontology,
        relations: [
          {
            relation: "related_to",
            columns: ["id"],
            targetBindingId: binding.id,
            targetColumns: ["id"],
          },
        ],
      },
    }).ontology.relations
  ).toHaveLength(1);
});
test("identifiers preserve quoted names while rejecting invalid UTF-8 and oversized byte names", () => {
  expect(postgresIdentifierSchema.parse('A "quoted" name')).toBe(
    'A "quoted" name'
  );
  expect(postgresIdentifierSchema.safeParse("é".repeat(31)).success).toBe(true);
  for (const name of ["é".repeat(32), "bad\0name", "\ud800", ""])
    expect(postgresIdentifierSchema.safeParse(name).success).toBe(false);
  expect(postgresIdentifierSchema.safeParse("😀").success).toBe(true);
});

test("read arguments share UTF-8 byte and well-formed text bounds with source cells", () => {
  expect(
    postgresReadArgumentsSchema.parse({ title: "é".repeat(2048) })
  ).toEqual({
    title: "é".repeat(2048),
  });
  expect(postgresReadArgumentsSchema.parse({ title: "😀" })).toEqual({
    title: "😀",
  });
  for (const title of ["é".repeat(2049), "bad\0value", "\ud800"])
    expect(postgresReadArgumentsSchema.safeParse({ title }).success).toBe(
      false
    );
});

test("native integers and NUMERIC declare decimal string transport explicitly", () => {
  expect(
    binding.columns
      .filter(({ id }) => id === "id" || id === "budget")
      .map(({ type }) => type)
  ).toEqual(["decimal", "decimal"]);
  expect(
    sourceBindingSchema.safeParse({
      ...binding,
      columns: binding.columns.map((column) =>
        column.id === "budget"
          ? Object.assign({}, column, { type: "numeric" })
          : column
      ),
    }).success
  ).toBe(false);
});
