import { PGlite } from "@electric-sql/pglite";
import { readFile } from "node:fs/promises";
import { afterAll, beforeAll, expect, test } from "vitest";

// Execute the authored additive migration against the previous relevant shape.
// This proves CHECK behavior, not auth, shared PostgreSQL or live TLS transport.
const database = new PGlite();
const configuration = {
  host: "db.example.com",
  port: 5432,
  database: "studio",
  tls: "verify-full",
};
beforeAll(async () => {
  await database.exec(`CREATE TABLE tool_connections (
    kind text NOT NULL, endpoint text NOT NULL, operations jsonb NOT NULL,
    CONSTRAINT tool_connections_kind_check CHECK (kind IN ('mcp', 'openapi'))
  );`);
  await database.exec(
    await readFile(
      new URL(
        "../../db/migrations/0103_postgres-connections.sql",
        import.meta.url
      ),
      "utf8"
    )
  );
});
afterAll(async () => {
  await database.close();
});
async function insert(
  kind: string,
  endpoint: string | null,
  operations: unknown,
  config: unknown
) {
  return await database.query(
    "INSERT INTO tool_connections(kind, endpoint, operations, postgres_config) VALUES ($1, $2, $3::jsonb, $4::jsonb)",
    [
      kind,
      endpoint,
      operations === null ? null : JSON.stringify(operations),
      config === null ? null : JSON.stringify(config),
    ]
  );
}
test("migration preserves HTTP and stores PostgreSQL without fake HTTP fields", async () => {
  await insert("mcp", "https://example.com", [{}], null);
  await insert("openapi", "https://example.com", [{}], null);
  await insert("postgres", null, null, configuration);
  expect(
    (await database.query("SELECT count(*)::int AS n FROM tool_connections"))
      .rows
  ).toEqual([{ n: 3 }]);
});
test.each([
  ["postgres", "postgres://example.com", null, configuration],
  ["postgres", null, [], configuration],
  ["postgres", null, null, null],
  ["postgres", null, null, "null"],
  ["mcp", null, [{}], null],
  ["mcp", "", [{}], null],
  ["mcp", "https://example.com", [], null],
  ["mcp", "https://example.com", null, null],
  ["mcp", "https://example.com", {}, null],
  ["mcp", "https://example.com", [{}], configuration],
  ["other", null, null, configuration],
] as const)(
  "rejects nonexclusive registry SQL variant %#",
  async (kind, endpoint, operations, config) => {
    await expect(
      insert(kind, endpoint, operations, config)
    ).rejects.toMatchObject({ code: "23514" });
  }
);
test.each([
  { ...configuration, port: 0 },
  { ...configuration, port: 65536 },
  { ...configuration, port: 1.5 },
  { ...configuration, port: "5432" },
  { ...configuration, port: null },
  { ...configuration, port: {} },
  {
    host: configuration.host,
    database: configuration.database,
    tls: configuration.tls,
  },
  { ...configuration, host: "db.example.com whitespace" },
  { ...configuration, host: "" },
  { ...configuration, database: "😀".repeat(16) },
  { ...configuration, database: "" },
  { ...configuration, tls: "disable" },
  { ...configuration, password: "secret" },
])("rejects malformed PostgreSQL SQL configuration %#", async (config) => {
  await expect(insert("postgres", null, null, config)).rejects.toMatchObject({
    code: "23514",
  });
});
