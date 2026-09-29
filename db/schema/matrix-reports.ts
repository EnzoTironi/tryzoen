import { sql } from "drizzle-orm";
import {
  check,
  index,
  pgTable,
  primaryKey,
  text,
  timestamp,
} from "drizzle-orm/pg-core";
import { matrixIdentities } from "./matrix";

/** Delivery receipts only. Report reasons and evidence belong to native Matrix moderation. */
export const matrixMessageReports = pgTable(
  "matrix_message_reports",
  {
    userId: text("user_id")
      .notNull()
      .references(() => matrixIdentities.userId, { onDelete: "cascade" }),
    serverName: text("server_name").notNull(),
    roomId: text("room_id").notNull(),
    eventId: text("event_id").notNull(),
    status: text("status").notNull(),
    createdAt: timestamp("created_at", { withTimezone: true })
      .defaultNow()
      .notNull(),
  },
  (t) => [
    primaryKey({ columns: [t.userId, t.serverName, t.eventId] }),
    check(
      "matrix_message_reports_status_check",
      sql`${t.status} IN ('submitted', 'uncertain')`
    ),
    index("matrix_message_reports_quota_idx").on(t.userId, t.createdAt),
  ]
);
