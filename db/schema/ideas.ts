import {
  foreignKey,
  index,
  jsonb,
  pgTable,
  text,
  timestamp,
  uniqueIndex,
  uuid,
} from "drizzle-orm/pg-core";
import type { z } from "zod";
import type {
  ideaProposalSchema,
  ideaStatusSchema,
  ideaFeedbackSchema,
} from "@zoen/companion-ui/ideas";
import { workspaceMemberships } from "./workspaces";

export const personalIdeas = pgTable(
  "personal_ideas",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    workspaceId: text("workspace_id").notNull(),
    userId: text("user_id").notNull(),
    key: text("key").notNull(),
    proposal: jsonb("proposal")
      .$type<z.infer<typeof ideaProposalSchema>>()
      .notNull(),
    status: text("status")
      .$type<z.infer<typeof ideaStatusSchema>>()
      .notNull()
      .default("suggested"),
    feedback: text("feedback").$type<z.infer<typeof ideaFeedbackSchema>>(),
    sessionId: text("session_id"),
    statusEventId: text("status_event_id"),
    startAuthSessionId: text("start_auth_session_id"),
    createdAt: timestamp("created_at", { withTimezone: true, precision: 3 })
      .notNull()
      .defaultNow(),
    statusAt: timestamp("status_at", { withTimezone: true, precision: 3 })
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
    uniqueIndex("personal_ideas_topic_idx").on(
      table.workspaceId,
      table.userId,
      table.key
    ),
    index("personal_ideas_page_idx").on(
      table.workspaceId,
      table.userId,
      table.createdAt.desc(),
      table.id.desc()
    ),
    index("personal_ideas_session_idx").on(table.sessionId),
  ]
);
