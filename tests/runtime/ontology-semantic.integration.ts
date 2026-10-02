import { emptyOntology, OntologySchema } from "@zoen/companion-ui/ontology";
import type { WorkspaceChangesSchema } from "@zoen/companion-ui/workspace-files";
import { createHash, randomUUID } from "node:crypto";
import { expect, test } from "vitest";
import type { z } from "zod";
import {
  applyOntologyAction,
  publishOntology,
  readOntology,
} from "../../server/workspaces/ontology";
import { executePublishedSemanticQuery } from "../../server/workspaces/semantic/published";
import {
  SemanticDefinitionSchema,
  SemanticQuerySchema,
} from "../../server/workspaces/semantic/schema";
import { workspaceFixture } from "./workspace-fixture";

test("an ontology-only head change invalidates a query until rediscovery while preserving its bytes, total and source hashes", async () => {
  await using workspace = await workspaceFixture();
  const { actor, guest, repository } = workspace;
  const ontology = await publishOntology(actor, {
    operationId: randomUUID(),
    expectedRevision: null,
    graph: OntologySchema.parse({
      ...emptyOntology,
      entities: [
        {
          id: "project_one",
          type: "project",
          name: "Semantic head regression project",
          properties: {
            status: { value: "planned", sources: [], validTime: null },
          },
          sources: [],
        },
      ],
    }),
  });
  const path = "knowledge/queries/total.json";
  const definition = SemanticDefinitionSchema.parse({
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
  });
  const changes = [
    { path: "knowledge/data/items.csv", content: "amount\n10\n20\n" },
    {
      path: definition.model,
      content:
        "source: items is snapshot.table('public.items')\nquery: total is items -> { aggregate: total is amount.sum() }",
    },
    { path, content: JSON.stringify(definition) },
  ] satisfies z.output<typeof WorkspaceChangesSchema>;
  const published = await repository.publish(actor, {
    operationId: randomUUID(),
    expectedRevision: ontology.revision,
    changes,
  });
  const paths = changes.map((change) => change.path);
  const captured = await repository.selection(guest, paths);
  expect(captured.revision).toBe(published.revision);
  expect(captured.documents).toEqual(changes);
  const input = SemanticQuerySchema.parse({
    path,
    revision: published.revision,
    arguments: {},
  });
  const first = await executePublishedSemanticQuery(guest, input);
  expect(first.rows).toEqual([{ total: 30 }]);
  expect(first.manifest.revision).toBe(published.revision);
  expect(first.manifest.sources).toHaveLength(changes.length);
  expect(first.manifest.sources).toEqual(
    expect.arrayContaining(
      changes.map((change) => ({
        path: change.path,
        sha256: createHash("sha256").update(change.content).digest("hex"),
      }))
    )
  );

  const changed = await applyOntologyAction(actor, {
    operationId: randomUUID(),
    expectedRevision: published.revision,
    entityId: "project_one",
    actionId: "project_status",
    value: "active",
    sources: [],
    validTime: null,
  });
  expect(changed.revision).not.toBe(published.revision);
  expect(
    (await readOntology(guest)).graph.entities[0]?.properties.status
  ).toEqual({ value: "active", sources: [], validTime: null });
  await expect(executePublishedSemanticQuery(guest, input)).rejects.toThrow(
    "Published query is unavailable or changed; discover it again"
  );

  const rediscovered = await repository.selection(guest, paths);
  expect(rediscovered.revision).toBe(changed.revision);
  expect(rediscovered.documents).toEqual(captured.documents);
  const refreshed = await executePublishedSemanticQuery(
    guest,
    SemanticQuerySchema.parse({ ...input, revision: rediscovered.revision })
  );
  expect(refreshed.rows).toEqual([{ total: 30 }]);
  expect(refreshed.manifest).toMatchObject({
    revision: changed.revision,
    actor: guest.userId,
    workspaceId: actor.workspaceId,
    query: path,
  });
  expect(refreshed.manifest.sources).toEqual(first.manifest.sources);
  expect(await repository.currentRevision(guest)).toBe(changed.revision);
}, 30000);
