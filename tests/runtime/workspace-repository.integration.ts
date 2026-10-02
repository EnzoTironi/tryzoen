import { query } from "@db/queries";
import { sql } from "drizzle-orm";
import { randomUUID } from "node:crypto";

import { expect, test } from "vitest";
import { workspaceFixture as fixture } from "./workspace-fixture";
import { WorkspaceAccessDenied } from "../../server/workspaces/access";

const run = async (
  body: (value: Awaited<ReturnType<typeof fixture>>) => Promise<void>
) => {
  await using workspace = await fixture();
  await body(workspace);
};

test.each(["fulfilled", "rejected"])(
  "disposes repository fixtures after a %s test body",
  async (outcome) => {
    const observed: Awaited<ReturnType<typeof fixture>>[] = [];
    const organizationIds: string[] = [];
    const namespaceId = randomUUID();
    const failure = new Error("Synthetic test body failure");
    const operation = run(async (workspace) => {
      observed.push(workspace);
      const organizations = await query<{ id: string }>(
        sql`SELECT organization_id AS id FROM workspaces WHERE id = ${workspace.actor.workspaceId}`
      );
      organizationIds.push(...organizations.map(({ id }) => id));
      await query(
        sql`INSERT INTO workspace_memory_namespace (workspace_id, user_id, namespace_id)
          VALUES (${workspace.actor.workspaceId}, ${workspace.actor.userId}, ${namespaceId})`
      );
      await workspace.repository.write(workspace.actor, {
        operationId: randomUUID(),
        expectedRevision: null,
        path: "knowledge/disposable.md",
        content: "Synthetic fixture lifecycle proof",
      });
      expect(
        (
          await workspace.repository.read(
            workspace.actor,
            "knowledge/disposable.md"
          )
        ).content
      ).toBe("Synthetic fixture lifecycle proof");
      if (outcome === "rejected") throw failure;
    });
    const error = await operation.then(
      () => null,
      (reason: unknown) => reason
    );
    expect(error).toBe(outcome === "rejected" ? failure : null);
    const workspace = observed[0];
    const organizationId = organizationIds[0];
    if (!workspace || !organizationId)
      throw new Error("Missing fixture identity");
    const workspaceIds = sql.join(
      [workspace.actor, workspace.personal, workspace.guestPersonal].map(
        ({ workspaceId }) => sql`${workspaceId}`
      ),
      sql`, `
    );
    const remaining = await query<{ resource: string; count: number }>(sql`
      SELECT 'workspaces' AS resource, count(*)::integer AS count FROM workspaces WHERE id IN (${workspaceIds})
      UNION ALL SELECT 'workspace_memberships', count(*)::integer FROM workspace_memberships WHERE workspace_id IN (${workspaceIds})
      UNION ALL SELECT 'workspace_repository', count(*)::integer FROM workspace_repository WHERE workspace_id IN (${workspaceIds})
      UNION ALL SELECT 'workspace_revision', count(*)::integer FROM workspace_revision WHERE workspace_id IN (${workspaceIds})
      UNION ALL SELECT 'workspace_memory_namespace', count(*)::integer FROM workspace_memory_namespace WHERE namespace_id = ${namespaceId}
      UNION ALL SELECT 'organizations', count(*)::integer FROM organizations WHERE id = ${organizationId}
      UNION ALL SELECT 'organization_memberships', count(*)::integer FROM organization_memberships WHERE organization_id = ${organizationId}
      UNION ALL SELECT 'user', count(*)::integer FROM public.user WHERE 'better-auth:' || id IN (${workspace.actor.userId}, ${workspace.guest.userId})
      UNION ALL SELECT 'session', count(*)::integer FROM public.session WHERE id IN (${workspace.actor.authSessionId}, ${workspace.guest.authSessionId})
    `);
    expect(
      remaining.toSorted((left, right) =>
        left.resource.localeCompare(right.resource)
      )
    ).toEqual(
      [
        "workspaces",
        "workspace_memberships",
        "workspace_repository",
        "workspace_revision",
        "workspace_memory_namespace",
        "organizations",
        "organization_memberships",
        "user",
        "session",
      ]
        .toSorted((left, right) => left.localeCompare(right))
        .map((resource) => ({ resource, count: 0 }))
    );
    expect(
      await query<{ ownerUserId: string }>(
        sql`SELECT owner_user_id AS "ownerUserId" FROM workspace_memory_erasure WHERE namespace_id = ${namespaceId}`
      )
    ).toEqual([{ ownerUserId: workspace.actor.userId }]);
  }
);

