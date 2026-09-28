import { sql } from "drizzle-orm";
import {
  check,
  foreignKey,
  index,
  pgTable,
  text,
  timestamp,
  uniqueIndex,
  uuid,
} from "drizzle-orm/pg-core";
import { workspaceMemberships } from "./workspaces";

/** Transport ownership only; message content and relations remain in Matrix. */
export const matrixDirectRooms = pgTable(
  "matrix_direct_rooms",
  {
    id: uuid("id").primaryKey(),
    workspaceId: text("workspace_id").notNull(),
    firstUserId: text("first_user_id").notNull(),
    secondUserId: text("second_user_id").notNull(),
    roomId: text("room_id").notNull().unique(),
    serverName: text("server_name").notNull(),
    createdAt: timestamp("created_at", { withTimezone: true })
      .defaultNow()
      .notNull(),
  },
  (t) => [
    check(
      "matrix_direct_rooms_pair_order",
      sql`${t.firstUserId} < ${t.secondUserId}`
    ),
    uniqueIndex("matrix_direct_rooms_pair_idx").on(
      t.workspaceId,
      t.firstUserId,
      t.secondUserId
    ),
    index("matrix_direct_rooms_first_idx").on(
      t.workspaceId,
      t.firstUserId,
      t.id
    ),
    index("matrix_direct_rooms_second_idx").on(
      t.workspaceId,
      t.secondUserId,
      t.id
    ),
    foreignKey({
      name: "matrix_direct_rooms_first_member_fk",
      columns: [t.workspaceId, t.firstUserId],
      foreignColumns: [
        workspaceMemberships.workspaceId,
        workspaceMemberships.userId,
      ],
    }).onDelete("cascade"),
    foreignKey({
      name: "matrix_direct_rooms_second_member_fk",
      columns: [t.workspaceId, t.secondUserId],
      foreignColumns: [
        workspaceMemberships.workspaceId,
        workspaceMemberships.userId,
      ],
    }).onDelete("cascade"),
  ]
);
