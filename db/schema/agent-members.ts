import { sql } from "drizzle-orm";
import {
  check,
  pgTable,
  text,
  timestamp,
  uniqueIndex,
  uuid,
} from "drizzle-orm/pg-core";
import { workspaces } from "./workspaces";

export const workspaceAgentMembers = pgTable(
  "workspace_agent_members",
  {
    id: uuid("id").defaultRandom().primaryKey(),
    workspaceId: text("workspace_id")
      .notNull()
      .references(() => workspaces.id, { onDelete: "cascade" }),
    username: text("username").notNull(),
    name: text("name").notNull(),
    description: text("description").notNull().default(""),
    /** Immutable registration sponsor; never the agent's runtime authority. */
    createdBy: text("created_by").notNull(),
    createdAt: timestamp("created_at", { withTimezone: true })
      .notNull()
      .defaultNow(),
    revokedAt: timestamp("revoked_at", { withTimezone: true }),
    registrationOperationId: uuid("registration_operation_id").notNull(),
    registrationRequestHash: text("registration_request_hash").notNull(),
  },
  (t) => [
    uniqueIndex("workspace_agent_members_username_uidx").on(
      t.workspaceId,
      t.username
    ),
    uniqueIndex("workspace_agent_members_registration_uidx").on(
      t.workspaceId,
      t.createdBy,
      t.registrationOperationId
    ),
    check(
      "workspace_agent_members_username_check",
      sql`${t.username} ~ '^[a-z][a-z0-9_]{2,29}$'`
    ),
    check(
      "workspace_agent_members_name_check",
      sql`${t.name} = btrim(${t.name}) AND char_length(${t.name}) BETWEEN 1 AND 60`
    ),
    check(
      "workspace_agent_members_description_check",
      sql`char_length(${t.description}) <= 240`
    ),
    check(
      "workspace_agent_members_registration_hash_check",
      sql`${t.registrationRequestHash} ~ '^[0-9a-f]{64}$'`
    ),
    check(
      "workspace_agent_members_revocation_check",
      sql`${t.revokedAt} IS NULL OR ${t.revokedAt} >= ${t.createdAt}`
    ),
  ]
);
