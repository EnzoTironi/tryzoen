import {
  bigint,
  boolean,
  index,
  pgTable,
  primaryKey,
  text,
  timestamp,
} from "drizzle-orm/pg-core";

/** Disposable activity index only. Message bodies and read receipts stay in Matrix. */
export const matrixRoomActivity = pgTable(
  "matrix_room_activity",
  {
    serverName: text("server_name").notNull(),
    roomId: text("room_id").notNull(),
    latestEdited: boolean("latest_edited").notNull().default(false),
    latestEventId: text("latest_event_id"),
    latestAt: bigint("latest_at", { mode: "number" }),
    reconciledAt: timestamp("reconciled_at", { withTimezone: true }),
    reconcileCursor: text("reconcile_cursor"),
    reconcileAttemptedAt: timestamp("reconcile_attempted_at", {
      withTimezone: true,
    }),
  },
  (table) => [
    primaryKey({ columns: [table.serverName, table.roomId] }),
    index("matrix_room_activity_order_idx").on(
      table.serverName,
      table.latestAt.desc(),
      table.roomId
    ),
  ]
);
