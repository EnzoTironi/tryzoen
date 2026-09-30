import { createHash } from "node:crypto";
import { z } from "zod";
import {
  postgresCatalogColumnSchema,
  postgresCatalogSchema,
  postgresCatalogScopeSchema,
  postgresRelationSchema,
  postgresSourceLimits,
} from "@zoen/companion-ui/workspace-sources";

/** Pure templates: the caller must resolve permitted scope and admit remote work. */
export function postgresRelationsQuery(
  input: z.input<typeof postgresCatalogScopeSchema>,
  signal: AbortSignal
) {
  signal.throwIfAborted();
  const scope = postgresCatalogScopeSchema.parse(input);
  if (scope.after && !scope.schemas.includes(scope.after.schema))
    throw new Error("Catalog cursor is outside the permitted schemas");
  return {
    text: `SELECT n.nspname AS "schema", c.relname AS "table", c.oid::pg_catalog.text AS oid,
  COALESCE((SELECT pg_catalog.cardinality(k.conkey) FROM pg_catalog.pg_constraint k
    WHERE k.conrelid = c.oid AND k.contype = 'p'), 0) AS "primaryKeySize"
FROM pg_catalog.pg_class c JOIN pg_catalog.pg_namespace n ON n.oid = c.relnamespace
WHERE n.nspname = ANY($1::pg_catalog.text[]) AND c.relkind = 'r'
  AND pg_catalog.has_schema_privilege(n.oid, 'USAGE')
  AND EXISTS (SELECT 1 FROM pg_catalog.pg_attribute a
    WHERE a.attrelid = c.oid AND a.attnum > 0 AND NOT a.attisdropped
      AND pg_catalog.has_column_privilege(c.oid, a.attnum, 'SELECT'))
  AND ($2::pg_catalog.text IS NULL OR (n.nspname, c.relname) > ($2::pg_catalog.text, $3::pg_catalog.text))
ORDER BY n.nspname, c.relname LIMIT $4`,
    values: [
      scope.schemas,
      scope.after?.schema ?? null,
      scope.after?.table ?? null,
      postgresSourceLimits.relations + 1,
    ],
  };
}

export function postgresColumnsQuery(
  input: z.input<typeof postgresRelationSchema>,
  signal: AbortSignal
) {
  signal.throwIfAborted();
  const relation = postgresRelationSchema.parse(input);
  return {
    text: `SELECT a.attname AS name, a.attnum AS ordinal, a.atttypid::pg_catalog.text AS "typeOid", a.atttypmod AS "typeModifier",
  tn.nspname || '.' || t.typname AS "nativeType", NOT a.attnotnull AS nullable,
  EXISTS (SELECT 1 FROM pg_catalog.pg_constraint k
    WHERE k.conrelid = c.oid AND k.contype = 'p' AND a.attnum = ANY(k.conkey)) AS "primaryKey"
FROM pg_catalog.pg_class c JOIN pg_catalog.pg_namespace n ON n.oid = c.relnamespace
JOIN pg_catalog.pg_attribute a ON a.attrelid = c.oid
JOIN pg_catalog.pg_type t ON t.oid = a.atttypid
JOIN pg_catalog.pg_namespace tn ON tn.oid = t.typnamespace
WHERE c.oid = $1::pg_catalog.oid AND n.nspname = $2 AND c.relname = $3 AND c.relkind = 'r'
  AND a.attnum > 0 AND NOT a.attisdropped
  AND pg_catalog.has_schema_privilege(n.oid, 'USAGE')
  AND pg_catalog.has_column_privilege(c.oid, a.attnum, 'SELECT')
ORDER BY a.attnum LIMIT $4`,
    values: [
      relation.oid,
      relation.schema,
      relation.table,
      postgresSourceLimits.columns + 1,
    ],
  };
}

const wireOid = z
  .string()
  .regex(/^[1-9]\d{0,9}$/)
  .transform(Number)
  .pipe(postgresRelationSchema.shape.oid);
const relationWire = postgresRelationSchema.extend({ oid: wireOid });
export function decodePostgresRelations(
  input: z.input<typeof postgresCatalogScopeSchema>,
  raw: unknown,
  signal: AbortSignal
) {
  signal.throwIfAborted();
  const scope = postgresCatalogScopeSchema.parse(input);
  const rows = z
    .array(relationWire)
    .max(postgresSourceLimits.relations + 1)
    .parse(raw);
  if (
    rows.some(({ schema }) => !scope.schemas.includes(schema)) ||
    new Set(rows.map(({ oid }) => oid)).size !== rows.length ||
    new Set(rows.map(({ schema, table }) => JSON.stringify([schema, table])))
      .size !== rows.length
  )
    throw new Error(
      "Catalog result is outside the permitted scope or repeats a relation"
    );
  const items = rows.slice(0, postgresSourceLimits.relations);
  const last = items.at(-1);
  signal.throwIfAborted();
  return {
    items,
    after:
      rows.length > items.length && last
        ? { schema: last.schema, table: last.table }
        : null,
  };
}

const wireColumn = postgresCatalogColumnSchema
  .omit({ type: true })
  .extend({ typeOid: wireOid });
const nativeTypes = {
  "pg_catalog.text": [25, "text"],
  "pg_catalog.varchar": [1043, "text"],
  "pg_catalog.bpchar": [1042, "text"],
  "pg_catalog.int2": [21, "numeric"],
  "pg_catalog.int4": [23, "numeric"],
  "pg_catalog.int8": [20, "numeric"],
  "pg_catalog.numeric": [1700, "numeric"],
  "pg_catalog.bool": [16, "boolean"],
  "pg_catalog.date": [1082, "date"],
} as const;
export function postgresCatalogFingerprint(
  relation: z.input<typeof postgresRelationSchema>,
  columns: z.input<typeof postgresCatalogColumnSchema>[]
) {
  const value = postgresCatalogSchema
    .omit({ fingerprint: true })
    .parse({ relation, columns });
  return createHash("sha256")
    .update(
      JSON.stringify({
        ...value,
        columns: value.columns.toSorted((a, b) => a.ordinal - b.ordinal),
      })
    )
    .digest("hex");
}

export function decodePostgresCatalog(
  relation: z.input<typeof postgresRelationSchema>,
  raw: unknown,
  signal: AbortSignal
) {
  signal.throwIfAborted();
  const rows = z
    .array(wireColumn)
    .min(1)
    .max(postgresSourceLimits.columns)
    .parse(raw);
  const columns = rows.map((row) => ({
    name: row.name,
    ordinal: row.ordinal,
    typeOid: row.typeOid,
    typeModifier: row.typeModifier,
    nativeType: row.nativeType,
    nullable: row.nullable,
    primaryKey: row.primaryKey,
    type:
      Object.entries(nativeTypes).find(
        ([name, value]) => name === row.nativeType && value[0] === row.typeOid
      )?.[1][1] ?? null,
  }));
  const fingerprint = postgresCatalogFingerprint(relation, columns);
  signal.throwIfAborted();
  return postgresCatalogSchema.parse({ relation, columns, fingerprint });
}
