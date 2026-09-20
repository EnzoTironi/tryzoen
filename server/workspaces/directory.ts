import { query, transaction as withDatabaseTransaction } from "@db/queries";
import { sql } from "drizzle-orm";
import { z } from "zod";
import { randomUUID } from "node:crypto";
import { requireWorkspaceAccess, type WorkspaceActorSchema } from "./access";

const workspaceSummarySchema = z.object({
  id: z.string(),
  name: z.nullable(z.string()),
  role: z.enum(["owner", "admin", "member"]),
  organizationId: z.nullable(z.string()),
});

export const listUserWorkspaces = async function (
  actor: z.output<typeof WorkspaceActorSchema>
) {
  await requireWorkspaceAccess(actor);

  const rows =
    await query(sql`SELECT w.id, COALESCE(w.display_name, o.name) AS name, m.role, w.organization_id AS "organizationId"
    FROM workspaces w JOIN workspace_memberships m ON m.workspace_id = w.id
    LEFT JOIN organizations o ON o.id = w.organization_id
    WHERE m.user_id = ${actor.userId} AND (w.organization_id IS NULL OR EXISTS (
      SELECT 1 FROM organization_memberships om WHERE om.organization_id = w.organization_id AND om.user_id = ${actor.userId}))
    ORDER BY w.organization_id NULLS FIRST, w.created_at, w.id`);
  return await z.array(workspaceSummarySchema).parseAsync(rows);
};

export const createUserWorkspace = async function (
  actor: z.output<typeof WorkspaceActorSchema>,
  name: string
) {
  const title = await z
    .string()
    .refine((value) => value === value.trim(), "Expected trimmed text")
    .min(1)
    .max(80)
    .parseAsync(name);

  return await withDatabaseTransaction(async () => {
    await requireWorkspaceAccess(actor);
    const organizationId = randomUUID();
    const workspaceId = randomUUID();
    await query(
      sql`INSERT INTO organizations (id, name) VALUES (${organizationId}, ${title})`
    );
    await query(
      sql`INSERT INTO organization_memberships (organization_id, user_id, role) VALUES (${organizationId}, ${actor.userId}, 'admin')`
    );
    await query(
      sql`INSERT INTO workspaces (id, organization_id, display_name) VALUES (${workspaceId}, ${organizationId}, ${title})`
    );
    await query(
      sql`INSERT INTO workspace_memberships (workspace_id, user_id, role) VALUES (${workspaceId}, ${actor.userId}, 'admin')`
    );
    return { workspaceId };
  });
};
