import {
  boolean,
  foreignKey,
  index,
  integer,
  jsonb,
  pgTable,
  primaryKey,
  text,
  timestamp,
  uniqueIndex,
  uuid,
} from "drizzle-orm/pg-core";
import type { z } from "zod";
import type { feedPostInputSchema } from "@zoen/companion-ui/feed";
import { workspaceMemberships } from "./workspaces";

export const personalFeedPosts = pgTable(
  "personal_feed_posts",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    workspaceId: text("workspace_id").notNull(),
    userId: text("user_id").notNull(),
    key: text("key").notNull(),
    content: jsonb("content").$type<z.infer<typeof feedPostInputSchema>>(),
    liked: boolean("liked").notNull().default(false),
    createdAt: timestamp("created_at", { withTimezone: true, precision: 3 })
      .notNull()
      .defaultNow(),
  },
  (table) => [
    foreignKey({
      columns: [table.workspaceId, table.userId],
      foreignColumns: [
        workspaceMemberships.workspaceId,
        workspaceMemberships.userId,
      ],
    }).onDelete("cascade"),
    uniqueIndex("personal_feed_topic_idx").on(
      table.workspaceId,
      table.userId,
      table.key
    ),
    index("personal_feed_page_idx").on(
      table.workspaceId,
      table.userId,
      table.createdAt.desc(),
      table.id.desc()
    ),
  ]
);

export const personalFeedInstructions = pgTable(
  "personal_feed_instructions",
  {
    workspaceId: text("workspace_id").notNull(),
    userId: text("user_id").notNull(),
    content: text("content").notNull(),
    revision: integer("revision").notNull(),
  },
  (table) => [
    primaryKey({ columns: [table.workspaceId, table.userId] }),
    foreignKey({
      columns: [table.workspaceId, table.userId],
      foreignColumns: [
        workspaceMemberships.workspaceId,
        workspaceMemberships.userId,
      ],
    }).onDelete("cascade"),
  ]
);
