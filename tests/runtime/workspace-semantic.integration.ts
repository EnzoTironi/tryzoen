import { randomUUID } from "node:crypto";
import { query } from "@db/queries";
import { sql } from "drizzle-orm";
import { expect, test, vi } from "vitest";
import { callNativeTool } from "../helpers/native-tools";
import { workspaceExecutionFor, workspaceFixture } from "./workspace-fixture";

const path = "knowledge/queries/total.json";
const changes = [
  { path: "knowledge/data/items.csv", content: "amount\n10\n20\n" },
  {
    path: "knowledge/models/items.malloy",
    content:
      "source: items is snapshot.table('public.items')\nquery: total is items -> { aggregate: total is amount.sum() }",
  },
  {
    path,
    content: JSON.stringify({
      version: 1,
      model: "knowledge/models/items.malloy",
      query: "total",
      parameters: {},
      sources: [
        {
          name: "items",
          path: "knowledge/data/items.csv",
          columns: [{ name: "amount", type: "numeric" }],
        },
      ],
    }),
  },
];

test("native governed query uses published snapshots, exact revisions and current account authorization", async () => {
  await using workspace = await workspaceFixture();
  const { actor, guest, guestPersonal, repository } = workspace;
  const published = await repository.publish(actor, {
    operationId: randomUUID(),
    expectedRevision: null,
    changes,
  });
  const execution = workspaceExecutionFor(guest);
  const input = { path, revision: published.revision, arguments: {} };
  const value: unknown = await callNativeTool(
    execution,
    "workspace_knowledge_query",
    input
  );
  expect(value).toMatchObject({
    rows: [{ total: 30 }],
    manifest: {
      revision: published.revision,
      actor: guest.userId,
      workspaceId: actor.workspaceId,
      query: path,
      sources: [
        { path },
        { path: "knowledge/models/items.malloy" },
        { path: "knowledge/data/items.csv" },
      ],
    },
  });
  await expect(
    callNativeTool(
      workspaceExecutionFor(guestPersonal),
      "workspace_knowledge_query",
      input
    )
  ).rejects.toThrow("Published query is unavailable");
  await expect(
    callNativeTool(execution, "workspace_knowledge_query", {
      ...input,
      arguments: { extra: 1 },
    })
  ).rejects.toThrow("Query arguments do not match");
  const changed = await repository.publish(actor, {
    operationId: randomUUID(),
    expectedRevision: published.revision,
    changes: [{ path: "knowledge/data/items.csv", content: "amount\n7\n" }],
  });
  await expect(
    callNativeTool(execution, "workspace_knowledge_query", input)
  ).rejects.toThrow("Published query is unavailable");
  expect(
    await callNativeTool(execution, "workspace_knowledge_query", {
      ...input,
      revision: changed.revision,
    })
  ).toMatchObject({ rows: [{ total: 7 }] });
  await query(
    sql`DELETE FROM workspace_memberships WHERE workspace_id = ${actor.workspaceId} AND user_id = ${guest.userId}`
  );
  await expect(
    callNativeTool(execution, "workspace_knowledge_query", {
      ...input,
      revision: changed.revision,
    })
  ).rejects.toThrow("WorkspaceAccessDenied");
}, 30000);

test("revocation after source capture prevents the calculated answer and manifest from escaping", async () => {
  await using workspace = await workspaceFixture();
  const { actor, guest, repository } = workspace;
  const published = await repository.publish(actor, {
    operationId: randomUUID(),
    expectedRevision: null,
    changes,
  });
  const select = repository.selection.bind(repository);
  let revoked = false;
  const spy = vi
    .spyOn(repository, "selection")
    .mockImplementation(async (...args) => {
      const captured = await select(...args);
      if (
        !revoked &&
        args[0].userId === guest.userId &&
        captured.documents.some(
          (document) => document.path === "knowledge/data/items.csv"
        )
      ) {
        revoked = true;
        await query(
          sql`DELETE FROM workspace_memberships WHERE workspace_id = ${actor.workspaceId} AND user_id = ${guest.userId}`
        );
      }
      return captured;
    });
  try {
    await expect(
      callNativeTool(
        workspaceExecutionFor(guest),
        "workspace_knowledge_query",
        {
          path,
          revision: published.revision,
          arguments: {},
        }
      )
    ).rejects.toThrow("WorkspaceAccessDenied");
    expect(revoked).toBe(true);
  } finally {
    spy.mockRestore();
  }
}, 20000);

test("a publication change during calculation invalidates the answer and the next revision computes new facts", async () => {
  await using workspace = await workspaceFixture();
  const { actor, guest, repository } = workspace;
  const published = await repository.publish(actor, {
    operationId: randomUUID(),
    expectedRevision: null,
    changes,
  });
  const select = repository.selection.bind(repository);
  let changed: string | undefined;
  const spy = vi
    .spyOn(repository, "selection")
    .mockImplementation(async (...args) => {
      const captured = await select(...args);
      if (
        !changed &&
        args[0].userId === guest.userId &&
        captured.documents.some(
          (document) => document.path === "knowledge/data/items.csv"
        )
      ) {
        changed = (
          await repository.publish(actor, {
            operationId: randomUUID(),
            expectedRevision: published.revision,
            changes: [
              { path: "knowledge/data/items.csv", content: "amount\n7\n" },
            ],
          })
        ).revision;
      }
      return captured;
    });
  try {
    await expect(
      callNativeTool(
        workspaceExecutionFor(guest),
        "workspace_knowledge_query",
        {
          path,
          revision: published.revision,
          arguments: {},
        }
      )
    ).rejects.toThrow("WorkspaceAccessDenied");
    expect(changed).not.toBe(published.revision);
  } finally {
    spy.mockRestore();
  }
  expect(
    await callNativeTool(
      workspaceExecutionFor(guest),
      "workspace_knowledge_query",
      {
        path,
        revision: changed,
        arguments: {},
      }
    )
  ).toMatchObject({ rows: [{ total: 7 }], manifest: { revision: changed } });
}, 30000);

test("publication rejects broken analytic source references and prevents generic agent writes", async () => {
  await using workspace = await workspaceFixture();
  const { actor, repository } = workspace;
  await expect(
    repository.publish(actor, {
      operationId: randomUUID(),
      expectedRevision: null,
      changes: [changes[2]].filter((value) => value !== undefined),
    })
  ).rejects.toMatchObject({ reason: "invalid_input" });
  const published = await repository.publish(actor, {
    operationId: randomUUID(),
    expectedRevision: null,
    changes,
  });
  await expect(
    repository.publish(actor, {
      operationId: randomUUID(),
      expectedRevision: published.revision,
      changes: [{ path: "knowledge/data/items.csv", content: null }],
    })
  ).rejects.toMatchObject({ reason: "invalid_input" });
  await expect(
    repository.write(
      actor,
      {
        operationId: randomUUID(),
        expectedRevision: published.revision,
        path,
        content: changes[2]?.content ?? "",
      },
      { kind: "agent" }
    )
  ).rejects.toThrow("WorkspaceAccessDenied");
});
