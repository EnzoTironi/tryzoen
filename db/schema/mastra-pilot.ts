import {
  pgTable,
  text,
  timestamp,
  index,
  foreignKey,
  uniqueIndex,
  check,
} from "drizzle-orm/pg-core";
import { sql } from "drizzle-orm";
import { agentSessions } from "./sessions";

export const mastraPilotConversations = pgTable("mastra_pilot_conversation", {
  id: text("id")
    .primaryKey()
    .references(() => agentSessions.sessionId, { onDelete: "cascade" }),
  title: text("title").notNull(),
  createdAt: timestamp("created_at", { withTimezone: true })
    .notNull()
    .defaultNow(),
});
export const mastraPilotRuns = pgTable(
  "mastra_pilot_run",
  {
    id: text("id").primaryKey(),
    conversationId: text("conversation_id").notNull(),
    input: text("input").notNull(),
    status: text("status").notNull(),
    decision: text("decision"),
    createdAt: timestamp("created_at", { withTimezone: true })
      .notNull()
      .defaultNow(),
  },
  (table) => [
    foreignKey({
      columns: [table.conversationId],
      foreignColumns: [mastraPilotConversations.id],
    }).onDelete("cascade"),
    index("mastra_pilot_run_conversation_idx").on(
      table.conversationId,
      table.createdAt
    ),
    uniqueIndex("mastra_pilot_one_active_run")
      .on(table.conversationId)
      .where(sql`${table.status} IN ('running', 'suspended')`),
    check(
      "mastra_pilot_run_status",
      sql`${table.status} IN ('running','suspended','completed','rejected','cancelled','failed')`
    ),
    check(
      "mastra_pilot_run_decision",
      sql`${table.decision} IS NULL OR ${table.decision} IN ('approve','reject')`
    ),
  ]
);
