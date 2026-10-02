import type { z } from "zod";
import type { OntologySchema } from "@zoen/companion-ui/ontology";
import { sourceBindingSchema } from "@zoen/companion-ui/workspace-sources";

// Original fictional studio data. No vendor files, services or credentials.
const studioProjectsRelation = {
  schema: "studio",
  table: "projects",
  oid: 42001,
  primaryKeySize: 1,
};
export function studioProjectBinding(schemaFingerprint: string) {
  return sourceBindingSchema.parse({
    version: 1,
    id: "db1689bd-c9a9-4bde-8d7a-22fd741129de",
    kind: "postgres",
    title: "Studio projects and their approved budgets",
    connection: {
      id: "af10e4e9-7cfe-4b64-9c23-5b6e15971158",
      revision: "5a96a96c-0f80-4e8b-a89b-d0224a29de2b",
    },
    relation: studioProjectsRelation,
    schemaFingerprint,
    columns: [
      { id: "id", source: "id", type: "decimal", nullable: false },
      { id: "title", source: "title", type: "text", nullable: false },
      { id: "budget", source: "budget", type: "decimal", nullable: false },
      { id: "launch_day", source: "launch_day", type: "date", nullable: true },
      { id: "active", source: "active", type: "boolean", nullable: false },
    ],
    ontology: {
      entityType: "project",
      identity: ["id"],
      properties: {
        name: "title",
        planned_budget: "budget",
        launch_day: "launch_day",
        active: "active",
      },
      relations: [],
    },
    filters: [{ column: "budget", parameter: "minimum", operator: "gte" }],
    freshness: { refresh: "on_read", maxAgeSeconds: null, upstream: "unknown" },
  });
}

// Exact wire decimals map to string properties until ontology arithmetic has a
// reviewed decimal type. This file definition grants no connection authority.
export const studioOntology: z.output<typeof OntologySchema> = {
  version: 1 as const,
  types: [
    {
      id: "project",
      name: "Studio project",
      properties: [
        { id: "name", name: "Name", type: "string" as const, required: true },
        {
          id: "planned_budget",
          name: "Exact budget text",
          type: "string" as const,
          required: true,
        },
        {
          id: "launch_day",
          name: "Launch day",
          type: "date" as const,
          required: false,
        },
        {
          id: "active",
          name: "Active",
          type: "boolean" as const,
          required: true,
        },
      ],
    },
  ],
  relations: [
    {
      id: "related_to",
      name: "Related project",
      from: "project",
      to: "project",
    },
  ],
  entities: [],
  links: [],
  actions: [],
};
