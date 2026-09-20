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
          status: "planned",
        },
        sources: [
          {
            path: "knowledge/project.md",
            revision: source.revision,
          },
        ],
      },
      {
        id: "task_one",
        type: "task",
        name: "First task",
        properties: {
          status: "open",
        },
        sources: [],
      },
    ],
    links: [
      {
        type: "part_of",
        from: "task_one",
        to: "project_one",
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
  };
  const changed = await applyOntologyAction(actor, action);
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
  expect((await readOntology(guest)).graph.entities[0]?.properties.status).toBe(
    "active"
  );
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
