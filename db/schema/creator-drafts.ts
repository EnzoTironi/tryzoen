import {
  check,
  foreignKey,
  index,
  jsonb,
  pgTable,
  text,
  timestamp,
  uuid,
} from "drizzle-orm/pg-core";
import { sql } from "drizzle-orm";
import type { z } from "zod";
import type {
  creatorDraftContentSchema,
  creatorEvaluationCasesSchema,
} from "@zoen/companion-ui/creators";
import { workspaceMemberships } from "./workspaces";

export const creatorDrafts = pgTable(
  "creator_drafts",
  {
    id: uuid("id").primaryKey(),
    workspaceId: text("workspace_id").notNull(),
    userId: text("user_id").notNull(),
    revision: uuid("revision").defaultRandom().notNull(),
    content: jsonb("content")
      .$type<z.infer<typeof creatorDraftContentSchema>>()
      .notNull(),
    evaluationCases:
      jsonb("evaluation_cases").$type<
        z.infer<typeof creatorEvaluationCasesSchema>
      >(),
    evaluationRevision: uuid("evaluation_revision"),
    evaluationUpdatedAt: timestamp("evaluation_updated_at", {
      withTimezone: true,
      precision: 3,
    }),
    archivedAt: timestamp("archived_at", { withTimezone: true, precision: 3 }),
    updatedAt: timestamp("updated_at", { withTimezone: true, precision: 3 })
      .defaultNow()
      .notNull(),
  },
  (table) => [
    foreignKey({
      columns: [table.workspaceId, table.userId],
      foreignColumns: [
        workspaceMemberships.workspaceId,
        workspaceMemberships.userId,
      ],
    }).onDelete("cascade"),
    index("creator_drafts_owner_idx").on(
      table.workspaceId,
      table.userId,
      table.updatedAt.desc(),
      table.id.desc()
    ),
    check(
      "creator_drafts_evaluation_check",
      sql`
      (${table.evaluationCases} IS NULL AND ${table.evaluationRevision} IS NULL AND ${table.evaluationUpdatedAt} IS NULL)
      OR (${table.evaluationCases} IS NOT NULL AND ${table.evaluationRevision} IS NOT NULL AND ${table.evaluationUpdatedAt} IS NOT NULL
      AND jsonb_typeof(${table.evaluationCases}) = 'array' AND jsonb_array_length(${table.evaluationCases}) <= 20
      AND octet_length(${table.evaluationCases}::text) <= 1048576)`
    ),
    check(
      "creator_drafts_content_check",
      sql`jsonb_typeof(${table.content}) = 'object' AND octet_length(${table.content}::text) <= 4194304`
    ),
  ]
);
