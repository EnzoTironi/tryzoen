import { escapeIdentifier } from "pg";
import { z } from "zod";
import {
  postgresCatalogSchema,
  postgresReadArgumentsSchema,
  postgresSourceLimits,
  publishedSourceBindingSchema,
  sourceBindingSchema,
  sourceNumericSchema,
  sourceTextSchema,
} from "@zoen/companion-ui/workspace-sources";
import { postgresCatalogFingerprint } from "./catalog";

/** Build only: metadata is not an access grant, admission or executed result. */
export function postgresReadQuery(
  published: z.input<typeof publishedSourceBindingSchema>,
  rawCatalog: z.input<typeof postgresCatalogSchema>,
  rawArguments: unknown,
  signal: AbortSignal
) {
  signal.throwIfAborted();
  const { binding } = publishedSourceBindingSchema.parse(published);
  const catalog = postgresCatalogSchema.parse(rawCatalog);
  if (
    catalog.fingerprint !==
      postgresCatalogFingerprint(catalog.relation, catalog.columns) ||
    catalog.fingerprint !== binding.schemaFingerprint ||
    JSON.stringify(catalog.relation) !== JSON.stringify(binding.relation) ||
    binding.columns.some(
      (column) =>
        !catalog.columns.some(
          (candidate) =>
            candidate.name === column.source &&
            candidate.type === column.type &&
            candidate.nullable === column.nullable
        )
    )
  )
    throw new Error("Source schema changed; review the binding before reading");
  const identity = binding.ontology.identity.map((id) => {
    const column = binding.columns.find((candidate) => candidate.id === id);
    if (!column) throw new Error("Source binding is invalid");
    return column.source;
  });
  const primary = catalog.columns.filter(({ primaryKey }) => primaryKey);
  if (
    primary.length !== binding.relation.primaryKeySize ||
    binding.relation.primaryKeySize !== identity.length ||
    primary.some(({ name }) => !identity.includes(name))
  )
    throw new Error(
      "Source identity must match the complete visible primary key"
    );
  const parameters = postgresReadArgumentsSchema.parse(rawArguments);
  if (
    Object.keys(parameters).length !== binding.filters.length ||
    binding.filters.some(
      ({ parameter }) => !Object.hasOwn(parameters, parameter)
    )
  )
    throw new Error("Arguments must match the published filters");
  const values: (string | boolean | null | number)[] = [];
  const predicates = binding.filters.map((filter) => {
    const column = binding.columns.find(({ id }) => id === filter.column);
    if (!column) throw new Error("Source binding is invalid");
    const value = parameters[filter.parameter];
    if (
      value === undefined ||
      (value === null && (!column.nullable || filter.operator !== "eq"))
    )
      throw new Error("Argument does not match the published type");
    if (value !== null) {
      const schema =
        column.type === "numeric"
          ? sourceNumericSchema
          : column.type === "date"
            ? z.iso.date()
            : column.type === "boolean"
              ? z.boolean()
              : z.string();
      schema.parse(value);
    }
    values.push(value);
    const operator =
      filter.operator === "eq"
        ? "IS NOT DISTINCT FROM"
        : filter.operator === "gte"
          ? ">="
          : "<";
    return `${escapeIdentifier(column.source)} ${operator} $${values.length}::pg_catalog.${column.type === "boolean" ? "bool" : column.type}`;
  });
  values.push(postgresSourceLimits.cellBytes);
  const cap = `$${values.length}`;
  const oversized = (source: string) =>
    `pg_catalog.octet_length(${escapeIdentifier(source)}::pg_catalog.text) > ${cap}`;
  const projection = binding.columns.map(
    ({ id, source }) =>
      `CASE WHEN ${oversized(source)} THEN NULL ELSE ${escapeIdentifier(source)}::pg_catalog.text END AS ${escapeIdentifier(id)}`
  );
  values.push(postgresSourceLimits.rows + 1);
  signal.throwIfAborted();
  return {
    text: `SELECT ${projection.join(", ")}, (${binding.columns.map(({ source }) => oversized(source)).join(" OR ")}) IS TRUE AS "_zoen_oversized"
FROM ${escapeIdentifier(binding.relation.schema)}.${escapeIdentifier(binding.relation.table)}${predicates.length ? ` WHERE ${predicates.join(" AND ")}` : ""}
ORDER BY ${identity.map((source) => escapeIdentifier(source)).join(", ")} LIMIT $${values.length}`,
    values,
  };
}

/** Decode an already-authorized row source. Network cancellation remains the caller's duty. */
export function decodePostgresReadRows(
  rawBinding: z.input<typeof sourceBindingSchema>,
  rows: Iterable<unknown>,
  signal: AbortSignal
) {
  signal.throwIfAborted();
  const binding = sourceBindingSchema.parse(rawBinding);
  const result: Record<string, string | boolean | null>[] = [];
  let bytes = 2;
  for (const raw of rows) {
    signal.throwIfAborted();
    if (result.length === postgresSourceLimits.rows)
      throw new Error("Source result exceeds its row bound");
    const row = z.record(z.string(), z.unknown()).parse(raw);
    const { _zoen_oversized: oversized } = row;
    if (oversized === true)
      throw new Error("Source cell exceeds its byte bound");
    if (
      oversized !== false ||
      Object.keys(row).length !== binding.columns.length + 1
    )
      throw new Error("Source result does not match the binding");
    const decoded: Record<string, string | boolean | null> = {};
    for (const column of binding.columns) {
      signal.throwIfAborted();
      const value = row[column.id];
      if (value === null && column.nullable) {
        decoded[column.id] = null;
        continue;
      }
      if (
        typeof value !== "string" ||
        !sourceTextSchema.safeParse(value).success
      )
        throw new Error(
          "Source result does not match the published type or byte bound"
        );
      if (column.type === "numeric") sourceNumericSchema.parse(value);
      if (column.type === "date") z.iso.date().parse(value);
      if (column.type === "boolean" && value !== "true" && value !== "false")
        throw new Error("Source result does not match the published boolean");
      decoded[column.id] = column.type === "boolean" ? value === "true" : value;
    }
    bytes +=
      Buffer.byteLength(JSON.stringify(decoded), "utf8") +
      (result.length ? 1 : 0);
    if (bytes > postgresSourceLimits.resultBytes)
      throw new Error("Source result exceeds its byte bound");
    result.push(decoded);
  }
  signal.throwIfAborted();
  return result;
}
