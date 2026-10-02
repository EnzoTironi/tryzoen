import { query } from "@db/queries";
import {
  emptyOntology,
  ontologyPath,
  OntologyActInputSchema,
  type OntologyClaimSchema,
  type OntologySchema,
} from "@zoen/companion-ui/ontology";
import { sql } from "drizzle-orm";
import { randomUUID } from "node:crypto";
import { expect, test } from "vitest";
import type { z } from "zod";
import { workspaceOperationId } from "../../agent/lib/workspace-operation";
import {
  applyOntologyAction,
  publishOntology,
  readOntology,
} from "../../server/workspaces/ontology";
import { workspaceFixture } from "./workspace-fixture";

const scopedActionGraph = (
  status: string
): z.output<typeof OntologySchema> => ({
  ...emptyOntology,
  entities: [
    {
      id: "project_one",
      type: "project",
      name: "Scoped regression project",
      properties: { status: { value: status, sources: [], validTime: null } },
      sources: [],
    },
  ],
});

test("ontology actions keep, replace and clear claim metadata while preserving other records and previous history", async () => {
  await using workspace = await workspaceFixture();
  const { actor, repository } = workspace;
  const originalPassage =
    "Project is planned, then active, from 2026-09-01 until 2026-10-01.";
  const replacementPassage =
    "Project is paused from 2026-10-01 until 2026-11-01.";
  const recordPassage = "Project record label is Action regression project.";
  const priorityPassage = "Project priority remains high.";
  const taskPassage = "Task is open from 2026-08-01 until 2026-12-01.";
  const linkPassage =
    "Task belongs to Project from 2026-08-01 until 2026-12-01.";
  const source = await repository.publish(actor, {
    operationId: randomUUID(),
    expectedRevision: null,
    changes: [
      {
        path: "knowledge/original.md",
        content: [
          originalPassage,
          recordPassage,
          priorityPassage,
          taskPassage,
          linkPassage,
        ].join("\n"),
      },
      { path: "knowledge/replacement.md", content: replacementPassage },
    ],
  });
  const originalCitation = {
    path: "knowledge/original.md",
    revision: source.revision,
    excerpt: originalPassage,
  };
  const initialClaim: z.output<typeof OntologyClaimSchema> = {
    value: "planned",
    sources: [originalCitation],
    validTime: { from: "2026-09-01", until: "2026-10-01" },
  };
  const priorityProperty = {
    id: "priority",
    name: "Priority",
    type: "string",
    required: false,
  } satisfies z.output<
    typeof OntologySchema
  >["types"][number]["properties"][number];
  const graph: z.output<typeof OntologySchema> = {
    ...emptyOntology,
    types: emptyOntology.types.map((type) =>
      type.id === "project"
        ? Object.assign({}, type, {
            properties: [...type.properties, priorityProperty],
          })
        : type
    ),
    entities: [
      {
        id: "project_one",
        type: "project",
        name: "Action regression project",
        properties: {
          status: initialClaim,
          priority: {
            value: "high",
            sources: [{ ...originalCitation, excerpt: priorityPassage }],
            validTime: null,
          },
        },
        sources: [{ ...originalCitation, excerpt: recordPassage }],
      },
      {
        id: "task_one",
        type: "task",
        name: "Unchanged regression task",
        properties: {
          status: {
            value: "open",
            sources: [{ ...originalCitation, excerpt: taskPassage }],
            validTime: { from: "2026-08-01", until: "2026-12-01" },
          },
        },
        sources: [{ ...originalCitation, excerpt: taskPassage }],
      },
    ],
    links: [
      {
        type: "part_of",
        from: "task_one",
        to: "project_one",
        sources: [{ ...originalCitation, excerpt: linkPassage }],
        validTime: { from: "2026-08-01", until: "2026-12-01" },
      },
    ],
  };
  const saved = await publishOntology(actor, {
    operationId: randomUUID(),
    expectedRevision: source.revision,
    graph,
  });
  const claims: z.output<typeof OntologyClaimSchema>[] = [
    { ...initialClaim, value: "active" },
    {
      value: "paused",
      sources: [
        {
          path: "knowledge/replacement.md",
          revision: source.revision,
          excerpt: replacementPassage,
        },
      ],
      validTime: { from: "2026-10-01", until: "2026-11-01" },
    },
    { value: "manual", sources: [], validTime: null },
  ];
  const snapshots = [
    { revision: saved.revision, parent: source.revision, graph },
  ];
  let revision = saved.revision;
  for (const claim of claims) {
    const changed = await applyOntologyAction(actor, {
      operationId: randomUUID(),
      expectedRevision: revision,
      entityId: "project_one",
      actionId: "project_status",
      ...claim,
    });
    const expectedGraph = {
      ...graph,
      entities: graph.entities.map((entity) =>
        entity.id === "project_one"
          ? Object.assign({}, entity, {
              properties: { ...entity.properties, status: claim },
            })
          : entity
      ),
    };
    const current = await readOntology(actor);
    expect(current.revision).toBe(changed.revision);
    expect(current.graph).toEqual(expectedGraph);
    expect(
      current.sources.every((item) => item.status === "passage-present")
    ).toBe(true);
    snapshots.push({
      revision: changed.revision,
      parent: revision,
      graph: expectedGraph,
    });
    revision = changed.revision;
  }
  for (const snapshot of snapshots) {
    const historical = await readOntology(actor, {
      revision: snapshot.revision,
    });
    expect(historical.revision).toBe(snapshot.revision);
    expect(historical.graph).toEqual({ ...snapshot.graph, actions: [] });
  }
  const history = await repository.history(actor, ontologyPath);
  expect(
    history.map(
      ({
        revision: recordedRevision,
        parent,
        author,
        source: publicationSource,
      }) => ({
        revision: recordedRevision,
        parent,
        author,
        source: publicationSource,
      })
    )
  ).toEqual(
    snapshots.toReversed().map((snapshot) => ({
      revision: snapshot.revision,
      parent: snapshot.parent,
      author: actor.userId,
      source: "ontology",
    }))
  );
});

