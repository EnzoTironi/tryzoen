import {
  check,
  foreignKey,
  index,
  jsonb,
  pgTable,
  text,
  timestamp,
  uuid,
  uniqueIndex,
} from "drizzle-orm/pg-core";
import { sql } from "drizzle-orm";
import type { z } from "zod";
import type {
  creatorDraftContentSchema,
  creatorPreviewReviewContentSchema,
  creatorPreviewModelSchema,
} from "@zoen/companion-ui/creators";
import { workspaceMemberships } from "./workspaces";
import { creatorDrafts } from "./creator-drafts";

export const creatorPreviews = pgTable(
  "creator_previews",
  {
    id: uuid("id").primaryKey(),
    workspaceId: text("workspace_id").notNull(),
    userId: text("user_id").notNull(),
    draftId: uuid("draft_id")
      .notNull()
      .references(() => creatorDrafts.id, { onDelete: "cascade" }),
    revision: uuid("revision").notNull(),
    snapshot: jsonb("snapshot")
      .$type<z.infer<typeof creatorDraftContentSchema>>()
      .notNull(),
    question: text("question").notNull(),
    status: text("status").notNull().default("pending"),
    invocation: text("invocation"),
    response: text("response"),
    review:
      jsonb("review").$type<
        z.infer<typeof creatorPreviewReviewContentSchema>
      >(),
    reviewRevision: uuid("review_revision"),
    reviewedAt: timestamp("reviewed_at", { withTimezone: true, precision: 3 }),
    models: jsonb("models")
      .$type<z.infer<typeof creatorPreviewModelSchema>[]>()
      .notNull()
      .default([]),
    startedAt: timestamp("started_at", { withTimezone: true, precision: 3 }),
    finishedAt: timestamp("finished_at", { withTimezone: true, precision: 3 }),
    sourceSessionId: text("source_session_id"),
    sourceTurnId: text("source_turn_id"),
    createdAt: timestamp("created_at", { withTimezone: true, precision: 3 })
      .notNull()
      .defaultNow(),
    expiresAt: timestamp("expires_at", { withTimezone: true, precision: 3 })
      .notNull()
      .default(sql`now() + interval '5 minutes'`),
  },
  (table) => [
    uniqueIndex("creator_previews_source_idx").on(
      table.sourceSessionId,
      table.sourceTurnId
    ),
    check(
      "creator_previews_source_check",
      sql`(${table.sourceSessionId} IS NULL) = (${table.sourceTurnId} IS NULL)`
    ),
    foreignKey({
      columns: [table.workspaceId, table.userId],
      foreignColumns: [
        workspaceMemberships.workspaceId,
        workspaceMemberships.userId,
      ],
    }).onDelete("cascade"),
    index("creator_previews_owner_idx").on(
      table.workspaceId,
      table.userId,
      table.createdAt.desc()
    ),
    check(
      "creator_previews_payload_check",
      sql`jsonb_typeof(${table.snapshot}) = 'object' AND octet_length(${table.snapshot}::text) <= 65536 AND length(${table.question}) BETWEEN 1 AND 4000`
    ),
    check(
      "creator_previews_state_check",
      sql`${table.status} IN ('pending', 'running', 'completed', 'failed') AND ((${table.status} = 'completed') = (${table.response} IS NOT NULL)) AND length(${table.response}) <= 32000 AND (${table.status} = 'pending' OR ${table.invocation} IS NOT NULL)`
    ),
    check(
      "creator_previews_review_check",
      sql`(${table.review} IS NULL AND ${table.reviewRevision} IS NULL AND ${table.reviewedAt} IS NULL)
        OR (${table.review} IS NOT NULL AND ${table.reviewRevision} IS NOT NULL AND ${table.reviewedAt} IS NOT NULL
        AND ${table.status} = 'completed' AND jsonb_typeof(${table.review}) = 'object'
        AND octet_length(${table.review}::text) <= 65536
        AND coalesce(jsonb_typeof(${table.review}->'criteria') = 'string' AND length(${table.review}->>'criteria') BETWEEN 1 AND 4000, false)
        AND coalesce(jsonb_typeof(${table.review}->'notes') = 'string' AND length(${table.review}->>'notes') BETWEEN 1 AND 8000, false)
        AND coalesce(${table.review}->>'verdict' IN ('useful', 'needs-revision', 'unsafe-or-unsupported'), false))`
    ),
    check(
      "creator_previews_execution_check",
      sql`jsonb_typeof(${table.models}) = 'array' AND jsonb_array_length(${table.models}) <= 8
        AND octet_length(${table.models}::text) <= 16384
        AND (${table.finishedAt} IS NULL OR (${table.startedAt} IS NOT NULL AND ${table.finishedAt} >= ${table.startedAt}))`
    ),
  ]
);
