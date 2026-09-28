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
import type { creatorDraftContentSchema } from "@zoen/companion-ui/creators";
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
    createdAt: timestamp("created_at", { withTimezone: true, precision: 3 })
      .notNull()
      .defaultNow(),
    expiresAt: timestamp("expires_at", { withTimezone: true, precision: 3 })
      .notNull()
      .default(sql`now() + interval '5 minutes'`),
  },
  (table) => [
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
  ]
);
