import { sql } from "drizzle-orm";
import {
  bigint,
  boolean,
  check,
  index,
  integer,
  jsonb,
  pgTable,
  primaryKey,
  text,
  timestamp,
  uuid,
} from "drizzle-orm/pg-core";
import { workspaces } from "./workspaces";

export const workspaceMemoryErasures = pgTable(
  "workspace_memory_erasure",
  {
    namespaceId: uuid("namespace_id").primaryKey(),
    ownerUserId: text("owner_user_id"),
    requestedAt: timestamp("requested_at", { withTimezone: true })
      .notNull()
      .defaultNow(),
    availableAt: timestamp("available_at", { withTimezone: true })
      .notNull()
      .defaultNow(),
    erasureFailures: integer("erasure_failures").notNull().default(0),
    lastFailedAt: timestamp("last_failed_at", { withTimezone: true }),
  },
  (table) => [
    index("workspace_memory_erasure_owner_idx").on(table.ownerUserId),
    index("workspace_memory_erasure_pending_idx").on(
      table.availableAt,
      table.requestedAt,
      table.namespaceId
    ),
    check(
      "workspace_memory_erasure_failures",
      sql`${table.erasureFailures} >= 0 AND (${table.erasureFailures} = 0) = (${table.lastFailedAt} IS NULL)`
    ),
  ]
);

export const workspaceMemoryNamespaces = pgTable(
  "workspace_memory_namespace",
  {
    workspaceId: text("workspace_id")
      .notNull()
      .references(() => workspaces.id, { onDelete: "cascade" }),
    userId: text("user_id").notNull(),
    namespaceId: uuid("namespace_id").notNull().defaultRandom().unique(),
    enabled: boolean("enabled").notNull().default(true),
    preferenceRevision: uuid("preference_revision").notNull().defaultRandom(),
    journalEventCount: bigint("journal_event_count", { mode: "number" })
      .notNull()
      .default(0),
    journalHighWater: bigint("journal_high_water", { mode: "number" }),
    eveScopeKey: text("eve_scope_key").unique(),
  },
  (table) => [
    primaryKey({ columns: [table.workspaceId, table.userId] }),
    check(
      "workspace_memory_namespace_journal_check",
      sql`
      ${table.journalEventCount} BETWEEN 0 AND 9007199254740991 AND
      ((${table.journalEventCount} = 0 AND ${table.journalHighWater} IS NULL) OR
       (${table.journalEventCount} > 0 AND ${table.journalHighWater} BETWEEN ${table.journalEventCount} AND 9007199254740991))`
    ),
  ]
);

export const workspaceMemoryRecalls = pgTable(
  "workspace_memory_recall",
  {
    namespaceId: uuid("namespace_id")
      .notNull()
      .references(() => workspaceMemoryNamespaces.namespaceId, {
        onDelete: "cascade",
      }),
    operationId: text("operation_id").notNull(),
    snapshot: jsonb("snapshot"),
    createdAt: timestamp("created_at", { withTimezone: true })
      .notNull()
      .defaultNow(),
  },
  (table) => [primaryKey({ columns: [table.namespaceId, table.operationId] })]
);
