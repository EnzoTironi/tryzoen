import { randomUUID } from "node:crypto";
import { query, transaction } from "@db/queries";
import { sql } from "drizzle-orm";
import { expect, test } from "vitest";
import { emptyOntology, OntologyReadSchema } from "@zoen/companion-ui/ontology";
import {
  publishOntology,
  readOntology,
} from "../../server/workspaces/ontology";
import { invokeWorkspaceTool } from "../../server/tools/workspace";
import { workspaceFixture } from "./workspace-fixture";

test("recorded as-of and world-valid time are independent, scoped and read-only in the native ontology tool", async () => {
  await using workspace = await workspaceFixture();
  const { actor, guest, personal, repository } = workspace;
  const source = await repository.write(actor, {
    operationId: randomUUID(),
    expectedRevision: null,
    path: "knowledge/launch.md",
    content: "Launch is active from 2026-09-01 until 2026-10-01.",
  });
  const graph = {
    ...emptyOntology,
    entities: [
      {
        id: "launch",
        type: "project",
        name: "Launch",
        properties: {
          status: {
            value: "active",
            sources: [
              {
                path: "knowledge/launch.md",
                revision: source.revision,
                excerpt: "active from 2026-09-01 until 2026-10-01",
              },
            ],
            validTime: { from: "2026-09-01", until: "2026-10-01" },
          },
        },
        sources: [],
      },
    ],
  };
  const saved = await publishOntology(actor, {
    operationId: randomUUID(),
    expectedRevision: source.revision,
    graph,
  });
  const timestamps = await query<{ asOf: string }>(
    sql`SELECT to_char(created_at AT TIME ZONE 'UTC', 'YYYY-MM-DD"T"HH24:MI:SS.US"Z"') AS "asOf"
      FROM workspace_revision WHERE workspace_id = ${actor.workspaceId} AND revision = ${saved.revision}`
  );
  const asOf = timestamps[0]?.asOf;
  if (!asOf) throw new Error("Missing recorded publication time");
  const initial = graph.entities[0];
  if (!initial) throw new Error("Missing fixture record");
  const corrected = await publishOntology(actor, {
    operationId: randomUUID(),
    expectedRevision: saved.revision,
    graph: {
      ...graph,
      entities: [
        {
          ...initial,
          name: "Corrected launch",
          properties: {
            status: { value: "archived", sources: [], validTime: null },
          },
        },
      ],
    },
  });
  const historic = await invokeWorkspaceTool(guest, {
    path: "workspace_ontology_read",
    args: { asOf, validOn: "2026-09-15" },
  });
  expect(historic).toMatchObject({
    revision: saved.revision,
    asOf,
    validOn: "2026-09-15",
    sourceCheckedAtRevision: corrected.revision,
    graph: {
      actions: [],
      entities: [
        {
          id: "launch",
          name: "Launch",
          properties: { status: { value: "active" } },
        },
      ],
    },
  });
  expect((await readOntology(actor, { asOf })).mayManage).toBe(false);
  expect(
    (await readOntology(actor, { asOf, validOn: "2026-10-01" })).graph
      .entities[0]?.properties
  ).toEqual({});
  expect((await readOntology(actor)).graph.entities[0]?.name).toBe(
    "Corrected launch"
  );
  expect(
    await readOntology(actor, { asOf: "2000-01-01T00:00:00Z" })
  ).toMatchObject({
    revision: null,
    graph: { entities: [], actions: [] },
    mayManage: false,
  });
  expect((await readOntology(personal, { asOf })).graph.entities).toEqual([]);
  await expect(
    readOntology(actor, { asOf, revision: saved.revision })
  ).rejects.toThrow(/Choose a recorded revision/);
  expect(
    OntologyReadSchema.safeParse({ asOf: "2026-09-29T12:00:00" }).success
  ).toBe(false);
  expect(
    (await readOntology(actor, { asOf: asOf.replace("Z", "+00:00") })).revision
  ).toBe(saved.revision);
  await query(
    sql`DELETE FROM workspace_memberships WHERE workspace_id = ${actor.workspaceId} AND user_id = ${guest.userId}`
  );
  await expect(readOntology(guest, { asOf })).rejects.toMatchObject({
    _tag: "WorkspaceAccessDenied",
  });
});

test("publication time is captured after transaction admission and retries retain the same recorded instant", async () => {
  await using workspace = await workspaceFixture();
  const { actor, repository } = workspace;
  await transaction(async () => {
    const clock = await query<{ admitted: string }>(
      sql`SELECT to_char(transaction_timestamp() AT TIME ZONE 'UTC', 'YYYY-MM-DD"T"HH24:MI:SS.US"Z"') AS admitted`
    );
    const admitted = clock[0]?.admitted;
    if (!admitted) throw new Error("Missing transaction admission time");
    const input = {
      operationId: randomUUID(),
      expectedRevision: null,
      path: "knowledge/time.md",
      content: "Synthetic recorded-time evidence.",
    };
    const saved = await repository.write(actor, input);
    const receipt = await query<{
      publishedAfterAdmission: boolean;
      recorded: string;
    }>(
      sql`SELECT created_at > ${admitted}::timestamptz AS "publishedAfterAdmission", created_at::text AS recorded
        FROM workspace_revision WHERE workspace_id = ${actor.workspaceId} AND revision = ${saved.revision}`
    );
    expect(receipt[0]?.publishedAfterAdmission).toBe(true);
    expect(await repository.write(actor, input)).toEqual(saved);
    const repeated = await query<{ recorded: string }>(
      sql`SELECT created_at::text AS recorded FROM workspace_revision
        WHERE workspace_id = ${actor.workspaceId} AND revision = ${saved.revision}`
    );
    expect(repeated[0]?.recorded).toBe(receipt[0]?.recorded);
    // Simulate a backwards clock: the next receipt must still follow its parent.
    const movedClock = await query<{ asOf: string }>(
      sql`UPDATE workspace_revision SET created_at = clock_timestamp() + interval '1 hour'
        WHERE workspace_id = ${actor.workspaceId} AND revision = ${saved.revision}
        RETURNING to_char(created_at AT TIME ZONE 'UTC', 'YYYY-MM-DD"T"HH24:MI:SS.US"Z"') AS "asOf"`
    );
    const asOf = movedClock[0]?.asOf;
    if (!asOf) throw new Error("Missing synthetic parent clock");
    const changed = await repository.write(actor, {
      ...input,
      operationId: randomUUID(),
      expectedRevision: saved.revision,
      content: "Later synthetic recorded-time evidence.",
    });
    const ordering = await query<{ followsParent: boolean }>(
      sql`SELECT created_at > ${asOf}::timestamptz AS "followsParent"
        FROM workspace_revision WHERE workspace_id = ${actor.workspaceId} AND revision = ${changed.revision}`
    );
    expect(ordering[0]?.followsParent).toBe(true);
    expect(
      await repository.selection(actor, [input.path], { asOf })
    ).toMatchObject({
      revision: saved.revision,
      documents: [{ content: input.content }],
    });
  });
});
