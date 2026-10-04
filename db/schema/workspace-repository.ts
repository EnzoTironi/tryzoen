import { sql } from "drizzle-orm";
import {
  check,
  foreignKey,
  index,
  pgTable,
  primaryKey,
  text,
  timestamp,
  unique,
  uuid,
} from "drizzle-orm/pg-core";
import { workspaces } from "./workspaces";
import { payloadObjects } from "./payloads";

export const workspaceRepositories = pgTable(
  "workspace_repository",
  {
    workspaceId: text("workspace_id")
      .primaryKey()
      .references(() => workspaces.id, { onDelete: "cascade" }),
    headSha: text("head_sha").notNull(),
    payloadId: uuid("payload_object_id")
      .notNull()
      .references(() => payloadObjects.id),
    updatedAt: timestamp("updated_at", { withTimezone: true })
      .notNull()
      .defaultNow(),
  },
  (table) => [
    index("workspace_repository_payload_idx")
      .on(table.payloadId)
      .where(sql`${table.payloadId} IS NOT NULL`),
    check(
      "workspace_repository_head_sha_check",
      sql`${table.headSha} ~ '^[a-f0-9]{40}$'`
    ),
  ]
);

export const workspaceRevisions = pgTable(
  "workspace_revision",
  {
    workspaceId: text("workspace_id")
      .notNull()
      .references(() => workspaces.id, { onDelete: "cascade" }),
    revision: text("revision").notNull(),
    parentRevision: text("parent_revision"),
    operationId: uuid("operation_id").notNull(),
    requestHash: text("request_hash").notNull(),
    paths: text("paths").array().notNull(),
    authorUserId: text("author_user_id").notNull(),
    source: text("source").notNull().default("editor"),
    sourceSha256: text("source_sha256"),
    createdAt: timestamp("created_at", { withTimezone: true })
      .notNull()
      .defaultNow(),
  },
  (table) => [
    primaryKey({ columns: [table.workspaceId, table.revision] }),
    unique("workspace_revision_workspace_id_operation_id_key").on(
      table.workspaceId,
      table.operationId
    ),
    check(
      "workspace_revision_revision_check",
      sql`${table.revision} ~ '^[a-f0-9]{40}$'`
    ),
    check(
      "workspace_revision_paths_check",
      sql`cardinality(${table.paths}) BETWEEN 1 AND 24`
    ),
    index("workspace_revision_history").on(
      table.workspaceId,
      table.createdAt.desc()
    ),
  ]
);

export const workspaceSources = pgTable(
  "workspace_source",
  {
    workspaceId: text("workspace_id").notNull(),
    revision: text("revision").notNull(),
    filename: text("filename").notNull(),
    payloadId: uuid("payload_object_id")
      .notNull()
      .references(() => payloadObjects.id),
  },
  (table) => [
    index("workspace_source_payload_idx")
      .on(table.payloadId)
      .where(sql`${table.payloadId} IS NOT NULL`),
    primaryKey({ columns: [table.workspaceId, table.revision] }),
    foreignKey({
      columns: [table.workspaceId, table.revision],
      foreignColumns: [
        workspaceRevisions.workspaceId,
        workspaceRevisions.revision,
      ],
    }).onDelete("cascade"),
    check(
      "workspace_source_filename_check",
      sql`length(${table.filename}) BETWEEN 1 AND 255`
    ),
  ]
);
