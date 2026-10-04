import { sql } from "drizzle-orm";
import {
  check,
  index,
  integer,
  pgTable,
  pgSchema,
  primaryKey,
  text,
  timestamp,
  uuid,
} from "drizzle-orm/pg-core";
import { maximumBrowserImageBytes } from "@shared/browser/artifact";

/** Coordinates survive deletion of their domain owner so cleanup can retry an
 * unknown upload or DELETE. A restored database never restores erasure consent. */
export const payloadObjects = pgTable(
  "payload_object",
  {
    id: uuid("id").defaultRandom().primaryKey(),
    workspaceId: text("workspace_id").notNull(),
    ownerGeneration: uuid("owner_generation").notNull(),
    ownerUserId: text("owner_user_id"),
    kind: text("kind").notNull(),
    sha256: text("sha256").notNull(),
    byteLength: integer("byte_length").notNull(),
    state: text("state").notNull().default("pending"),
    writeUntil: timestamp("write_until", { withTimezone: true }).notNull(),
    createdAt: timestamp("created_at", { withTimezone: true })
      .notNull()
      .default(sql`clock_timestamp()`),
    adoptedAt: timestamp("adopted_at", { withTimezone: true }),
    verifiedAt: timestamp("verified_at", { withTimezone: true }),
    retiredAt: timestamp("retired_at", { withTimezone: true }),
    deletedAt: timestamp("deleted_at", { withTimezone: true }),
    availableAt: timestamp("available_at", { withTimezone: true })
      .notNull()
      .default(sql`clock_timestamp()`),
  },
  (table) => [
    check(
      "payload_object_scope_check",
      sql`length(${table.workspaceId}) BETWEEN 1 AND 200
        AND ((${table.kind} IN ('workspace-bundle', 'workspace-source') AND ${table.ownerUserId} IS NULL)
          OR (${table.kind} IN ('private-memory-bundle', 'private-artifact', 'browser-image') AND ${table.ownerUserId} IS NOT NULL AND length(${table.ownerUserId}) BETWEEN 1 AND 200))`
    ),
    check(
      "payload_object_integrity_check",
      sql`${table.sha256} ~ '^[a-f0-9]{64}$'
        AND ((${table.kind} = 'workspace-bundle' AND ${table.byteLength} BETWEEN 0 AND 25165824)
          OR (${table.kind} = 'workspace-source' AND ${table.byteLength} BETWEEN 0 AND 10485760)
          OR (${table.kind} = 'private-memory-bundle' AND ${table.byteLength} BETWEEN 1 AND 25165824)
          OR (${table.kind} = 'private-artifact' AND ${table.byteLength} BETWEEN 1 AND 10485760)
          OR (${table.kind} = 'browser-image' AND ${table.byteLength} BETWEEN 1 AND ${maximumBrowserImageBytes}))`
    ),
    check(
      "payload_object_state_check",
      sql`(${table.state} = 'pending' AND ${table.adoptedAt} IS NULL AND ${table.retiredAt} IS NULL AND ${table.deletedAt} IS NULL)
        OR (${table.state} = 'adopted' AND ${table.verifiedAt} IS NOT NULL AND ${table.adoptedAt} IS NOT NULL AND ${table.deletedAt} IS NULL)
        OR (${table.state} = 'deleting' AND ${table.deletedAt} IS NULL)
        OR (${table.state} = 'deleted' AND ${table.deletedAt} IS NOT NULL)`
    ),
    check(
      "payload_object_write_window_check",
      sql`${table.writeUntil} > ${table.createdAt} AND ${table.writeUntil} <= ${table.createdAt} + interval '2 minutes'`
    ),
    check(
      "payload_object_verified_time_check",
      sql`${table.verifiedAt} IS NULL OR ${table.verifiedAt} BETWEEN ${table.createdAt} AND ${table.writeUntil}`
    ),
    index("payload_object_collection_idx").on(
      table.state,
      table.writeUntil,
      table.retiredAt,
      table.id
    ),
    index("payload_object_owner_idx").on(
      table.workspaceId,
      table.kind,
      table.ownerGeneration
    ),
    index("payload_object_private_owner_idx").on(table.ownerUserId),
    index("payload_object_available_idx").on(table.availableAt, table.id),
  ]
);

export const payloadMaintenance = pgSchema("zoen_maintenance");

/** Privacy erasures retain their exact owner and resume cursor after completion
 * so an upload with a lost acknowledgement is swept again. */
