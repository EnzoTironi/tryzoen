import { expect, test } from "vitest";
import { postgresReadQuery, decodePostgresReadRows } from "./read";
import { decodePostgresCatalog, postgresCatalogFingerprint } from "./catalog";
import {
  studioProjectBinding,
  studioProjectColumns,
  studioProjectsRelation,
  studioProjects,
  studioExpenses,
  studioKnownAnswers,
} from "../../../tests/fixtures/analytics/postgres-ontology";

const signal = new AbortController().signal;
const catalog = decodePostgresCatalog(
  studioProjectsRelation,
  studioProjectColumns,
  signal
);
const binding = studioProjectBinding(catalog.fingerprint);
const published = {
  path: "knowledge/sources/studio.json",
  revision: "a".repeat(40),
  binding,
};
test("fixed reads use published parameters and byte/row guards without embedding input", () => {
  const query = postgresReadQuery(
    published,
    catalog,
    { minimum: "15.00000000000000000001" },
    signal
  );
  expect(query.text).not.toContain("15.00000000000000000001");
  expect(query.values).toEqual(["15.00000000000000000001", 4096, 101]);
  expect(query.text).toContain('"budget" >= $1::pg_catalog.numeric');
  expect(query.text).toContain('FROM ONLY "studio"."projects"');
  expect(query.text).toContain("CASE WHEN pg_catalog.octet_length");
});
test.each([true, false])(
  "restricts the source to the validated relation instead of inherited children (filters: %s)",
  (filtered) => {
    const query = postgresReadQuery(
      {
        ...published,
        binding: { ...binding, filters: filtered ? binding.filters : [] },
      },
      catalog,
      filtered ? { minimum: "0" } : {},
      signal
    );
    expect(query.text.split("\n")[1]).toBe(
      'FROM ONLY "studio"."projects"' +
        (filtered ? ' WHERE "budget" >= $1::pg_catalog.numeric' : "")
    );
    expect(query.values).toEqual(filtered ? ["0", 4096, 101] : [4096, 101]);
    expect(query.text).toContain('ORDER BY "id" LIMIT');
  }
);
test("text that resembles SQL stays a value and quoted identifiers stay one identifier", () => {
  const textBinding = {
    ...binding,
    filters: [{ column: "title", parameter: "title", operator: "eq" as const }],
  };
  const injection = "'; SELECT pg_notify('x','y'); --";
  const query = postgresReadQuery(
    { ...published, binding: textBinding },
    catalog,
    { title: injection },
    signal
  );
  expect(query.text).not.toContain(injection);
  expect(query.values[0]).toBe(injection);
  const relation = { ...catalog.relation, table: 'projects"; SELECT 1; --' };
  const fingerprint = postgresCatalogFingerprint(relation, catalog.columns);
  const quoted = postgresReadQuery(
    {
      ...published,
      binding: { ...binding, relation, schemaFingerprint: fingerprint },
    },
    { ...catalog, relation, fingerprint },
    { minimum: "0" },
    signal
  );
  expect(quoted.text).toContain(
    'FROM ONLY "studio"."projects""; SELECT 1; --"'
  );
});
test.each([
  { minimum: "NaN" },
  { minimum: "Infinity" },
  { minimum: "1; SELECT 2" },
  { minimum: 9007199254740992 },
  { minimum: null },
  {},
  { minimum: "1", extra: "2" },
])(
  "rejects invalid or undeclared arguments before any execution",
  (parameters) => {
    expect(() =>
      postgresReadQuery(published, catalog, parameters, signal)
    ).toThrow(/Arguments|Argument|Invalid|Source/u);
  }
);
test("changed fingerprints and incomplete key mappings cannot prepare a read", () => {
  expect(() =>
    postgresReadQuery(
      {
        ...published,
        binding: { ...binding, schemaFingerprint: "b".repeat(64) },
      },
      catalog,
      { minimum: "0" },
      signal
    )
  ).toThrow("schema changed");
  const columns = catalog.columns.map((column) => ({
    ...column,
    primaryKey: column.name === "budget" || column.primaryKey,
  }));
  const fingerprint = postgresCatalogFingerprint(catalog.relation, columns);
  expect(() =>
    postgresReadQuery(
      { ...published, binding: { ...binding, schemaFingerprint: fingerprint } },
      { ...catalog, columns, fingerprint },
      { minimum: "0" },
      signal
    )
  ).toThrow("complete visible primary key");
});
test("original project rows retain ontology identity, null dates, booleans and exact decimal strings", () => {
  const decoded = decodePostgresReadRows(binding, studioProjects, signal);
  expect(decoded[0]).toEqual({
    id: "1",
    title: "Atlas",
    budget: "100.00",
    launch_day: "2026-09-30",
    active: true,
  });
  expect(decoded[1]?.launch_day).toBeNull();
  for (const budget of ["9007199254740993", "0.1234567890123456789012345"])
    expect(
      decodePostgresReadRows(
        binding,
        [{ ...studioProjects[0], budget }],
        signal
      )[0]?.budget
    ).toBe(budget);
});
test("the original known answers independently preserve an empty project and avoid budget fan-out", () => {
  expect(studioKnownAnswers).toEqual(
    studioProjects.map((project) => {
      const budgetCents = Number(project.budget.replace(".", ""));
      const spentCents = studioExpenses
        .filter(({ projectId }) => projectId === project.id)
        .reduce((sum, expense) => sum + expense.cents, 0);
      return {
        projectId: project.id,
        budgetCents,
        spentCents,
        remainingCents: budgetCents - spentCents,
      };
    })
  );
});
test("result guards reject sentinel rows, oversized cells, missing fields and false type claims", () => {
  expect(() =>
    decodePostgresReadRows(
      binding,
      Array.from({ length: 101 }, () => studioProjects[0]),
      signal
    )
  ).toThrow("row bound");
  expect(() =>
    decodePostgresReadRows(
      binding,
      [{ ...studioProjects[0], _zoen_oversized: true, title: null }],
      signal
    )
  ).toThrow("cell exceeds");
  for (const changed of [
    { title: "é".repeat(2049) },
    { title: "\ud800" },
    { budget: "NaN" },
    { active: "t" },
    { launch_day: "2026-02-30" },
    { id: null },
    { hidden: "private" },
  ])
    expect(() =>
      decodePostgresReadRows(
        binding,
        [{ ...studioProjects[0], ...changed }],
        signal
      )
    ).toThrow(/Arguments|Argument|Invalid|Source/u);
});
test("the byte bound includes JSON escaping and accepts bounded rows without truncation", () => {
  const row = { ...studioProjects[0], title: '"'.repeat(4096) };
  expect(decodePostgresReadRows(binding, [row], signal)[0]?.title).toHaveLength(
    4096
  );
  expect(() =>
    decodePostgresReadRows(
      binding,
      Array.from({ length: 10 }, () => row),
      signal
    )
  ).toThrow("byte bound");
});
test("cancellation stops preparation and closes a partially consumed row iterator", () => {
  const controller = new AbortController();
  let closed = false;
  function* rows() {
    try {
      yield studioProjects[0];
      controller.abort(new Error("read cancelled"));
      yield studioProjects[1];
    } finally {
      closed = true;
    }
  }
  expect(() =>
    decodePostgresReadRows(binding, rows(), controller.signal)
  ).toThrow("read cancelled");
  expect(closed).toBe(true);
  expect(() =>
    postgresReadQuery(published, catalog, { minimum: "0" }, controller.signal)
  ).toThrow("read cancelled");
});

