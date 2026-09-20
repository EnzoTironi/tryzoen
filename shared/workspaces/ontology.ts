import { z } from "zod";

const key = z.string().regex(/^[a-z][a-z0-9_-]{0,63}$/);
const label = z.string().trim().min(1).max(120);
const value = z.union([
  z.string().max(2000),
  z.number(),
  z.boolean(),
  z.null(),
]);
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
        properties: z.record(key, value),
        sources: z
          .array(
            z.object({
              path: z.string().regex(/^knowledge\/[a-zA-Z0-9_./-]+\.md$/),
              revision: z.string().regex(/^[a-f0-9]{40}$/),
            })
          )
          .max(10),
      })
    )
    .max(500),
  links: z.array(z.object({ type: key, from: key, to: key })).max(2000),
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
export const OntologyActionSchema = z.object({
  entityId: key,
  actionId: key,
  value,
});

export class OntologyInvalid extends Error {
  readonly _tag = "OntologyInvalid";
  declare readonly reason:
    | "duplicate"
    | "type"
    | "property"
    | "link"
    | "source"
    | "action";
  constructor(input: {
    readonly reason:
      | "duplicate"
      | "type"
      | "property"
      | "link"
      | "source"
      | "action";
  }) {
    super("OntologyInvalid");
    this.name = "OntologyInvalid";
    Object.assign(this, input);
  }
}