test("ontology action replay, conflicts and owner downgrade respect personal and shared workspace isolation", async () => {
  await using workspace = await workspaceFixture();
  const { actor, guest, personal, repository } = workspace;
  await query(sql`UPDATE workspace_memberships SET role = 'owner'
    WHERE workspace_id = ${actor.workspaceId} AND user_id = ${actor.userId}`);
  const publicationId = randomUUID();
  const shared = await publishOntology(actor, {
    operationId: publicationId,
    expectedRevision: null,
    graph: scopedActionGraph("SHARED_PLANNED"),
  });
  const privateGraph = await publishOntology(personal, {
    operationId: publicationId,
    expectedRevision: null,
    graph: scopedActionGraph("PERSONAL_PLANNED"),
  });
  const sessionId = randomUUID();
  const callId = randomUUID();
  const operationId = workspaceOperationId(sessionId, callId);
  const action = OntologyActInputSchema.parse({
    operationId,
    expectedRevision: shared.revision,
    entityId: "project_one",
    actionId: "project_status",
    value: "SHARED_ACTIVE",
    sources: [],
    validTime: null,
  });
  await expect(applyOntologyAction(guest, action)).rejects.toMatchObject({
    name: "WorkspaceAccessDenied",
  });
  const changed = await applyOntologyAction(actor, action);
  expect(
    await applyOntologyAction(actor, {
      ...action,
      operationId: workspaceOperationId(sessionId, callId),
    })
  ).toEqual(changed);
  expect(await readOntology(actor)).toMatchObject({
    revision: changed.revision,
    graph: scopedActionGraph("SHARED_ACTIVE"),
  });
  expect(await readOntology(personal)).toMatchObject({
    revision: privateGraph.revision,
    graph: scopedActionGraph("PERSONAL_PLANNED"),
  });
  const receipt = {
    workspaceId: actor.workspaceId,
    revision: changed.revision,
    parent: shared.revision,
    operationId,
    author: actor.userId,
    source: "ontology",
  };
  expect(
    await query(sql`SELECT workspace_id AS "workspaceId", revision,
      parent_revision AS parent, operation_id AS "operationId",
      author_user_id AS author, source FROM workspace_revision
      WHERE workspace_id = ${actor.workspaceId} AND operation_id = ${operationId}`)
  ).toEqual([receipt]);
  await expect(
    applyOntologyAction(actor, { ...action, value: "TAMPERED_REPLAY" })
  ).rejects.toMatchObject({ reason: "conflict" });
  const nextCallOperationId = workspaceOperationId(sessionId, randomUUID());
  const nextSessionOperationId = workspaceOperationId(randomUUID(), callId);
  expect(nextCallOperationId).not.toBe(operationId);
  expect(nextSessionOperationId).not.toBe(operationId);
  await expect(
    applyOntologyAction(actor, { ...action, operationId: nextCallOperationId })
  ).rejects.toMatchObject({ reason: "conflict" });
  expect(await repository.history(actor, ontologyPath)).toHaveLength(2);
  expect(await repository.currentRevision(actor)).toBe(changed.revision);

  const advanced = await repository.write(actor, {
    operationId: randomUUID(),
    expectedRevision: changed.revision,
    path: "knowledge/after-action.md",
    content: "Shared repository head advanced without changing the ontology.",
  });
  expect(await applyOntologyAction(actor, action)).toEqual(changed);
  expect(await repository.currentRevision(actor)).toBe(advanced.revision);
  await expect(
    applyOntologyAction(actor, {
      ...action,
      operationId: nextSessionOperationId,
      expectedRevision: changed.revision,
    })
  ).rejects.toMatchObject({ reason: "conflict" });

  const personalAction = OntologyActInputSchema.parse({
    ...action,
    expectedRevision: privateGraph.revision,
    value: "PERSONAL_ACTIVE",
  });
  const privateChanged = await applyOntologyAction(personal, personalAction);
  expect(await applyOntologyAction(personal, personalAction)).toEqual(
    privateChanged
  );
  expect(await readOntology(personal)).toMatchObject({
    revision: privateChanged.revision,
    graph: scopedActionGraph("PERSONAL_ACTIVE"),
  });
  expect(await readOntology(actor)).toMatchObject({
    revision: advanced.revision,
    graph: scopedActionGraph("SHARED_ACTIVE"),
  });
  await expect(
    applyOntologyAction(actor, {
      ...action,
      operationId: randomUUID(),
      expectedRevision: privateChanged.revision,
    })
  ).rejects.toMatchObject({ reason: "not_found" });
  await expect(
    applyOntologyAction(personal, {
      ...personalAction,
      operationId: randomUUID(),
      expectedRevision: advanced.revision,
    })
  ).rejects.toMatchObject({ reason: "not_found" });
  const receipts =
    await query(sql`SELECT workspace_id AS "workspaceId", revision,
    parent_revision AS parent, operation_id AS "operationId",
    author_user_id AS author, source FROM workspace_revision
    WHERE operation_id = ${operationId}
      AND workspace_id IN (${actor.workspaceId}, ${personal.workspaceId})`);
  expect(receipts).toHaveLength(2);
  expect(receipts).toEqual(
    expect.arrayContaining([
      receipt,
      {
        ...receipt,
        workspaceId: personal.workspaceId,
        revision: privateChanged.revision,
        parent: privateGraph.revision,
      },
    ])
  );
  const sharedHistory = await repository.history(actor, ontologyPath);
  const personalHistory = await repository.history(personal, ontologyPath);
  expect(sharedHistory).toHaveLength(2);
  expect(personalHistory).toHaveLength(2);

  await query(sql`UPDATE workspace_memberships SET role = 'member'
    WHERE workspace_id = ${actor.workspaceId} AND user_id = ${actor.userId}`);
  expect((await readOntology(actor)).mayManage).toBe(false);
  await expect(applyOntologyAction(actor, action)).rejects.toMatchObject({
    name: "WorkspaceAccessDenied",
  });
  await expect(
    applyOntologyAction(actor, {
      ...action,
      operationId: randomUUID(),
      expectedRevision: advanced.revision,
      value: "DENIED_AFTER_DOWNGRADE",
    })
  ).rejects.toMatchObject({ name: "WorkspaceAccessDenied" });
  expect(await applyOntologyAction(personal, personalAction)).toEqual(
    privateChanged
  );
  expect(await repository.currentRevision(actor)).toBe(advanced.revision);
  expect(await repository.currentRevision(personal)).toBe(
    privateChanged.revision
  );
  expect((await readOntology(actor)).graph).toEqual(
    scopedActionGraph("SHARED_ACTIVE")
  );
  expect((await readOntology(personal)).graph).toEqual(
    scopedActionGraph("PERSONAL_ACTIVE")
  );
  expect(await repository.history(actor, ontologyPath)).toEqual(sharedHistory);
  expect(await repository.history(personal, ontologyPath)).toEqual(
    personalHistory
  );
  expect(
    await query(sql`SELECT workspace_id AS "workspaceId", revision,
      parent_revision AS parent, operation_id AS "operationId",
      author_user_id AS author, source FROM workspace_revision
      WHERE workspace_id = ${actor.workspaceId} AND operation_id = ${operationId}`)
  ).toEqual([receipt]);
});
