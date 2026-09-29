import { mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { execFile } from "node:child_process";
import { promisify } from "node:util";
import { query } from "@db/queries";
import { sql } from "drizzle-orm";
import { randomUUID } from "node:crypto";
import { expect, test, onTestFinished } from "vitest";
import {
  applyOntologyAction,
  publishOntology,
  readOntology,
} from "../../server/workspaces/ontology";
import { emptyOntology } from "../../shared/workspaces/ontology";
import { workspaceFixture } from "./workspace-fixture";
import { invokeWorkspaceTool } from "../../server/tools/workspace";
test("ontology actions retain sources and history, replay once, and reject foreign provenance or stale writes", async () => {
  await using workspace = await workspaceFixture();
  const { actor, guest, personal, repository } = workspace;
  const source = await repository.write(actor, {
    operationId: randomUUID(),
    expectedRevision: null,
    path: "knowledge/project.md",
    content: "# Project\nSynthetic source evidence.",
  });
  const privateSource = await repository.write(personal, {
    operationId: randomUUID(),
    expectedRevision: null,
    path: "knowledge/private.md",
    content: "PRIVATE",
  });
  const graph = {
    ...emptyOntology,
    entities: [
      {
        id: "project_one",
        type: "project",
        name: "First project",
        properties: {
          status: {
            value: "planned",
            sources: [
              {
                path: "knowledge/project.md",
                revision: source.revision,
                excerpt: "Synthetic source evidence.",
              },
            ],
            validTime: null,
          },
        },
        sources: [
          {
            path: "knowledge/project.md",
            revision: source.revision,
            excerpt: "Synthetic source evidence.",
          },
        ],
      },
      {
        id: "task_one",
        type: "task",
        name: "First task",
        properties: {
          status: { value: "open", sources: [], validTime: null },
        },
        sources: [],
      },
    ],
    links: [
      {
        type: "part_of",
        from: "task_one",
        to: "project_one",
        sources: [],
        validTime: null,
      },
    ],
  };
  const saved = await publishOntology(actor, {
    operationId: randomUUID(),
    expectedRevision: source.revision,
    graph,
  });
  expect((await readOntology(guest)).graph.links).toEqual(graph.links);
  expect(
    !(
      await Promise.try(async () =>
        publishOntology(guest, {
          operationId: randomUUID(),
          expectedRevision: saved.revision,
          graph,
        })
      ).then(
        (value) => ({
          ok: true as const,
          value,
        }),
        (error: unknown) => ({
          ok: false as const,
          error,
        })
      )
    ).ok
  ).toBe(true);
  const action = {
    operationId: randomUUID(),
    expectedRevision: saved.revision,
    entityId: "project_one",
    actionId: "project_status",
    value: "active",
    sources: [],
    validTime: null,
  };
  const changed = await applyOntologyAction(actor, action);
  expect(
    (await readOntology(actor)).graph.entities[0]?.properties.status?.sources
  ).toEqual([]);
  expect(await applyOntologyAction(actor, action)).toEqual(changed);
  const exported = await repository.export(actor);
  if (!exported) throw new Error("Missing Git export");
  const directory = await mkdtemp(join(tmpdir(), "zoen-ontology-proof-"));
  onTestFinished(() =>
    rm(directory, {
      recursive: true,
      force: true,
    })
  );
  await writeFile(`${directory}/workspace.bundle`, exported.bundle);
  await promisify(execFile)(
    "git",
    [
      "clone",
      "--bare",
      `${directory}/workspace.bundle`,
      `${directory}/repository`,
    ],
    {
      timeout: 15_000,
    }
  );
  const commit = (
    await promisify(execFile)(
      "git",
      [
        "--git-dir",
        `${directory}/repository`,
        "show",
        "-s",
        "--format=%P%n%B",
        changed.revision,
      ],
      {
        timeout: 15_000,
      }
    )
  ).stdout;
  expect(commit.split("\n")[0]).toBe(saved.revision);
  expect(commit).toContain(
    `Zoen-Metadata: ${JSON.stringify({
      actor: actor.userId,
      operation: action.operationId,
      action: {
        actionId: action.actionId,
        entityId: action.entityId,
      },
    })}`
  );
  expect(
    (await readOntology(guest)).graph.entities[0]?.properties.status?.value
  ).toBe("active");
  expect(
    (await repository.read(actor, "ontology/workspace.json", saved.revision))
      .content
  ).toContain("planned");
  const history = await query<{
    n: number;
  }>(
    sql`SELECT count(*)::int AS n FROM workspace_revision WHERE workspace_id = ${actor.workspaceId} AND operation_id = ${action.operationId}`
  );
  expect(history[0]?.n).toBe(1);
  expect(
    !(
      await Promise.try(async () =>
        applyOntologyAction(actor, {
          ...action,
          operationId: randomUUID(),
          value: "overwritten",
        })
      ).then(
        (value) => ({
          ok: true as const,
          value,
        }),
        (error: unknown) => ({
          ok: false as const,
          error,
        })
      )
    ).ok
  ).toBe(true);
  const firstEntity = graph.entities[0];
  if (!firstEntity) throw new Error("Missing fixture entity");
  const foreign = {
    ...graph,
    entities: [
      {
        ...firstEntity,
        sources: [
          {
            path: "knowledge/private.md",
            revision: privateSource.revision,
            excerpt: "PRIVATE",
          },
        ],
      },
      ...graph.entities.slice(1),
    ],
  };
  expect(
    !(
      await Promise.try(async () =>
        publishOntology(actor, {
          graph: foreign,
          operationId: randomUUID(),
          expectedRevision: changed.revision,
        })
      ).then(
        (value) => ({
          ok: true as const,
          value,
        }),
        (error: unknown) => ({
          ok: false as const,
          error,
        })
      )
    ).ok
  ).toBe(true);
  expect(
    !(
      await Promise.try(async () =>
        publishOntology(actor, {
          graph: {
            ...graph,
            links: [
              {
                type: "part_of",
                from: "project_one",
                to: "task_one",
                sources: [],
                validTime: null,
              },
            ],
          },
          operationId: randomUUID(),
          expectedRevision: changed.revision,
        })
      ).then(
        (value) => ({
          ok: true as const,
          value,
        }),
        (error: unknown) => ({
          ok: false as const,
          error,
        })
      )
    ).ok
  ).toBe(true);
  await query(
    sql`DELETE FROM organization_memberships WHERE user_id = ${actor.userId}`
  );
  expect(
    !(
      await Promise.try(async () =>
        applyOntologyAction(actor, {
          ...action,
          expectedRevision: changed.revision,
        })
      ).then(
        (value) => ({
          ok: true as const,
          value,
        }),
        (error: unknown) => ({
          ok: false as const,
          error,
        })
      )
    ).ok
  ).toBe(true);
});

test("property and relationship evidence validates exact scoped sources, supports two time coordinates and detects source edits", async () => {
  await using workspace = await workspaceFixture();
  const { actor, guest, guestPersonal, repository } = workspace;
  const source = await repository.write(actor, {
    operationId: randomUUID(),
    expectedRevision: null,
    path: "knowledge/project.md",
    content:
      "# Project\nActive from 2026-09-01 until 2026-10-01.\nTask belongs to Project.",
  });
  const citation = {
    path: "knowledge/project.md",
    revision: source.revision,
    excerpt: "Active from 2026-09-01 until 2026-10-01.",
  };
  const interval = { from: "2026-09-01", until: "2026-10-01" };
  const graph = {
    ...emptyOntology,
    entities: [
      {
        id: "project_one",
        type: "project",
        name: "Project",
        sources: [],
        properties: {
          status: { value: "active", sources: [citation], validTime: interval },
        },
      },
      {
        id: "task_one",
        type: "task",
        name: "Task",
        sources: [],
        properties: { status: { value: "open", sources: [], validTime: null } },
      },
    ],
    links: [
      {
        type: "part_of",
        from: "task_one",
        to: "project_one",
        sources: [{ ...citation, excerpt: "Task belongs to Project." }],
        validTime: interval,
      },
    ],
  };
  const saved = await publishOntology(actor, {
    graph,
    operationId: randomUUID(),
    expectedRevision: source.revision,
  });
  const selected = await invokeWorkspaceTool(guest, {
    path: "workspace_ontology_read",
    args: { revision: saved.revision, validOn: "2026-09-15" },
  });
  expect(selected).toMatchObject({
    revision: saved.revision,
    validOn: "2026-09-15",
    graph: { actions: [], links: graph.links },
  });
  const outside = await readOntology(guest, {
    revision: saved.revision,
    validOn: "2026-10-01",
  });
  expect(outside.graph.entities[0]?.properties).toEqual({});
  expect(outside.graph.entities[1]?.properties.status?.validTime).toBeNull();
  expect(outside.graph.links).toEqual([]);
  expect(outside.mayManage).toBe(false);
  expect(
    (await readOntology(actor)).sources.every(
      (item) => item.status === "passage-present"
    )
  ).toBe(true);
  const changed = await applyOntologyAction(actor, {
    operationId: randomUUID(),
    expectedRevision: saved.revision,
    actionId: "project_status",
    entityId: "project_one",
    value: "paused",
    sources: [],
    validTime: null,
  });
  expect(
    (await readOntology(actor, { revision: saved.revision })).graph.entities[0]
      ?.properties.status
  ).toEqual(graph.entities[0]?.properties.status);
  expect(
    (await readOntology(actor)).graph.entities[0]?.properties.status
  ).toEqual({ value: "paused", sources: [], validTime: null });
  const edited = await repository.write(actor, {
    operationId: randomUUID(),
    expectedRevision: changed.revision,
    path: citation.path,
    content: "# Project\nThe old relationship evidence has been corrected.",
  });
  expect((await readOntology(guest)).sources[0]?.status).toBe(
    "passage-changed"
  );
  expect(
    (await readOntology(guest, { revision: saved.revision })).sources.every(
      (item) => item.status === "passage-changed"
    )
  ).toBe(true);
  await expect(
    publishOntology(actor, {
      graph: {
        ...graph,
        links: [
          {
            ...graph.links[0],
            type: "part_of",
            from: "task_one",
            to: "project_one",
            validTime: interval,
            sources: [{ ...citation, excerpt: "Invented passage" }],
          },
        ],
      },
      operationId: randomUUID(),
      expectedRevision: edited.revision,
    })
  ).rejects.toMatchObject({ reason: "source" });
  await expect(
    readOntology(guestPersonal, { revision: saved.revision })
  ).rejects.toThrow(Error);
  const removed = await repository.write(actor, {
    operationId: randomUUID(),
    expectedRevision: edited.revision,
    path: citation.path,
    content: null,
  });
  expect((await readOntology(guest)).sources[0]?.status).toBe("unavailable");
  expect(
    (await repository.read(actor, citation.path, source.revision)).content
  ).toContain(citation.excerpt);
  expect((await readOntology(actor)).revision).toBe(removed.revision);
  await query(
    sql`DELETE FROM organization_memberships WHERE user_id = ${guest.userId}`
  );
  await expect(
    readOntology(guest, { revision: saved.revision })
  ).rejects.toMatchObject({ name: "WorkspaceAccessDenied" });
});
