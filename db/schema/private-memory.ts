import { sql } from "drizzle-orm";
import {
  boolean,
  check,
  index,
  pgTable,
  primaryKey,
  text,
  timestamp,
  unique,
  uuid,
} from "drizzle-orm/pg-core";
import { workspaceMemoryNamespaces } from "./learned-memory";
import { payloadObjects } from "./payloads";

/** The private bundle contains the canonical files and Git operation metadata.
 * Its namespace can never appear in the shared workspace repository. */
export const privateMemoryRepositories = pgTable(
  "private_memory_repository",
  {
    namespaceId: uuid("namespace_id")
      .primaryKey()
      .references(() => workspaceMemoryNamespaces.namespaceId, {
        onDelete: "cascade",
      }),
    headSha: text("head_sha"),
    payloadId: uuid("payload_object_id").references(() => payloadObjects.id),
    recordedAt: timestamp("recorded_at", {
      withTimezone: true,
      precision: 6,
      mode: "string",
    }),
  },
  (table) => [
    index("private_memory_repository_payload_idx")
      .on(table.payloadId)
      .where(sql`${table.payloadId} IS NOT NULL`),
    check(
      "private_memory_repository_snapshot_check",
      sql`(${table.headSha} IS NULL AND ${table.payloadId} IS NULL AND ${table.recordedAt} IS NULL) OR (${table.headSha} IS NOT NULL AND ${table.payloadId} IS NOT NULL AND ${table.recordedAt} IS NOT NULL AND ${table.headSha} ~ '^[a-f0-9]{40}$')`
    ),
  ]
);

/** Rebuildable operational lookup only; the Git commit owns these receipts. */
export const privateMemoryOperations = pgTable(
  "private_memory_operation",
  {
    namespaceId: uuid("namespace_id")
      .notNull()
      .references(() => privateMemoryRepositories.namespaceId, {
        onDelete: "cascade",
      }),
    operationId: text("operation_id").notNull(),
    revision: text("revision").notNull(),
    parentRevision: text("parent_revision"),
    claimId: uuid("claim_id"),
    requestHash: text("request_hash").notNull(),
    authorUserId: text("author_user_id").notNull(),
    recordedAt: timestamp("recorded_at", {
      withTimezone: true,
      precision: 6,
      mode: "string",
    }).notNull(),
  },
  (table) => [
    primaryKey({ columns: [table.namespaceId, table.operationId] }),
    unique("private_memory_operation_revision_key").on(
      table.namespaceId,
      table.revision
    ),
    check(
      "private_memory_operation_identity_check",
      sql`length(${table.operationId}) BETWEEN 1 AND 256 AND ${table.revision} ~ '^[a-f0-9]{40}$' AND (${table.parentRevision} IS NULL OR ${table.parentRevision} ~ '^[a-f0-9]{40}$') AND ${table.requestHash} ~ '^[a-f0-9]{64}$' AND length(${table.authorUserId}) BETWEEN 1 AND 200`
    ),
    index("private_memory_operation_history_idx").on(
      table.namespaceId,
      table.recordedAt.desc(),
      table.revision
    ),
  ]
);

/** SQL consent receipts are separate from canonical Git claim publications. */
export const privateMemoryPreferenceOperations = pgTable(
  "private_memory_preference_operation",
  {
    namespaceId: uuid("namespace_id")
      .notNull()
      .references(() => workspaceMemoryNamespaces.namespaceId, {
        onDelete: "cascade",
      }),
    operationId: text("operation_id").notNull(),
    requestHash: text("request_hash").notNull(),
    enabled: boolean("enabled").notNull(),
    preferenceRevision: uuid("preference_revision").notNull(),
    decidedAt: timestamp("decided_at", { withTimezone: true })
      .notNull()
      .defaultNow(),
  },
  (table) => [
    primaryKey({ columns: [table.namespaceId, table.operationId] }),
    check(
      "private_memory_preference_operation_identity_check",
      sql`length(${table.operationId}) BETWEEN 1 AND 256 AND ${table.requestHash} ~ '^[a-f0-9]{64}$'`
    ),
  ]
);
