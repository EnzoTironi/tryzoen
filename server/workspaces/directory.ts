import { query, transaction as withDatabaseTransaction } from "@db/queries";
import { sql } from "drizzle-orm";
import { z } from "zod";
import { createHash } from "node:crypto";
import { requireWorkspaceAccess, type WorkspaceActorSchema } from "./access";

export const WorkspaceCreationSchema = z.object({
  operationId: z.uuid().toLowerCase(),
  name: z
    .string()
    .refine((value) => value === value.trim(), "Expected trimmed text")
    .min(1)
    .max(80),
});

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
  input: z.output<typeof WorkspaceCreationSchema>
) {
  const { name, operationId } = WorkspaceCreationSchema.parse(input);
  const identity = createHash("sha256")
    .update(
      JSON.stringify(["zoen-workspace-creation", actor.userId, operationId])
    )
    .digest("hex");
  const organizationId = `organization-${identity}`;
  const workspaceId = `workspace-${identity}`;

  return await withDatabaseTransaction(async () => {
    await requireWorkspaceAccess(actor);
    const inserted = await query(
      sql`INSERT INTO organizations (id, name) VALUES (${organizationId}, ${name})
      ON CONFLICT (id) DO NOTHING RETURNING id`
    );
    if (inserted.length === 0) {
      await requireWorkspaceAccess({ ...actor, workspaceId }, true);
      const existing = await query(sql`SELECT id FROM workspaces
        WHERE id = ${workspaceId} AND organization_id = ${organizationId}
          AND display_name = ${name} FOR SHARE`);
      if (existing.length !== 1)
        throw new Error("The workspace creation request changed.");
      return { workspaceId };
    }
    await query(
      sql`INSERT INTO organization_memberships (organization_id, user_id, role) VALUES (${organizationId}, ${actor.userId}, 'admin')`
    );
    await query(
      sql`INSERT INTO workspaces (id, organization_id, display_name) VALUES (${workspaceId}, ${organizationId}, ${name})`
    );
    await query(
      sql`INSERT INTO workspace_memberships (workspace_id, user_id, role) VALUES (${workspaceId}, ${actor.userId}, 'admin')`
    );
    return { workspaceId };
  });
};
