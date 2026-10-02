import { sql } from "drizzle-orm";
import {
  check,
  foreignKey,
  index,
  jsonb,
  pgTable,
  text,
  timestamp,
  uuid,
  uniqueIndex,
} from "drizzle-orm/pg-core";
import { workspaceMemberships, workspaces } from "./workspaces";
import { organizationMemberships } from "./organizations";

export const toolConnections = pgTable(
  "tool_connections",
  {
    id: uuid("id").primaryKey(),
    workspaceId: text("workspace_id")
      .notNull()
      .references(() => workspaces.id, { onDelete: "cascade" }),
    connectedBy: text("connected_by").notNull(),
    organizationId: text("organization_id"),
    name: text("name").notNull(),
    kind: text("kind").notNull(),
    endpoint: text("endpoint"),
    credentials: text("credentials"),
    requestHash: text("request_hash").notNull(),
    revision: uuid("revision").notNull().defaultRandom(),
    operations: jsonb("operations"),
    postgresConfig: jsonb("postgres_config"),
    share: text("share").notNull(),
    revokedAt: timestamp("revoked_at", { withTimezone: true }),
    createdAt: timestamp("created_at", { withTimezone: true })
      .notNull()
      .defaultNow(),
  },
  (t) => [
    foreignKey({
      name: "tool_connections_workspace_owner_fkey",
      columns: [t.workspaceId, t.connectedBy],
      foreignColumns: [
        workspaceMemberships.workspaceId,
        workspaceMemberships.userId,
      ],
    }).onDelete("cascade"),
    foreignKey({
      name: "tool_connections_company_owner_fkey",
      columns: [t.organizationId, t.connectedBy],
      foreignColumns: [
        organizationMemberships.organizationId,
        organizationMemberships.userId,
      ],
    }).onDelete("cascade"),
    index("tool_connections_workspace_idx").on(t.workspaceId),
    check(
      "tool_connections_kind_check",
      sql`${t.kind} IN ('mcp', 'openapi', 'postgres')`
    ),
    check(
      "tool_connections_configuration_check",
      sql`
      CASE WHEN ${t.kind} IN ('mcp', 'openapi') THEN
        ${t.postgresConfig} IS NULL AND ${t.endpoint} IS NOT NULL
        AND length(${t.endpoint}) BETWEEN 1 AND 1000
        AND CASE WHEN jsonb_typeof(${t.operations}) = 'array'
          THEN jsonb_array_length(${t.operations}) BETWEEN 1 AND 100 ELSE false END
      WHEN ${t.kind} = 'postgres' THEN
        ${t.endpoint} IS NULL AND ${t.operations} IS NULL AND ${t.postgresConfig} IS NOT NULL
        AND jsonb_typeof(${t.postgresConfig}) = 'object'
        AND ${t.postgresConfig} ?& ARRAY['host', 'port', 'database', 'tls']
        AND (${t.postgresConfig} - ARRAY['host', 'port', 'database', 'tls']) = '{}'::jsonb
        AND jsonb_typeof(${t.postgresConfig}->'host') = 'string'
        AND length(${t.postgresConfig}->>'host') BETWEEN 1 AND 253
        AND (${t.postgresConfig}->>'host') ~ '^[a-z0-9.:-]+$'
        AND jsonb_typeof(${t.postgresConfig}->'database') = 'string'
        AND octet_length(${t.postgresConfig}->>'database') BETWEEN 1 AND 63
        AND jsonb_typeof(${t.postgresConfig}->'tls') = 'string'
        AND ${t.postgresConfig}->>'tls' = 'verify-full'
        AND CASE WHEN jsonb_typeof(${t.postgresConfig}->'port') = 'number'
          THEN (${t.postgresConfig}->>'port')::numeric BETWEEN 1 AND 65535
            AND trunc((${t.postgresConfig}->>'port')::numeric) = (${t.postgresConfig}->>'port')::numeric
          ELSE false END
      ELSE false END
    `
    ),
    check(
      "tool_connections_share_check",
      sql`${t.share} IN ('owner', 'workspace')`
    ),
  ]
);

export const toolInvocations = pgTable(
  "tool_invocations",
  {
    id: uuid("id").primaryKey(),
    workspaceId: text("workspace_id")
      .notNull()
      .references(() => workspaces.id, { onDelete: "cascade" }),
    connectionId: uuid("connection_id")
      .notNull()
      .references(() => toolConnections.id, { onDelete: "cascade" }),
    invocationKey: text("invocation_key").notNull(),
    requestHash: text("request_hash").notNull(),
    status: text("status").notNull(),
    result: jsonb("result"),
    createdAt: timestamp("created_at", { withTimezone: true })
      .notNull()
      .defaultNow(),
    completedAt: timestamp("completed_at", { withTimezone: true }),
  },
  (t) => [
    uniqueIndex("tool_invocations_key_uidx").on(t.workspaceId, t.invocationKey),
    check(
      "tool_invocations_status_check",
      sql`${t.status} IN ('started', 'completed', 'uncertain')`
    ),
  ]
);
