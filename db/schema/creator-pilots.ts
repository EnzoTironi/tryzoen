import {
  check,
  foreignKey,
  index,
  pgTable,
  text,
  timestamp,
  uuid,
} from "drizzle-orm/pg-core";
import { sql } from "drizzle-orm";
import { creatorReleases } from "./creator-releases";
import { workspaceMemberships } from "./workspaces";

export const creatorPilots = pgTable(
  "creator_pilots",
  {
    id: uuid("id").primaryKey(),
    releaseId: uuid("release_id")
      .notNull()
      .references(() => creatorReleases.id, { onDelete: "cascade" }),
    workspaceId: text("workspace_id").notNull(),
    creatorUserId: text("creator_user_id").notNull(),
    recipientUserId: text("recipient_user_id").notNull(),
    status: text("status").notNull().default("pending"),
    feedback: text("feedback"),
    feedbackRevision: uuid("feedback_revision"),
    feedbackUpdatedAt: timestamp("feedback_updated_at", {
      withTimezone: true,
      precision: 3,
    }),
    createdAt: timestamp("created_at", { withTimezone: true, precision: 3 })
      .notNull()
      .defaultNow(),
  },
  (table) => [
    foreignKey({
      columns: [table.workspaceId, table.creatorUserId],
      foreignColumns: [
        workspaceMemberships.workspaceId,
        workspaceMemberships.userId,
      ],
    }).onDelete("cascade"),
    foreignKey({
      columns: [table.workspaceId, table.recipientUserId],
      foreignColumns: [
        workspaceMemberships.workspaceId,
        workspaceMemberships.userId,
      ],
    }).onDelete("cascade"),
    index("creator_pilots_release_idx").on(table.releaseId),
    index("creator_pilots_creator_idx").on(
      table.workspaceId,
      table.creatorUserId,
      table.createdAt.desc()
    ),
    index("creator_pilots_recipient_idx").on(
      table.workspaceId,
      table.recipientUserId,
      table.createdAt.desc()
    ),
    check(
      "creator_pilots_state_check",
      sql`${table.status} IN ('pending', 'active', 'declined', 'withdrawn') AND ${table.creatorUserId} <> ${table.recipientUserId}`
    ),
    check(
      "creator_pilots_feedback_check",
      sql`(${table.feedback} IS NULL AND ${table.feedbackRevision} IS NULL AND ${table.feedbackUpdatedAt} IS NULL) OR
        (${table.feedback} IS NOT NULL AND length(trim(${table.feedback})) BETWEEN 1 AND 16000
        AND ${table.feedbackRevision} IS NOT NULL AND ${table.feedbackUpdatedAt} IS NOT NULL
        AND ${table.status} IN ('active', 'withdrawn'))`
    ),
  ]
);
