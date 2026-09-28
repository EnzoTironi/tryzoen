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
import type { creatorSourceSnapshotSchema } from "../../server/creators/sources/schema";
import { workspaceMemberships } from "./workspaces";
import { creatorDrafts } from "./creator-drafts";

export const creatorSources = pgTable(
  "creator_sources",
  {
    id: uuid("id").primaryKey(),
    workspaceId: text("workspace_id").notNull(),
    userId: text("user_id").notNull(),
    draftId: uuid("draft_id").notNull(),
    revision: uuid("revision").defaultRandom().notNull(),
    snapshot: jsonb("snapshot")
      .$type<z.infer<typeof creatorSourceSnapshotSchema>>()
      .notNull(),
    status: text("status").default("acquired").notNull(),
    rights: text("rights"),
    acquiredAt: timestamp("acquired_at", { withTimezone: true, precision: 3 })
      .defaultNow()
      .notNull(),
    reviewedAt: timestamp("reviewed_at", { withTimezone: true, precision: 3 }),
    withdrawnAt: timestamp("withdrawn_at", {
      withTimezone: true,
      precision: 3,
    }),
  },
  (table) => [
    foreignKey({
      name: "creator_sources_draft_id_fkey",
      columns: [table.draftId],
      foreignColumns: [creatorDrafts.id],
    }).onDelete("cascade"),
    foreignKey({
      name: "creator_sources_membership_fk",
      columns: [table.workspaceId, table.userId],
      foreignColumns: [
        workspaceMemberships.workspaceId,
        workspaceMemberships.userId,
      ],
    }).onDelete("cascade"),
    index("creator_sources_owner_idx").on(
      table.workspaceId,
      table.userId,
      table.draftId
    ),
    check(
      "creator_sources_snapshot_check",
      sql`jsonb_typeof(${table.snapshot}) = 'object' AND octet_length(${table.snapshot}::text) <= 131072`
    ),
    check(
      "creator_sources_state_check",
      sql`${table.status} IN ('acquired','reviewed','withdrawn') AND (${table.rights} IS NULL OR ${table.rights} IN ('original','permission','public-domain')) AND (${table.status} != 'reviewed' OR (${table.rights} IS NOT NULL AND ${table.reviewedAt} IS NOT NULL)) AND (${table.status} != 'withdrawn' OR ${table.withdrawnAt} IS NOT NULL)`
    ),
  ]
);
