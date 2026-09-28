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
  creatorReleaseEvidenceSchema,
} from "@zoen/companion-ui/creators";
import { workspaceMemberships } from "./workspaces";
import { creatorDrafts } from "./creator-drafts";

export const creatorReleases = pgTable(
  "creator_releases",
  {
    id: uuid("id").primaryKey(),
    workspaceId: text("workspace_id").notNull(),
    userId: text("user_id").notNull(),
    draftId: uuid("draft_id")
      .notNull()
      .references(() => creatorDrafts.id, { onDelete: "cascade" }),
    revision: uuid("revision").notNull(),
    evaluationRevision: uuid("evaluation_revision").notNull(),
    content: jsonb("content")
      .$type<z.infer<typeof creatorDraftContentSchema>>()
      .notNull(),
    evidence: jsonb("evidence")
      .$type<z.infer<typeof creatorReleaseEvidenceSchema>[]>()
      .notNull(),
    notes: text("notes").notNull(),
    createdAt: timestamp("created_at", { withTimezone: true, precision: 3 })
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
    index("creator_releases_owner_idx").on(
      table.workspaceId,
      table.userId,
      table.createdAt.desc()
    ),
    check(
      "creator_releases_payload_check",
      sql`jsonb_typeof(${table.content}) = 'object' AND octet_length(${table.content}::text) <= 65536
    AND jsonb_typeof(${table.evidence}) = 'array' AND jsonb_array_length(${table.evidence}) BETWEEN 1 AND 20
    AND octet_length(${table.evidence}::text) <= 2097152 AND length(${table.notes}) BETWEEN 1 AND 8000`
    ),
  ]
);
