import { expect, test } from "vitest";
import {
  postgresEndpointSchema,
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

const endpoint = {
  host: "warehouse.example.com",
  port: 5432,
  database: "studio",
  tls: "verify-full" as const,
};

test.each([
  ["Warehouse.Example.COM", "warehouse.example.com"],
  ["xn--bcher-kva.example", "xn--bcher-kva.example"],
  ["8.8.8.8", "8.8.8.8"],
  ["2001:4860:4860::8888", "2001:4860:4860::8888"],
  ["2001:4860:ABCD::1", "2001:4860:abcd::1"],
])("credential-free endpoints canonicalize %s", (host, expected) => {
  expect(postgresEndpointSchema.parse({ ...endpoint, host })).toEqual({
    ...endpoint,
    host: expected,
  });
});

test.each([
  "",
  "localhost",
  "/var/run/postgresql",
  "warehouse.example.com.",
  " warehouse.example.com",
  "warehouse.example.com\n",
  "postgres://user:secret@warehouse.example.com/studio",
  "user@warehouse.example.com",
  "warehouse.example.com:5432",
  "warehouse.example.com/",
  "warehouse.example.com,other.example.com",
  "warehouse.example.com?sslmode=disable",
  "warehouse.example.com#fragment",
  "warehouse_1.example.com",
  "-warehouse.example.com",
  "warehouse-.example.com",
  "a".repeat(64) + ".example.com",
  "a.".repeat(127) + "example.com",
  "bücher.example",
  "2130706433",
  "127.1",
  "0177.0.0.1",
  "0x7f000001",
  "0x7f.0.0.1",
  "[2001:4860:4860::8888]",
  "fe80::1%en0",
  "warehouse.example.com\0",
  "\ud800.example.com",
])("rejects ambiguous host syntax %j before runtime resolution", (host) => {
  expect(postgresEndpointSchema.safeParse({ ...endpoint, host }).success).toBe(
    false
  );
});

test("endpoint syntax never implies public reachability or connection authority", () => {
  for (const host of [
    "127.0.0.1",
    "10.0.0.1",
    "::1",
    "::ffff:127.0.0.1",
    "private.example.com",
  ])
    expect(postgresEndpointSchema.parse({ ...endpoint, host }).host).toBe(host);
});

test.each([0, -1, 65_536, 5432.5, "5432", null, undefined])(
  "requires an explicit integer port: %j",
  (port) => {
    expect(
      postgresEndpointSchema.safeParse({ ...endpoint, port }).success
    ).toBe(false);
  }
);

test("endpoint database uses the same byte-bounded identifier contract", () => {
  expect(
    postgresEndpointSchema.parse({ ...endpoint, database: 'Studio "data"' })
      .database
  ).toBe('Studio "data"');
  for (const database of ["", "é".repeat(32), "bad\0name", "\ud800"])
    expect(
      postgresEndpointSchema.safeParse({ ...endpoint, database }).success
    ).toBe(false);
  expect(
    postgresEndpointSchema.parse({
      ...endpoint,
      database: "é".repeat(31),
      port: 65_535,
    }).port
  ).toBe(65_535);
});

test.each([
  "disable",
  "require",
  "verify-ca",
  false,
  undefined,
  { rejectUnauthorized: false },
])("does not allow weaker TLS policy: %j", (tls) => {
  expect(postgresEndpointSchema.safeParse({ ...endpoint, tls }).success).toBe(
    false
  );
});

test.each([
  "user",
  "password",
  "connectionString",
  "ssl",
  "options",
  "stream",
  "credentials",
  "grants",
  "approved",
])(
  "endpoint metadata cannot carry secrets, driver escapes or grants: %s",
  (key) => {
    expect(
      postgresEndpointSchema.safeParse({ ...endpoint, [key]: "untrusted" })
        .success
    ).toBe(false);
  }
);
