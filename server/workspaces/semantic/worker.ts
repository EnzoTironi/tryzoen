import { readFile } from "node:fs/promises";
import { join } from "node:path";
import { Runtime } from "@malloydata/malloy";
import type { QueryRecord, MalloyQueryData } from "@malloydata/malloy";
import { PostgresConnection } from "@malloydata/db-postgres";
import { PGlite, types } from "@electric-sql/pglite";
import { isSafeNumber, parse as parseJSON } from "lossless-json";
import { z } from "zod";
import {
  SemanticSnapshotSchema,
  SemanticResultSchema,
  semanticLimits,
} from "./snapshot.ts";

// Decode JSON before the driver can round integers/decimals. Unsafe numeric
// values cross the result boundary as exact decimal strings, including nests.
const json = (text: string) =>
  parseJSON(text, undefined, {
    parseNumber: (value) => (isSafeNumber(value) ? Number(value) : value),
  });

/** No application credentials, network connections, URL imports or mounted database. */
async function execute(raw: unknown) {
  const input = SemanticSnapshotSchema.parse(raw);
  const db = new PGlite({
    loadDataDir: new Blob([
      await readFile(join(__dirname, "empty-database.tgz")),
    ]),
    parsers: { [types.JSON]: json, [types.JSONB]: json },
  });
  try {
    for (const source of input.tables) {
      const columns = source.columns
        .map((column) => `"${column.name}" ${column.type}`)
        .join(",");
      await db.exec(`CREATE TABLE public."${source.name}" (${columns})`);
      // Parameterized chunks bound SQL/argument allocation and WASM crossings.
      // 200 rows × 30 columns stays well below PostgreSQL's parameter bound.
      for (let offset = 0; offset < source.rows.length; offset += 200) {
        const rows = source.rows.slice(offset, offset + 200);
        const tuples = rows.map(
          (row, index) =>
            `(${row.map((_, column) => `$${index * source.columns.length + column + 1}`).join(",")})`
        );
        await db.query(
          `INSERT INTO public."${source.name}" VALUES ${tuples.join(",")}`,
          rows.flat()
        );
      }
    }
    class SnapshotConnection extends PostgresConnection {
      override async getClient(): Promise<never> {
        throw new Error("Network connections are unavailable");
      }
      override async fetchSelectSchema() {
        return "Raw SQL sources are unavailable";
      }
      override async fetchTableSchema(key: string, path: string) {
        if (!input.tables.some((source) => path === `public.${source.name}`))
          return "Source is unavailable";
        return super.fetchTableSchema(key, path);
      }
      override async runPostgresQuery(
        sql: string,
        _page: number,
        _index: number,
        deJSON: boolean,
        values?: unknown[]
      ): Promise<MalloyQueryData> {
        const response = await db.query<QueryRecord>(sql, values);
        return {
          rows: deJSON
            ? response.rows.map((row) =>
                z.record(z.string(), z.json()).parse(row.row)
              )
            : response.rows,
          totalRows: response.rows.length,
        };
      }
    }
    const runtime = new Runtime({
      connection: new SnapshotConnection("snapshot"),
      urlReader: {
        readURL: async () => {
          throw new Error("Imports are unavailable");
        },
      },
    });
    const loaded = runtime.loadModel(input.model).loadQueryByName(input.query);
    const prepared = await loaded.getPreparedQuery();
    if (
      prepared.givens.size !== Object.keys(input.arguments).length ||
      [...prepared.givens.keys()].some(
        (name) => !Object.hasOwn(input.arguments, name)
      )
    )
      throw new Error("Arguments must match the parameters used by this query");
    const sql = await loaded.getSQL({ givens: input.arguments });
    await db.exec("BEGIN READ ONLY");
    const response = await db.query<{ row: unknown }>(
      `SELECT * FROM (${sql}) AS bounded_result LIMIT ${semanticLimits.rows + 1}`
    );
    const result = SemanticResultSchema.parse({
      sql,
      rows: response.rows.map((row) => row.row),
    });
    const output = JSON.stringify(result);
    if (Buffer.byteLength(output) > semanticLimits.resultBytes)
      throw new Error("Result byte limit exceeded");
    process.stdout.write(output);
  } finally {
    await db.close();
  }
}

let input = "";
process.stdin.setEncoding("utf8");
process.stdin.on("data", (chunk: string) => {
  input += chunk;
  if (Buffer.byteLength(input) > semanticLimits.inputBytes) process.exit(1);
});
process.stdin.on("end", () => {
  void Promise.try(() => execute(JSON.parse(input))).catch(() => {
    // Compiler/SQL diagnostics may contain source text and stay inside this process.
    process.stderr.write("Semantic execution failed");
    process.exitCode = 1;
  });
});
