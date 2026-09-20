import { z } from "zod";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { readMigrationFiles, type MigrationMeta } from "drizzle-orm/migrator";
import { drizzle } from "drizzle-orm/node-postgres";
import { migrate } from "drizzle-orm/node-postgres/migrator";
import { execFile } from "node:child_process";
import { promisify } from "node:util";
import { operationSignal } from "../operations/async";
import { Client } from "pg";

class MigrationFailure extends Error {
  readonly _tag = "MigrationFailure";

  constructor(input: { readonly message: string }) {
    super(input.message);
    this.name = "MigrationFailure";
    Object.assign(this, input);
  }
}

const journalRows = z.array(
  z.object({ hash: z.string(), created_at: z.coerce.number() })
);

/** Drizzle otherwise checks timestamps alone, which cannot detect changed history. */
export const verifyMigrationPrefix = async function (
  source: readonly MigrationMeta[],
  applied: readonly { hash: string; created_at: number }[],
  name: string
) {
  for (const [index, row] of applied.entries()) {
    const expected = source[index];
    if (
      !expected ||
      expected.hash !== row.hash ||
      expected.folderMillis !== row.created_at
    ) {
      throw new MigrationFailure({
        message: `${name} migration history differs at entry ${String(index + 1)}. Restore the matching source before deploying.`,
      });
    }
  }
  return undefined;
};

const inspectJournal = async function (
  client: Client,
  folder: string,
  schema: "drizzle" | "workflow_drizzle",
  table: "__drizzle_migrations" | "workflow_migrations"
) {
  const source = await Promise.try(async () =>
    readMigrationFiles({ migrationsFolder: folder })
  ).catch(() => {
    throw new MigrationFailure({
      message: `Cannot read ${schema} migrations.`,
    });
  });
  const result = await Promise.try(async () => {
    const exists = await client.query<{ present: boolean }>(
      "SELECT to_regclass($1) IS NOT NULL AS present",
      [`${schema}.${table}`]
    );
    if (!exists.rows[0]?.present) return [];
    // Identifiers are closed literals owned by this module.
    return (
      await client.query<{ hash: string; created_at: string }>(
        `SELECT hash, created_at::text FROM ${schema}.${table} ORDER BY id`
      )
    ).rows;
  }).catch(() => {
    throw new MigrationFailure({
      message: `Cannot inspect ${schema} migration history.`,
    });
  });
  const rows = await journalRows.parseAsync(result);
  await verifyMigrationPrefix(source, rows, schema);
  return { applied: rows.length, total: source.length };
};

/** A single session lock covers both application and Eve/Graphile migrations. */
export async function migrateApplication(connectionString: string) {
  const client = new Client({
    connectionString,
    connectionTimeoutMillis: 15_000,
  });
  try {
    try {
      await client.connect();
    } catch {
      throw new MigrationFailure({
        message: "Cannot connect the migration role.",
      });
    }
    await Promise.try(async () =>
      client.query(
        "SET lock_timeout = '60s'; SELECT pg_advisory_lock(1836019566, 2)"
      )
    ).catch(() => {
      throw new MigrationFailure({
        message: "Another deployment holds the migration lock.",
      });
    });
    const appFolder = resolve("db/migrations");
    const workflowRoot = resolve(
      dirname(fileURLToPath(import.meta.resolve("@workflow/world-postgres"))),
      ".."
    );
    const workflowFolder = resolve(workflowRoot, "src/drizzle/migrations");
    await inspectJournal(client, appFolder, "drizzle", "__drizzle_migrations");
    await inspectJournal(
      client,
      workflowFolder,
      "workflow_drizzle",
      "workflow_migrations"
    );
    await Promise.try(async () =>
      migrate(drizzle(client), { migrationsFolder: appFolder })
    ).catch(() => {
      throw new MigrationFailure({
        message: "Application migration failed; no web release was switched.",
      });
    });
    try {
      await promisify(execFile)(
        process.execPath,
        [resolve(workflowRoot, "bin/setup.js")],
        {
          // oxlint-disable-next-line eslint/no-restricted-properties -- Forward the parent environment to the owned CLI subprocess.
          env: { ...process.env, WORKFLOW_POSTGRES_URL: connectionString },
          signal: operationSignal(),
          maxBuffer: 1_000_000,
        }
      );
    } catch {
      throw new MigrationFailure({
        message: "Eve workflow migration failed; no web release was switched.",
      });
    }
    const app = await inspectJournal(
      client,
      appFolder,
      "drizzle",
      "__drizzle_migrations"
    );
    const eve = await inspectJournal(
      client,
      workflowFolder,
      "workflow_drizzle",
      "workflow_migrations"
    );
    if (app.applied !== app.total || eve.applied !== eve.total) {
      throw new MigrationFailure({
        message: "Migration verification found unapplied changes.",
      });
    }
    return {
      applicationMigrations: app.applied,
      workflowMigrations: eve.applied,
    };
  } finally {
    await client.end();
  }
}
