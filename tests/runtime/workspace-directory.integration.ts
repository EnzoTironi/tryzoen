import { query } from "@db/queries";
import { sql } from "drizzle-orm";
import { randomUUID } from "node:crypto";
import { expect, test } from "vitest";
import { WorkspaceAccessDenied } from "../../server/workspaces/access";
import {
  createUserWorkspace,
  listUserWorkspaces,
} from "../../server/workspaces/directory";
import { workspaceFixture } from "./workspace-fixture";

async function run(
  body: (
    fixture: Awaited<ReturnType<typeof workspaceFixture>>,
    create: typeof createUserWorkspace
  ) => Promise<void>
) {
  await using fixture = await workspaceFixture();
  await using resources = new AsyncDisposableStack();
  const created = new Set<string>();
  resources.defer(async () => {
    for (const workspaceId of created) {
      const rows = await query<{ organizationId: string }>(sql`
        SELECT organization_id AS "organizationId" FROM workspaces WHERE id = ${workspaceId}`);
      await query(sql`DELETE FROM workspaces WHERE id = ${workspaceId}`);
      for (const row of rows)
        await query(
          sql`DELETE FROM organizations WHERE id = ${row.organizationId}`
        );
    }
  });
  await body(fixture, async (actor, input) => {
    const result = await createUserWorkspace(actor, input);
    created.add(result.workspaceId);
    return result;
  });
}

test("concurrent retries create one company workspace and both administrator memberships", () =>
  run(async ({ personal }, create) => {
    const input = {
      operationId: randomUUID(),
      name: "Synthetic directory team",
    };
    const attempts = await Promise.allSettled(
      Array.from({ length: 8 }, () => create(personal, input))
    );
    const ids = attempts.map((attempt) => {
      expect(attempt.status).toBe("fulfilled");
      if (attempt.status !== "fulfilled") throw attempt.reason;
      return attempt.value.workspaceId;
    });
    expect(new Set(ids).size).toBe(1);
    const workspaceId = ids[0];
    const rows =
      await query(sql`SELECT w.display_name, wm.role AS workspace_role, om.role AS organization_role
      FROM workspaces w JOIN workspace_memberships wm ON wm.workspace_id = w.id
      JOIN organization_memberships om ON om.organization_id = w.organization_id
      WHERE w.id = ${workspaceId} AND wm.user_id = ${personal.userId} AND om.user_id = ${personal.userId}`);
    expect(rows).toEqual([
      {
        display_name: input.name,
        workspace_role: "admin",
        organization_role: "admin",
      },
    ]);
  }));

test("a lost response and differently cased nonce recover the same workspace", () =>
  run(async ({ personal }, create) => {
    const input = {
      operationId: randomUUID(),
      name: "Synthetic recovered team",
    };
    const first = await create(personal, input);
    expect(
      await create(personal, {
        ...input,
        operationId: input.operationId.toUpperCase(),
      })
    ).toEqual(first);
    expect(
      (await listUserWorkspaces(personal)).filter(
        (space) => space.id === first.workspaceId
      )
    ).toHaveLength(1);
  }));

test("operation identities are isolated by the authenticated account", () =>
  run(async ({ personal, guestPersonal }, create) => {
    const input = {
      operationId: randomUUID(),
      name: "Synthetic account scope",
    };
    const owner = await create(personal, input);
    const guest = await create(guestPersonal, input);
    expect(owner.workspaceId).not.toBe(guest.workspaceId);
    expect(
      (await listUserWorkspaces(personal)).some(
        (space) => space.id === guest.workspaceId
      )
    ).toBe(false);
    expect(
      (await listUserWorkspaces(guestPersonal)).some(
        (space) => space.id === owner.workspaceId
      )
    ).toBe(false);
  }));

test("changing the name for an accepted operation cannot create or rename a workspace", () =>
  run(async ({ personal }, create) => {
    const input = {
      operationId: randomUUID(),
      name: "Synthetic original name",
    };
    const result = await create(personal, input);
    await expect(
      create(personal, { ...input, name: "Changed request" })
    ).rejects.toThrow("The workspace creation request changed.");
    expect(
      (await listUserWorkspaces(personal)).find(
        (space) => space.id === result.workspaceId
      )?.name
    ).toBe(input.name);
  }));

test("replaying creation cannot restore revoked workspace or organization access", () =>
  run(async ({ personal }, create) => {
    const input = { operationId: randomUUID(), name: "Synthetic revoked team" };
    const result = await create(personal, input);
    await query(
      sql`DELETE FROM workspace_memberships WHERE workspace_id = ${result.workspaceId} AND user_id = ${personal.userId}`
    );
    await expect(create(personal, input)).rejects.toBeInstanceOf(
      WorkspaceAccessDenied
    );
    expect(
      await query(
        sql`SELECT workspace_id FROM workspace_memberships WHERE workspace_id = ${result.workspaceId}`
      )
    ).toEqual([]);
    await query(
      sql`INSERT INTO workspace_memberships (workspace_id, user_id, role) VALUES (${result.workspaceId}, ${personal.userId}, 'admin')`
    );
    await query(
      sql`DELETE FROM organization_memberships WHERE organization_id = (SELECT organization_id FROM workspaces WHERE id = ${result.workspaceId}) AND user_id = ${personal.userId}`
    );
    await expect(create(personal, input)).rejects.toBeInstanceOf(
      WorkspaceAccessDenied
    );
    expect(
      await query(
        sql`SELECT organization_id FROM organization_memberships WHERE organization_id = (SELECT organization_id FROM workspaces WHERE id = ${result.workspaceId})`
      )
    ).toEqual([]);
  }));

test("expired native authentication denies both a new creation and recovery", () =>
  run(async ({ personal }, create) => {
    const input = {
      operationId: randomUUID(),
      name: "Synthetic expired session",
    };
    await create(personal, input);
    await query(
      sql`UPDATE public.session SET "expiresAt" = now() - interval '1 second' WHERE id = ${personal.authSessionId}`
    );
    await expect(create(personal, input)).rejects.toBeInstanceOf(
      WorkspaceAccessDenied
    );
    await expect(
      create(personal, { ...input, operationId: randomUUID() })
    ).rejects.toBeInstanceOf(WorkspaceAccessDenied);
  }));

test("invalid names and operation identities are rejected before workspace creation", () =>
  run(async ({ personal }, create) => {
    const before = await listUserWorkspaces(personal);
    for (const name of ["", " ", " padded ", "x".repeat(81)])
      await expect(
        create(personal, { operationId: randomUUID(), name })
      ).rejects.toBeInstanceOf(Error);
    await expect(
      create(personal, {
        operationId: "invalid",
        name: "Synthetic invalid nonce",
      })
    ).rejects.toBeInstanceOf(Error);
    expect(await listUserWorkspaces(personal)).toEqual(before);
  }));