test("isolates personal and team repositories, preserves history and rejects forged revisions", () =>
  run(async ({ actor, guest, personal, repository }) => {
    const personalWrite = await repository.write(personal, {
      operationId: randomUUID(),
      expectedRevision: null,
      path: "knowledge/private.md",
      content: "PERSONAL ONLY",
    });
    const write = {
      operationId: randomUUID(),
      expectedRevision: null,
      path: "knowledge/plan.md",
      content: "Team plan",
    };
    const first = await repository.write(actor, write);
    expect(await repository.write(actor, write)).toEqual(first);
    expect((await repository.read(guest)).files).toEqual(["knowledge/plan.md"]);
    expect((await repository.read(personal)).files).toEqual([
      "knowledge/private.md",
    ]);
    await expect(
      Promise.try(async () =>
        repository.read(guest, "knowledge/private.md", personalWrite.revision)
      )
    ).rejects.toMatchObject({
      reason: "not_found",
    });
    const update = await repository.write(guest, {
      operationId: randomUUID(),
      expectedRevision: first.revision,
      path: "knowledge/plan.md",
      content: "Guest contribution",
    });
    expect(update.revision).not.toBe(first.revision);
    expect(
      (await repository.read(actor, "knowledge/plan.md", first.revision))
        .content
    ).toBe("Team plan");
    expect(await repository.history(guest, "knowledge/plan.md")).toHaveLength(
      2
    );
    expect((await repository.export(actor))?.bundle.length).toBeGreaterThan(
      100
    );
    await expect(
      Promise.try(async () =>
        repository.write(actor, { ...write, content: "Altered retry" })
      )
    ).rejects.toMatchObject({
      reason: "conflict",
    });
  }));

test("two simultaneous edits have one publication winner and never overwrite each other", () =>
  run(async ({ actor, repository }) => {
    const results = await Promise.all(
      ["One", "Two", "Three", "Four"].map((content) =>
        Promise.try(async () =>
          repository.write(actor, {
            operationId: randomUUID(),
            expectedRevision: null,
            path: "knowledge/plan.md",
            content,
          })
        ).then(
          (value) => ({ ok: true as const, value }),
          (error: unknown) => ({ ok: false as const, error })
        )
      )
    );
    expect(results.filter((result) => result.ok)).toHaveLength(1);
    const failures = results.filter((result) => !result.ok);
    expect(failures).toHaveLength(3);
    expect(failures.map((result) => result.error)).toEqual([
      expect.objectContaining({ reason: "conflict" }),
      expect.objectContaining({ reason: "conflict" }),
      expect.objectContaining({ reason: "conflict" }),
    ]);
    expect(await repository.history(actor, "knowledge/plan.md")).toHaveLength(
      1
    );
  }));

test("members cannot alter agent instructions; removal blocks current files, history and export", () =>
  run(async ({ actor, guest, repository }) => {
    const first = await repository.write(actor, {
      operationId: randomUUID(),
      expectedRevision: null,
      path: "agent/SOUL.md",
      content: "Be helpful.",
    });
    await expect(
      Promise.try(async () =>
        repository.write(guest, {
          operationId: randomUUID(),
          expectedRevision: first.revision,
          path: "agent/SOUL.md",
          content: "Override",
        })
      )
    ).rejects.toBeInstanceOf(WorkspaceAccessDenied);
    expect(
      await repository.selection(guest, ["agent/SOUL.md", "agent/IDENTITY.md"])
    ).toEqual({
      revision: first.revision,
      documents: [{ path: "agent/SOUL.md", content: "Be helpful." }],
    });
    await query(
      sql`DELETE FROM workspace_memberships WHERE workspace_id = ${actor.workspaceId} AND user_id = ${guest.userId}`
    );
    await Promise.all(
      [
        repository.read(guest),
        repository.history(guest, "agent/SOUL.md"),
        repository.export(guest),
        repository.selection(guest, ["agent/SOUL.md"]),
      ].map((operation) =>
        expect(operation).rejects.toBeInstanceOf(WorkspaceAccessDenied)
      )
    );
    await query(
      sql`DELETE FROM public.session WHERE id = ${actor.authSessionId}`
    );
    await expect(
      Promise.try(async () => repository.read(actor))
    ).rejects.toBeInstanceOf(WorkspaceAccessDenied);
  }));
