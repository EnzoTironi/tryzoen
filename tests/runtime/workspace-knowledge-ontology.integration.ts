import { randomUUID } from "node:crypto";
import { expect, test } from "vitest";
import { emptyOntology, ontologyPath } from "@zoen/companion-ui/ontology";
import { WorkspaceAccessDenied } from "../../server/workspaces/access";
import { OntologyInvalid } from "../../server/workspaces/ontology-validation";
import { readOntology } from "../../server/workspaces/ontology";
import {
  proposeKnowledge,
  readKnowledgeProposal,
  reviewKnowledgeProposal,
} from "../../server/workspaces/knowledge";
import { callNativeTool } from "../helpers/native-tools";
import { workspaceExecutionFor, workspaceFixture } from "./workspace-fixture";

const evidence = [
  {
    kind: "link" as const,
    url: "https://example.com/synthetic",
    title: "Synthetic plan",
    excerpt: "Review the project and its related tasks.",
  },
];

function graphAt(revision: string, excerpt = "Project is active.") {
  const source = { path: "knowledge/project.md", revision, excerpt };
  return {
    ...emptyOntology,
    entities: [
      {
        id: "project_one",
        type: "project",
        name: "Project one",
        properties: {
          status: {
            value: "active",
            sources: [source],
            validTime: { from: "2026-09-01", until: "2026-10-01" },
          },
        },
        sources: [],
      },
      {
        id: "task_one",
        type: "task",
        name: "Review assets",
        properties: {},
        sources: [],
      },
    ],
    links: [
      {
        type: "part_of",
        from: "task_one",
        to: "project_one",
        sources: [source],
        validTime: null,
      },
    ],
  };
}

test("native ontology proposals publish with their definitions once after administrator review", async () => {
  await using fixture = await workspaceFixture();
  const { actor, guest, repository } = fixture;
  const source = await repository.write(actor, {
    operationId: randomUUID(),
    expectedRevision: null,
    path: "knowledge/project.md",
    content: "Project is active.",
  });
  const graph = graphAt(source.revision);
  const input = {
    expectedRevision: source.revision,
    title: "Connect the project and its task",
    summary: "Keep meaning and records together.",
    evidence,
    dependencies: [],
    changes: [
      { path: ontologyPath, content: JSON.stringify(graph) },
      {
        path: "knowledge/definitions/project.md",
        content: "# Project\nContains tasks.",
      },
    ],
  };
  const execution = workspaceExecutionFor(guest);
  const proposed = await callNativeTool(
    execution,
    "workspace-knowledge-propose",
    input
  );
  expect(
    await callNativeTool(execution, "workspace-knowledge-propose", input)
  ).toEqual(proposed);
  const listing = await repository.read(actor);
  const path = listing.files.find((filename) =>
    filename.startsWith("proposals/knowledge/")
  );
  if (!path) throw new Error("Missing proposal");
  expect(listing.files).not.toContain(ontologyPath);
  const review = await readKnowledgeProposal(actor, path);
  expect(review.conflicts).toEqual([]);
  const approval = {
    proposal: path,
    expectedRevision: review.revision,
    operationId: randomUUID(),
    decision: "approve" as const,
  };
  await expect(reviewKnowledgeProposal(guest, approval)).rejects.toBeInstanceOf(
    WorkspaceAccessDenied
  );
  await expect(
    repository.publish(actor, {
      operationId: randomUUID(),
      expectedRevision: listing.revision,
      changes: input.changes,
    })
  ).rejects.toBeInstanceOf(WorkspaceAccessDenied);
  const published = await reviewKnowledgeProposal(actor, approval);
  expect(await reviewKnowledgeProposal(actor, approval)).toEqual(published);
  expect((await readOntology(guest)).graph).toEqual(graph);
  for (const change of input.changes) {
    expect((await repository.history(actor, change.path))[0]).toMatchObject({
      revision: published.revision,
    });
  }
  expect((await repository.read(actor)).files).not.toContain(path);
});

test("all graph citations participate in stale-source checks even when omitted from proposal evidence", async () => {
  await using fixture = await workspaceFixture();
  const { actor, guest, repository } = fixture;
  const source = await repository.write(actor, {
    operationId: randomUUID(),
    expectedRevision: null,
    path: "knowledge/project.md",
    content: "Project is active.",
  });
  const proposed = await proposeKnowledge(guest, {
    operationId: randomUUID(),
    expectedRevision: source.revision,
    title: "Connect project",
    summary: "Derived from its source.",
    evidence,
    dependencies: [],
    changes: [
      { path: ontologyPath, content: JSON.stringify(graphAt(source.revision)) },
    ],
  });
  const edited = await repository.write(guest, {
    operationId: randomUUID(),
    expectedRevision: proposed.revision,
    path: "knowledge/project.md",
    content: "Project was cancelled.",
  });
  const review = await readKnowledgeProposal(actor, proposed.path);
  expect(review.conflicts).toEqual(["knowledge/project.md"]);
  await expect(
    reviewKnowledgeProposal(actor, {
      proposal: proposed.path,
      expectedRevision: review.revision,
      operationId: randomUUID(),
      decision: "approve",
    })
  ).rejects.toMatchObject({ reason: "conflict" });
  expect((await repository.read(actor)).revision).toBe(edited.revision);
  expect((await readOntology(actor)).graph.entities).toEqual([]);
});

test("draft validation denies forged, foreign or invalid ontology sources and disabled capabilities", async () => {
  await using fixture = await workspaceFixture();
  const { actor, guest, personal, repository } = fixture;
  const source = await repository.write(actor, {
    operationId: randomUUID(),
    expectedRevision: null,
    path: "knowledge/project.md",
    content: "Project is active.",
  });
  const foreign = await repository.write(personal, {
    operationId: randomUUID(),
    expectedRevision: null,
    path: "knowledge/project.md",
    content: "Project is active.",
  });
  const propose = (graph: ReturnType<typeof graphAt>) =>
    proposeKnowledge(guest, {
      operationId: randomUUID(),
      expectedRevision: source.revision,
      title: "Invalid candidate",
      summary: "Must never be published.",
      evidence,
      dependencies: [],
      changes: [{ path: ontologyPath, content: JSON.stringify(graph) }],
    });
  await expect(
    propose(graphAt(source.revision, "Forged passage"))
  ).rejects.toBeInstanceOf(OntologyInvalid);
  await expect(propose(graphAt(foreign.revision))).rejects.toMatchObject({
    reason: "not_found",
  });
  const invalid = graphAt(source.revision);
  invalid.links[0] = {
    ...invalid.links[0],
    from: "nonexistent",
    type: "part_of",
    to: "project_one",
    sources: [],
    validTime: null,
  };
  await expect(propose(invalid)).rejects.toMatchObject({ reason: "link" });
  const disabled = await repository.write(actor, {
    operationId: randomUUID(),
    expectedRevision: source.revision,
    path: "plugins/workspace.json",
    content: JSON.stringify({ version: 1, enabled: ["files"] }),
  });
  await expect(
    callNativeTool(
      workspaceExecutionFor(actor),
      "workspace-knowledge-propose",
      {
        expectedRevision: disabled.revision,
        title: "Disabled ontology",
        summary: "Cannot run.",
        evidence,
        dependencies: [],
        changes: [
          {
            path: ontologyPath,
            content: JSON.stringify(graphAt(source.revision)),
          },
        ],
      }
    )
  ).rejects.toBeInstanceOf(WorkspaceAccessDenied);
  expect((await repository.read(actor)).files).toEqual([
    "knowledge/project.md",
    "plugins/workspace.json",
  ]);
});
