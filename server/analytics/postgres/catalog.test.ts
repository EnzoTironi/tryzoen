import { expect, test } from "vitest";
import {
  decodePostgresCatalog,
  decodePostgresRelations,
  postgresCatalogFingerprint,
  postgresColumnsQuery,
  postgresRelationsQuery,
} from "./catalog";
import {
  studioProjectColumns,
  studioProjectsRelation,
} from "../../../tests/fixtures/analytics/postgres-ontology";

const signal = new AbortController().signal;
test("catalog templates parameterize scope and retain schema/column privilege checks", () => {
  const injected = "studio'; SELECT 'private";
  const query = postgresRelationsQuery({ schemas: [injected] }, signal);
  expect(query.text).not.toContain(injected);
  expect(query.values).toEqual([[injected], null, null, 51]);
  expect(query.text).toContain("pg_catalog.has_schema_privilege");
  expect(query.text).toContain("pg_catalog.has_column_privilege");
  const columns = postgresColumnsQuery(studioProjectsRelation, signal);
  expect(columns.values).toEqual([42001, "studio", "projects", 31]);
  expect(columns.text).toContain("pg_catalog.has_column_privilege");
});
test("permission-contract response mocks reject out-of-scope data and repeated relations", () => {
  const scope = { schemas: ["studio"] };
  expect(() =>
    decodePostgresRelations(
      scope,
      [{ ...studioProjectsRelation, schema: "private", oid: "42001" }],
      signal
    )
  ).toThrow("permitted scope");
  const row = { ...studioProjectsRelation, oid: "42001" };
  expect(() => decodePostgresRelations(scope, [row, row], signal)).toThrow(
    "repeats"
  );
  expect(() =>
    postgresRelationsQuery(
      { ...scope, after: { schema: "private", table: "people" } },
      signal
    )
  ).toThrow("permitted schemas");
});
test("bounded discovery exposes continuation explicitly and never returns the sentinel as data", () => {
  const rows = Array.from({ length: 51 }, (_, index) => ({
    schema: "studio",
    primaryKeySize: 1,
    table: `table_${index}`,
    oid: String(index + 1),
  }));
  const value = decodePostgresRelations({ schemas: ["studio"] }, rows, signal);
  expect(value.items).toHaveLength(50);
  expect(value.after).toEqual({ schema: "studio", table: "table_49" });
  expect(
    decodePostgresRelations({ schemas: ["studio"] }, rows.slice(0, 1), signal)
      .after
  ).toBeNull();
});
test("a complete catalog fingerprints types/nullability/key identity and detects drift", () => {
  const original = decodePostgresCatalog(
    studioProjectsRelation,
    studioProjectColumns,
    signal
  );
  const reordered = postgresCatalogFingerprint(
    original.relation,
    original.columns.toReversed()
  );
  expect(reordered).toBe(original.fingerprint);
  const changed = studioProjectColumns.map((column) => ({
    ...column,
    nullable: column.name === "budget" || column.nullable,
  }));
  expect(
    decodePostgresCatalog(studioProjectsRelation, changed, signal).fingerprint
  ).not.toBe(original.fingerprint);
  const unsupported = decodePostgresCatalog(
    studioProjectsRelation,
    [
      {
        ...studioProjectColumns[0],
        typeOid: "9999",
        nativeType: "pg_catalog.int4",
      },
    ],
    signal
  );
  expect(unsupported.columns[0]?.type).toBeNull();
});
test("incomplete or oversized catalogs fail instead of acquiring a partial fingerprint", () => {
  expect(() =>
    decodePostgresCatalog(studioProjectsRelation, [], signal)
  ).toThrow(/Too (?:small|big)/u);
  expect(() =>
    decodePostgresCatalog(
      studioProjectsRelation,
      Array.from({ length: 31 }, (_, index) => ({
        ...studioProjectColumns[0],
        name: `field_${index}`,
        ordinal: index + 1,
      })),
      signal
    )
  ).toThrow(/Too (?:small|big)/u);
});
test("cancelled discovery does not prepare a query or return a catalog", () => {
  const controller = new AbortController();
  controller.abort(new Error("discovery cancelled"));
  expect(() =>
    postgresRelationsQuery({ schemas: ["studio"] }, controller.signal)
  ).toThrow("discovery cancelled");
  expect(() =>
    decodePostgresCatalog(
      studioProjectsRelation,
      studioProjectColumns,
      controller.signal
    )
  ).toThrow("discovery cancelled");
});

test("schema fingerprints retain native precision and length modifiers", () => {
  const original = decodePostgresCatalog(
    studioProjectsRelation,
    studioProjectColumns,
    signal
  );
  const changed = studioProjectColumns.map((column) =>
    Object.assign({}, column, {
      typeModifier: column.name === "budget" ? 655_366 : column.typeModifier,
    })
  );
  expect(
    decodePostgresCatalog(studioProjectsRelation, changed, signal).fingerprint
  ).not.toBe(original.fingerprint);
});
