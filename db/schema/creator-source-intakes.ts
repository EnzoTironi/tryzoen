import {
  pgTable,
  uuid,
  text,
  timestamp,
  foreignKey,
  index,
  check,
  uniqueIndex,
} from "drizzle-orm/pg-core";
import { sql } from "drizzle-orm";
import { creatorDrafts } from "./creator-drafts";
import { creatorSources } from "./creator-sources";
import { workspaceMemberships } from "./workspaces";
export const creatorSourceIntakes = pgTable(
  "creator_source_intakes",
  {
    id: uuid("id").primaryKey(),
    workspaceId: text("workspace_id").notNull(),
    userId: text("user_id").notNull(),
    draftId: uuid("draft_id")
      .notNull()
      .references(() => creatorDrafts.id, { onDelete: "cascade" }),
    draftRevision: uuid("draft_revision").notNull(),
    sessionId: text("session_id").notNull(),
    armedTurnId: text("armed_turn_id").notNull(),
    title: text("title").notNull(),
    status: text("status").notNull().default("waiting"),
    sourceId: uuid("source_id").references(() => creatorSources.id, {
      onDelete: "cascade",
    }),
    failure: text("failure"),
    createdAt: timestamp("created_at", { withTimezone: true, precision: 3 })
      .notNull()
      .defaultNow(),
    expiresAt: timestamp("expires_at", { withTimezone: true, precision: 3 })
      .notNull()
      .default(sql`now()+interval '15 minutes'`),
  },
  (t) => [
    foreignKey({
      columns: [t.workspaceId, t.userId],
      foreignColumns: [
        workspaceMemberships.workspaceId,
        workspaceMemberships.userId,
      ],
    }).onDelete("cascade"),
    index("creator_source_intakes_owner_idx").on(
      t.workspaceId,
      t.userId,
      t.createdAt
    ),
    uniqueIndex("creator_source_intakes_waiting_idx")
      .on(t.workspaceId, t.userId, t.sessionId)
      .where(sql`${t.status}='waiting'`),
    check(
      "creator_source_intakes_state_check",
      sql`${t.status} IN ('waiting','acquired','cancelled','expired','rejected') AND (${t.status}='acquired')=(${t.sourceId} IS NOT NULL) AND (${t.status}='rejected')=(${t.failure} IS NOT NULL) AND length(${t.title}) BETWEEN 1 AND 120 AND length(${t.sessionId}) BETWEEN 1 AND 200 AND (${t.failure} IS NULL OR length(${t.failure}) <= 300) AND ${t.expiresAt}>${t.createdAt}`
    ),
  ]
);