export const payloadErasures = pgTable(
  "payload_erasure",
  {
    ownerUserId: text("owner_user_id").notNull(),
    scopeKey: text("scope_key").notNull(),
    personalWorkspaceId: text("personal_workspace_id"),
    phase: text("phase").notNull().default("private"),
    continuationToken: text("continuation_token"),
    requestedAt: timestamp("requested_at", { withTimezone: true })
      .notNull()
      .default(sql`clock_timestamp()`),
    availableAt: timestamp("available_at", { withTimezone: true })
      .notNull()
      .default(sql`clock_timestamp()`),
    completedAt: timestamp("completed_at", { withTimezone: true }),
  },
  (table) => [
    primaryKey({ columns: [table.ownerUserId, table.scopeKey] }),
    check(
      "payload_erasure_owner_check",
      sql`length(${table.ownerUserId}) BETWEEN 1 AND 200 AND ${table.ownerUserId}=btrim(${table.ownerUserId})`
    ),
    check(
      "payload_erasure_scope_check",
      sql`(${table.scopeKey}='account' AND ${table.personalWorkspaceId} IS NOT NULL AND ${table.personalWorkspaceId}='personal:' || substring(encode(sha256(convert_to(${table.ownerUserId},'UTF8')),'hex'),1,32)) OR (${table.scopeKey} ~ '^[a-f0-9]{8}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{12}$' AND ${table.personalWorkspaceId} IS NULL)`
    ),
    check(
      "payload_erasure_phase_check",
      sql`${table.phase}='private' OR (${table.phase}='personal' AND ${table.scopeKey}='account')`
    ),
    check(
      "payload_erasure_token_check",
      sql`${table.continuationToken} IS NULL OR length(${table.continuationToken}) BETWEEN 1 AND 8192`
    ),
    index("payload_erasure_available_idx").on(
      table.availableAt,
      table.ownerUserId,
      table.scopeKey
    ),
    index("payload_erasure_namespace_idx").on(table.scopeKey),
  ]
);

/** A provider-only key is fenced before its retention window begins. */
export const payloadOrphans = pgTable(
  "payload_orphan",
  {
    id: uuid("id").primaryKey(),
    objectKey: text("object_key").notNull().unique(),
    discoveredAt: timestamp("discovered_at", { withTimezone: true })
      .notNull()
      .default(sql`clock_timestamp()`),
    availableAt: timestamp("available_at", { withTimezone: true })
      .notNull()
      .default(sql`clock_timestamp()`),
    deletedAt: timestamp("deleted_at", { withTimezone: true }),
  },
  (table) => [
    check(
      "payload_orphan_key_check",
      sql`length(${table.objectKey}) BETWEEN 1 AND 512 AND ${table.objectKey} ~ '^[a-z0-9/-]+$' AND right(${table.objectKey},36)=${table.id}::text`
    ),
    index("payload_orphan_available_idx").on(table.availableAt, table.id),
  ]
);

/** One native cursor bounds each inventory tick without starving later keys. */
export const payloadInventoryCursors = pgTable(
  "payload_inventory_cursor",
  {
    prefix: text("prefix").primaryKey(),
    continuationToken: text("continuation_token"),
  },
  (table) => [
    check(
      "payload_inventory_cursor_prefix_check",
      sql`length(${table.prefix}) BETWEEN 1 AND 128 AND ${table.prefix} ~ '^[a-z0-9]+([/-][a-z0-9]+)*$'`
    ),
    check(
      "payload_inventory_cursor_token_check",
      sql`${table.continuationToken} IS NULL OR length(${table.continuationToken}) BETWEEN 1 AND 8192`
    ),
  ]
);

/** Written by the PostgreSQL backup probe, never by the application role. */
export const payloadBackupInventory = payloadMaintenance.table(
  "payload_backup_inventory",
  {
    repository: text("repository").primaryKey(),
    oldestBackupStart: timestamp("oldest_backup_start", {
      withTimezone: true,
    }).notNull(),
    observedAt: timestamp("observed_at", { withTimezone: true }).notNull(),
  },
  (table) => [
    check(
      "payload_backup_inventory_repository",
      sql`${table.repository} = 'zoen'`
    ),
    check(
      "payload_backup_inventory_time",
      sql`${table.oldestBackupStart} <= ${table.observedAt}`
    ),
  ]
);
