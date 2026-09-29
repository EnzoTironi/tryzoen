import { z } from "zod";
import { GitRevisionSchema, knowledgePathSchema } from "../files-schema";

const key = z.string().regex(/^[a-z][a-z0-9_-]{0,63}$/);
const label = z.string().trim().min(1).max(120);
const value = z.union([
  z.string().max(2000),
  z.number(),
  z.boolean(),
  z.null(),
]);
export const OntologySourceSchema = z.strictObject({
  path: knowledgePathSchema,
  revision: GitRevisionSchema,
  excerpt: z.string().min(1).max(2000),
});
export const OntologySourceStateSchema = OntologySourceSchema.extend({
  status: z.enum(["passage-present", "passage-changed", "unavailable"]),
});
const sources = z
  .array(OntologySourceSchema)
  .max(10)
  .refine(
    (items) =>
      new Set(items.map((item) => JSON.stringify(item))).size === items.length,
    "Each citation must be unique"
  );
const validTime = z
  .strictObject({
    from: z.iso.date().nullable(),
    until: z.iso.date().nullable(),
  })
  .refine(
    (time) =>
      (time.from !== null || time.until !== null) &&
      (time.from === null || time.until === null || time.from < time.until),
    "A valid-time interval must be nonempty; until is exclusive"
  )
  .nullable();
export const OntologyClaimSchema = z
  .strictObject({ value, sources, validTime })
  .refine(
    (claim) => claim.validTime === null || claim.sources.length > 0,
    "World-valid dates require cited evidence; otherwise leave validTime null"
  );
const property = z.object({
  id: key,
  name: label,
  type: z.enum(["string", "number", "boolean", "date"]),
  required: z.boolean(),
});
export const OntologySchema = z.object({
  version: z.literal(1),
  types: z
    .array(
      z.object({
        id: key,
        name: label,
        properties: z.array(property).max(30),
      })
    )
    .max(30),
  relations: z
    .array(z.object({ id: key, name: label, from: key, to: key }))
    .max(50),
  entities: z
    .array(
      z.object({
        id: key,
        type: key,
        name: label,
        properties: z.record(key, OntologyClaimSchema),
        sources,
      })
    )
    .max(500),
  links: z
    .array(
      z
        .strictObject({ type: key, from: key, to: key, sources, validTime })
        .refine(
          (link) => link.validTime === null || link.sources.length > 0,
          "World-valid dates require cited evidence"
        )
    )
    .max(2000),
  actions: z
    .array(z.object({ id: key, name: label, entityType: key, property: key }))
    .max(30),
});

export const emptyOntology: z.output<typeof OntologySchema> = {
  version: 1,
  types: [
    {
      id: "project",
      name: "Projeto",
      properties: [
        { id: "status", name: "Status", type: "string", required: false },
      ],
    },
    {
      id: "task",
      name: "Tarefa",
      properties: [
        { id: "status", name: "Status", type: "string", required: false },
      ],
    },
    { id: "person", name: "Pessoa", properties: [] },
    { id: "document", name: "Documento", properties: [] },
  ],
  relations: [
    { id: "part_of", name: "Parte de", from: "task", to: "project" },
    { id: "owned_by", name: "Responsável", from: "project", to: "person" },
    { id: "documents", name: "Documenta", from: "document", to: "project" },
  ],
  entities: [],
  links: [],
  actions: [
    {
      id: "project_status",
      name: "Atualizar projeto",
      entityType: "project",
      property: "status",
    },
    {
      id: "task_status",
      name: "Atualizar tarefa",
      entityType: "task",
      property: "status",
    },
  ],
};
export const ontologyPath = "ontology/workspace.json";
export const OntologyReadSchema = z.strictObject({
  revision: GitRevisionSchema.optional(),
  validOn: z.iso.date().optional(),
});
export const OntologyActionSchema = z.object({
  entityId: key,
  actionId: key,
  ...OntologyClaimSchema.shape,
});

export const OntologyReadResultSchema = z.strictObject({
  graph: OntologySchema,
  revision: GitRevisionSchema.nullable(),
  validOn: z.iso.date().nullable(),
  sourceCheckedAtRevision: GitRevisionSchema.nullable(),
  sources: z.array(OntologySourceStateSchema).max(60),
  mayManage: z.boolean(),
});
