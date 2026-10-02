import { sql } from "drizzle-orm";
import {
  bigserial,
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
import { workspaceMemoryNamespaces } from "./learned-memory";

/** Content is only a delivery outbox. After fsync, disk owns the source. */
export const memorySessionSources = pgTable(
  "memory_session_sources",
  {
    namespaceId: uuid("namespace_id")
      .notNull()
      .references(() => workspaceMemoryNamespaces.namespaceId, {
        onDelete: "cascade",
      }),
    eventId: text("event_id").notNull(),
    // Identity survives payload clearing, allowing exact per-session export.
    sessionId: text("session_id").notNull(),
    captureSequence: bigserial("capture_sequence", {
      mode: "number",
    }).notNull(),
    digest: text("digest").notNull(),
    payload: jsonb("payload"),
    capturedAt: timestamp("captured_at", { withTimezone: true })
      .defaultNow()
      .notNull(),
    storedAt: timestamp("stored_at", { withTimezone: true }),
    availableAt: timestamp("available_at", { withTimezone: true })
      .defaultNow()
      .notNull(),
    deliveryFailures: integer("delivery_failures").default(0).notNull(),
    lastFailedAt: timestamp("last_failed_at", { withTimezone: true }),
  },
  (table) => [
    primaryKey({ columns: [table.namespaceId, table.eventId] }),
    check(
      "memory_session_source_size",
      sql`octet_length(${table.payload}::text) <= 8388608`
    ),
    check(
      "memory_session_source_delivery",
      sql`(${table.payload} IS NULL) = (${table.storedAt} IS NOT NULL)`
    ),
    check(
      "memory_session_source_failures",
      sql`${table.deliveryFailures} >= 0 AND (${table.deliveryFailures} = 0) = (${table.lastFailedAt} IS NULL)`
    ),
    // Recovery checks every retained receipt, including delivered rows.
    index("memory_session_sources_capture_idx").on(table.captureSequence),
    index("memory_session_sources_session_idx").on(
      table.namespaceId,
      table.sessionId,
      table.captureSequence
    ),
    index("memory_session_sources_pending_idx")
      .on(table.availableAt, table.captureSequence)
      .where(sql`${table.storedAt} IS NULL`),
    index("memory_session_sources_owner_pending_idx")
      .on(table.namespaceId, table.captureSequence)
      .where(sql`${table.storedAt} IS NULL`),
  ]
);
