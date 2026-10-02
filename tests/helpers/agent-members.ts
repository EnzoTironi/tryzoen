import type { PGlite } from "@electric-sql/pglite";
import { getTableName, SQL, sql } from "drizzle-orm";
import { getTableConfig, PgDialect } from "drizzle-orm/pg-core";
import { workspaceAgentMembers } from "../../db/schema/agent-members";

/** Exercise the authored constraints directly without generating or applying migrations. */
export async function createAgentMemberTable(database: PGlite) {
  const config = getTableConfig(workspaceAgentMembers);
  const definitions = config.columns.map((column) => {
    let value = sql`${sql.identifier(column.name)} ${sql.raw(column.getSQLType())}`;
    if (column.notNull) value = sql`${value} NOT NULL`;
    if (column.primary) value = sql`${value} PRIMARY KEY`;
    if (column.default !== undefined) {
      if (column.default instanceof SQL)
        value = sql`${value} DEFAULT ${column.default}`;
      else if (typeof column.default === "string")
        value = sql`${value} DEFAULT ${sql.raw("'" + column.default.replaceAll("'", "''") + "'")}`;
      else throw new Error("Unsupported agent-member default");
    }
    return value;
  });
  for (const check of config.checks)
    definitions.push(
      sql`CONSTRAINT ${sql.identifier(check.name)} CHECK (${check.value})`
    );
  for (const index of config.indexes) {
    if (!index.config.unique || !index.config.name)
      throw new Error("Unsupported agent-member index");
    const columns = index.config.columns.map((column) => {
      if (!("name" in column) || typeof column.name !== "string")
        throw new Error("Unsupported agent-member index column");
      return sql.identifier(column.name);
    });
    definitions.push(
      sql`CONSTRAINT ${sql.identifier(index.config.name)} UNIQUE (${sql.join(columns, sql`, `)})`
    );
  }
  for (const key of config.foreignKeys) {
    const reference = key.reference();
    definitions.push(sql`FOREIGN KEY (${sql.join(
      reference.columns.map((column) => sql.identifier(column.name)),
      sql`, `
    )})
      REFERENCES ${sql.identifier(getTableName(reference.foreignTable))} (${sql.join(
        reference.foreignColumns.map((column) => sql.identifier(column.name)),
        sql`, `
      )})
      ON DELETE ${sql.raw(key.onDelete ?? "no action")}`);
  }
  const statement = new PgDialect().sqlToQuery(
    sql`CREATE TABLE ${sql.identifier(config.name)} (${sql.join(definitions, sql`, `)})`
  );
  if (statement.params.length)
    throw new Error("Unexpected agent-member DDL parameter");
  await database.exec(statement.sql);
}
