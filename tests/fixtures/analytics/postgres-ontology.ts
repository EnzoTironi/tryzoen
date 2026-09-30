import { sourceBindingSchema } from "@zoen/companion-ui/workspace-sources";

// Original fictional studio data. No vendor files, services or credentials.
export const studioProjectsRelation = {
  schema: "studio",
  table: "projects",
  oid: 42001,
  primaryKeySize: 1,
};
export const studioProjectColumns = [
  {
    name: "id",
    ordinal: 1,
    typeModifier: -1,
    typeOid: "23",
    nativeType: "pg_catalog.int4",
    nullable: false,
    primaryKey: true,
  },
  {
    name: "title",
    ordinal: 2,
    typeModifier: -1,
    typeOid: "25",
    nativeType: "pg_catalog.text",
    nullable: false,
    primaryKey: false,
  },
  {
    name: "budget",
    ordinal: 3,
    typeModifier: -1,
    typeOid: "1700",
    nativeType: "pg_catalog.numeric",
    nullable: false,
    primaryKey: false,
  },
  {
    name: "launch_day",
    ordinal: 4,
    typeModifier: -1,
    typeOid: "1082",
    nativeType: "pg_catalog.date",
    nullable: true,
    primaryKey: false,
  },
  {
    name: "active",
    ordinal: 5,
    typeModifier: -1,
    typeOid: "16",
    nativeType: "pg_catalog.bool",
    nullable: false,
    primaryKey: false,
  },
];
export const studioProjects = [
  {
    id: "1",
    title: "Atlas",
    budget: "100.00",
    launch_day: "2026-09-30",
    active: "true",
    _zoen_oversized: false,
  },
  {
    id: "2",
    title: "Birch",
    budget: "200.00",
    launch_day: null,
    active: "false",
    _zoen_oversized: false,
  },
  {
    id: "3",
    title: "Cedar",
    budget: "300.00",
    launch_day: null,
    active: "true",
    _zoen_oversized: false,
  },
];
export const studioExpenses = [
  { id: "expense_1", projectId: "1", cents: 1010 },
  { id: "expense_2", projectId: "1", cents: 1990 },
  { id: "expense_3", projectId: "2", cents: 500 },
];
// Future semantic qualification: keep the empty project and avoid budget fan-out.
export const studioKnownAnswers = [
  {
    projectId: "1",
    budgetCents: 10000,
    spentCents: 3000,
    remainingCents: 7000,
  },
  {
    projectId: "2",
    budgetCents: 20000,
    spentCents: 500,
    remainingCents: 19500,
  },
  { projectId: "3", budgetCents: 30000, spentCents: 0, remainingCents: 30000 },
];
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
      { id: "id", source: "id", type: "numeric", nullable: false },
      { id: "title", source: "title", type: "text", nullable: false },
      { id: "budget", source: "budget", type: "numeric", nullable: false },
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
