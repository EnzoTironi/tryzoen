import {
  boolean,
  foreignKey,
  pgTable,
  primaryKey,
  text,
} from "drizzle-orm/pg-core";
import { workspaceMemberships } from "./workspaces";

export const goalPreferences = pgTable(
  "goal_preferences",
  {
    workspaceId: text("workspace_id").notNull(),
    userId: text("user_id").notNull(),
    showSubtitles: boolean("show_subtitles").notNull().default(true),
    sortAutomatically: boolean("sort_automatically").notNull().default(true),
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
