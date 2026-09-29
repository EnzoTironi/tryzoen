import { sql } from "drizzle-orm";
import {
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
    learnedMemoryInitialized: boolean("learned_memory_initialized")
      .notNull()
      .default(false),
    sessionMemoryInitialized: boolean("session_memory_initialized")
      .notNull()
      .default(false),
    eveScopeKey: text("eve_scope_key").unique(),
    pendingOperation: text("pending_operation"),
    pendingHash: text("pending_hash"),
  },
  (table) => [primaryKey({ columns: [table.workspaceId, table.userId] })]
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