test("a partially visible composite primary key cannot become a complete ontology identity", () => {
  const relation = { ...catalog.relation, primaryKeySize: 2 };
  const fingerprint = postgresCatalogFingerprint(relation, catalog.columns);
  expect(() =>
    postgresReadQuery(
      {
        ...published,
        binding: { ...binding, relation, schemaFingerprint: fingerprint },
      },
      { ...catalog, relation, fingerprint },
      { minimum: "0" },
      signal
    )
  ).toThrow("complete visible primary key");
});

test("complete composite keys provide deterministic ordering without changing declared output", () => {
  const relation = { ...catalog.relation, primaryKeySize: 2 };
  const columns = catalog.columns.map((column) => ({
    ...column,
    primaryKey: column.primaryKey || column.name === "title",
  }));
  const fingerprint = postgresCatalogFingerprint(relation, columns);
  const query = postgresReadQuery(
    {
      ...published,
      binding: {
        ...binding,
        relation,
        schemaFingerprint: fingerprint,
        ontology: { ...binding.ontology, identity: ["id", "title"] },
      },
    },
    { ...catalog, relation, columns, fingerprint },
    { minimum: "0" },
    signal
  );
  expect(query.text).toContain('ORDER BY "id", "title" LIMIT');
});

test("UTF-8 oversized text parameters fail during preparation", () => {
  const textBinding = {
    ...binding,
    filters: [{ column: "title", parameter: "title", operator: "eq" as const }],
  };
  expect(() =>
    postgresReadQuery(
      { ...published, binding: textBinding },
      catalog,
      { title: "é".repeat(2049) },
      signal
    )
  ).toThrow("4096 UTF-8 bytes");
});
