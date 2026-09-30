import { z } from "zod";
import { GitRevisionSchema, sourceBindingPathSchema } from "./files-schema";
import { OntologySchema } from "./ontology/schema";
import { SemanticIdentifierSchema } from "./semantic/schema";

export const postgresSourceLimits = {
  schemas: 8,
  relations: 50,
  columns: 30,
  rows: 100,
  cellBytes: 4096,
  resultBytes: 65_536,
} as const;

export const sourceTextSchema = z
  .string()
  .max(postgresSourceLimits.cellBytes)
  .refine(
    (value) =>
      !value.includes("\0") &&
      !/[\uD800-\uDFFF]/u.test(value) &&
      new TextEncoder().encode(value).byteLength <=
        postgresSourceLimits.cellBytes,
    "Use well-formed text of at most 4096 UTF-8 bytes without NUL"
  );

// PostgreSQL names are byte-bounded; quoted names may contain spaces or quotes.
export const postgresIdentifierSchema = z
  .string()
  .min(1)
  .refine(
    (value) =>
      !value.includes("\0") &&
      !/[\uD800-\uDFFF]/u.test(value) &&
      new TextEncoder().encode(value).byteLength <= 63,
    "Use a well-formed PostgreSQL identifier of at most 63 UTF-8 bytes"
  );
const oid = z.number().int().min(1).max(4_294_967_295);
const fingerprint = z.string().regex(/^[a-f0-9]{64}$/);
const ontologyKey = OntologySchema.shape.types.element.shape.id;
const columnId = SemanticIdentifierSchema;
export const postgresValueTypeSchema = z.enum([
  "text",
  "decimal",
  "boolean",
  "date",
]);
export const postgresRelationSchema = z.strictObject({
  schema: postgresIdentifierSchema,
  table: postgresIdentifierSchema,
  oid,
  primaryKeySize: z.number().int().min(0).max(1600),
});
export const postgresCatalogColumnSchema = z.strictObject({
  name: postgresIdentifierSchema,
  ordinal: z.number().int().min(1).max(1600),
  typeOid: oid,
  typeModifier: z.number().int().min(-1).max(2_147_483_647),
  nativeType: z.string().min(1).max(127),
  type: postgresValueTypeSchema.nullable(),
  nullable: z.boolean(),
  primaryKey: z.boolean(),
});
export const postgresCatalogSchema = z.strictObject({
  relation: postgresRelationSchema,
  columns: z
    .array(postgresCatalogColumnSchema)
    .min(1)
    .max(postgresSourceLimits.columns)
    .refine(
      (columns) =>
        new Set(columns.map(({ name }) => name)).size === columns.length &&
        new Set(columns.map(({ ordinal }) => ordinal)).size === columns.length,
      "Catalog columns must have unique names and ordinals"
    ),
  fingerprint,
});
export const postgresCatalogScopeSchema = z.strictObject({
  schemas: z
    .array(postgresIdentifierSchema)
    .min(1)
    .max(postgresSourceLimits.schemas)
    .refine((schemas) => new Set(schemas).size === schemas.length),
  after: z
    .strictObject({
      schema: postgresIdentifierSchema,
      table: postgresIdentifierSchema,
    })
    .optional(),
});

/** Authored mappings describe meaning. Repository/connection authority grants access. */
export const sourceBindingSchema = z
  .strictObject({
    version: z.literal(1),
    id: z.uuid(),
    kind: z.literal("postgres"),
    title: z.string().trim().min(1).max(120),
    connection: z.strictObject({ id: z.uuid(), revision: z.uuid() }),
    relation: postgresRelationSchema,
    schemaFingerprint: fingerprint,
    columns: z
      .array(
        z.strictObject({
          id: columnId,
          source: postgresIdentifierSchema,
          type: postgresValueTypeSchema,
          nullable: z.boolean(),
        })
      )
      .min(1)
      .max(postgresSourceLimits.columns),
    ontology: z.strictObject({
      entityType: ontologyKey,
      identity: z.array(columnId).min(1).max(3),
      properties: z.record(ontologyKey, columnId),
      relations: z
        .array(
          z.strictObject({
            relation: ontologyKey,
            columns: z.array(columnId).min(1).max(3),
            targetBindingId: z.uuid(),
            targetColumns: z.array(columnId).min(1).max(3),
          })
        )
        .max(6),
    }),
    filters: z
      .array(
        z.strictObject({
          column: columnId,
          parameter: SemanticIdentifierSchema,
          operator: z.enum(["eq", "gte", "lt"]),
        })
      )
      .max(6),
    freshness: z.strictObject({
      refresh: z.literal("on_read"),
      maxAgeSeconds: z.number().int().min(1).max(604_800).nullable(),
      upstream: z.literal("unknown"),
    }),
  })
  .superRefine((binding, ctx) => {
    const ids = new Set(binding.columns.map(({ id }) => id));
    const sources = new Set(binding.columns.map(({ source }) => source));
    const references = [
      ...binding.ontology.identity,
      ...Object.values(binding.ontology.properties),
      ...binding.ontology.relations.flatMap(({ columns }) => columns),
      ...binding.filters.map(({ column }) => column),
    ];
    if (
      ids.size !== binding.columns.length ||
      sources.size !== binding.columns.length ||
      references.some((id) => !ids.has(id)) ||
      new Set(binding.ontology.identity).size !==
        binding.ontology.identity.length ||
      Object.keys(binding.ontology.properties).length > 30 ||
      new Set(binding.filters.map(({ parameter }) => parameter)).size !==
        binding.filters.length ||
      binding.ontology.identity.some(
        (id) => binding.columns.find((column) => column.id === id)?.nullable
      ) ||
      binding.ontology.relations.some(
        (relation) =>
          relation.columns.length !== relation.targetColumns.length ||
          new Set(relation.columns).size !== relation.columns.length ||
          new Set(relation.targetColumns).size !== relation.targetColumns.length
      ) ||
      binding.filters.some(
        (filter) =>
          filter.operator !== "eq" &&
          !["decimal", "date"].includes(
            binding.columns.find(({ id }) => id === filter.column)?.type ?? ""
          )
      )
    )
      ctx.addIssue({
        code: "custom",
        message:
          "Mappings, identity and filters must reference unique declared columns",
      });
  });

// A file cannot contain its own future Git commit hash; the read envelope pins it.
export const publishedSourceBindingSchema = z.strictObject({
  path: sourceBindingPathSchema,
  revision: GitRevisionSchema,
  binding: sourceBindingSchema,
});
export const postgresReadArgumentsSchema = z
  .record(
    SemanticIdentifierSchema,
    z.union([sourceTextSchema, z.boolean(), z.null()])
  )
  .refine((parameters) => Object.keys(parameters).length <= 6);
