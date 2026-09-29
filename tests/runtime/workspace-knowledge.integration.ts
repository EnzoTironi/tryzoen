import { randomUUID } from "node:crypto";
import { expect, test } from "vitest";
import { sql } from "drizzle-orm";
import { query } from "@db/queries";
import { WorkspaceAccessDenied } from "../../server/workspaces/access";
import {
  proposeKnowledge,
  readKnowledgeProposal,
  listKnowledgeProposals,
  reviewKnowledgeProposal,
  discoverKnowledge,
} from "../../server/workspaces/knowledge";
import { knowledgeRoutingPath } from "@zoen/companion-ui/knowledge";
import { callNativeTool } from "../helpers/native-tools";
import { workspaceExecutionFor, workspaceFixture } from "./workspace-fixture";

const evidence = [
  {
    kind: "link" as const,
    url: "https://example.com/definition",
    title: "Synthetic reference",
    excerpt: "Budgets are planned amounts, not expenses.",
  },
];

test("discovery loads published canonical files at one revision and retains record identity across a file move", async () => {
  await using fixture = await workspaceFixture();
  const { actor, guest, personal, repository } = fixture;
  const id = randomUUID();
  const budgetPath = "knowledge/definitions/budget.md";
  const definition = "A budget is planned before work begins.";
  const routing = {
    version: 1,
    records: [
      {
        id,
        title: "Project budget",
        summary: "Planned amounts, separate from expenses",
        terms: ["budget", "spending"],
        paths: [budgetPath],
      },
    ],
  };
  const initial = await repository.publish(actor, {
    operationId: randomUUID(),
    expectedRevision: null,
    changes: [
      {
        path: "knowledge/purpose.md",
        content: "Plan a project before committing money.",
      },
      {
        path: budgetPath,
        content: definition,
      },
      { path: knowledgeRoutingPath, content: JSON.stringify(routing) },
    ],
  });
  const execution = workspaceExecutionFor(guest);
  const discovery = await callNativeTool(
    execution,
    "workspace_knowledge_discover",
    { query: "budget" }
  );
  expect(discovery).toMatchObject({
    revision: initial.revision,
    records: [{ id }],
    documents: [],
  });
  const loaded = await discoverKnowledge(guest, { ids: [id] });
  expect(loaded.documents).toEqual([
    {
      path: budgetPath,
      content: definition,
      nextOffset: null,
    },
  ]);
  expect((await discoverKnowledge(personal, { ids: [id] })).records).toEqual(
    []
  );
  await expect(
    repository.write(actor, {
      operationId: randomUUID(),
      expectedRevision: initial.revision,
      path: budgetPath,
      content: null,
    })
  ).rejects.toMatchObject({ reason: "invalid_input" });
  expect((await repository.read(actor)).revision).toBe(initial.revision);
  const renamed = "knowledge/definitions/project-budget.md";
  const moved = await repository.publish(actor, {
    operationId: randomUUID(),
    expectedRevision: initial.revision,
    changes: [
      { path: budgetPath, content: null },
      { path: renamed, content: definition },
      {
        path: knowledgeRoutingPath,
        content: JSON.stringify({
          ...routing,
          records: [{ ...routing.records[0], paths: [renamed] }],
        }),
      },
    ],
  });
  const current = await discoverKnowledge(guest, { ids: [id] });
  expect(current.revision).toBe(moved.revision);
  expect(current.records[0]).toMatchObject({ id, paths: [renamed] });
  expect(
    (await repository.read(actor, knowledgeRoutingPath, initial.revision))
      .content
  ).toBe(JSON.stringify(routing));
  await query(
    sql`DELETE FROM workspace_memberships WHERE workspace_id = ${actor.workspaceId} AND user_id = ${guest.userId}`
  );
  await expect(discoverKnowledge(guest, { ids: [id] })).rejects.toBeInstanceOf(
    WorkspaceAccessDenied
  );
});

test("routing rejects invalid or missing references and discovery stays bounded without creating knowledge", async () => {
  await using fixture = await workspaceFixture();
  const { actor, repository } = fixture;
  const projectPath = "knowledge/definitions/projects.md";
  const record = {
    id: randomUUID(),
    title: "Projects",
    summary: "Synthetic scope",
    terms: ["projects"],
    paths: [projectPath],
  };
  await expect(
    repository.write(actor, {
      operationId: randomUUID(),
      expectedRevision: null,
      path: knowledgeRoutingPath,
      content: JSON.stringify({ version: 1, records: [record] }),
    })
  ).rejects.toMatchObject({ reason: "invalid_input" });
  await expect(
    repository.publish(actor, {
      operationId: randomUUID(),
      expectedRevision: null,
      changes: [
        { path: projectPath, content: "A" },
        {
          path: knowledgeRoutingPath,
          content: JSON.stringify({ version: 1, records: [record, record] }),
        },
      ],
    })
  ).rejects.toThrow(Error);
  const long = "a".repeat(5000);
  const firstId = randomUUID();
  const records = Array.from({ length: 20 }, (_, index) => ({
    ...record,
    id: index === 0 ? firstId : randomUUID(),
    title: `Project ${index}`,
    terms: [index === 19 ? "specific" : "ordinary"],
  }));
  const initial = await repository.publish(actor, {
    operationId: randomUUID(),
    expectedRevision: null,
    changes: [
      { path: projectPath, content: long },
      {
        path: knowledgeRoutingPath,
        content: JSON.stringify({ version: 1, records }),
      },
    ],
  });
  expect(await discoverKnowledge(actor, {})).toMatchObject({
    more: true,
    records: Array(12).fill(expect.anything()),
    documents: [],
  });
  expect(
    (await discoverKnowledge(actor, { query: "specific" })).records
  ).toHaveLength(1);
  const loaded = await discoverKnowledge(actor, {
    ids: [firstId, randomUUID()],
  });
  expect(loaded.records).toHaveLength(1);
  expect(loaded.documents).toEqual([
    { path: projectPath, content: long.slice(0, 4000), nextOffset: 4000 },
  ]);
  expect((await repository.read(actor)).revision).toBe(initial.revision);
});

test("publishes an evidenced multi-file proposal once, with atomic history and no cross-workspace access", async () => {
  await using fixture = await workspaceFixture();
  const { actor, guest, personal, repository } = fixture;
  await repository.write(personal, {
    operationId: randomUUID(),
    expectedRevision: null,
    path: "knowledge/private.md",
    content: "Private reference",
  });
  const initial = await repository.write(actor, {
    operationId: randomUUID(),
    expectedRevision: null,
    path: "knowledge/purpose.md",
    content: "# Studio\nPlan project budgets.",
  });
  const draft = {
    operationId: randomUUID(),
    expectedRevision: initial.revision,
    title: "Define project budgets",
    summary: "Keep the meaning and model aligned.",
    dependencies: ["knowledge/purpose.md"],
    evidence: [
      ...evidence,
      {
        kind: "file" as const,
        path: "knowledge/purpose.md",
        revision: initial.revision,
        excerpt: "Plan project budgets.",
      },
    ],
    changes: [
      {
        path: "knowledge/definitions/budget.md",
        content: "# Budget\nA planned amount per project.",
      },
      {
        path: "knowledge/models/budget.malloy",
        content:
          "source: projects is postgres.table('projects') extend { primary_key: id }\n",
      },
    ],
  };
  const proposed = await proposeKnowledge(guest, draft);
  expect(await proposeKnowledge(guest, draft)).toEqual(proposed);
  expect((await repository.read(actor)).files).not.toContain(
    draft.changes[0]?.path
  );
  expect((await listKnowledgeProposals(guest)).canReview).toBe(false);
  await expect(
    repository.read(personal, proposed.path, proposed.revision)
  ).rejects.toMatchObject({ reason: "not_found" });
  await expect(
    repository.write(guest, {
      operationId: randomUUID(),
      expectedRevision: proposed.revision,
      path: proposed.path,
      content: null,
    })
  ).rejects.toBeInstanceOf(WorkspaceAccessDenied);
  const preview = await readKnowledgeProposal(actor, proposed.path);
  expect(preview.conflicts).toEqual([]);
  expect(preview.changes.map((change) => change.before)).toEqual([null, null]);
  const approve = {
    proposal: proposed.path,
    expectedRevision: preview.revision,
    operationId: randomUUID(),
    decision: "approve" as const,
  };
  await expect(reviewKnowledgeProposal(guest, approve)).rejects.toBeInstanceOf(
    WorkspaceAccessDenied
  );
  const published = await reviewKnowledgeProposal(actor, approve);
  expect(await reviewKnowledgeProposal(actor, approve)).toEqual(published);
  expect((await repository.read(actor)).files).toEqual(
    draft.changes
      .map(({ path }) => path)
      .concat("knowledge/purpose.md")
      .toSorted()
  );
  for (const change of draft.changes) {
    expect((await repository.read(actor, change.path)).content).toBe(
      change.content
    );
    expect(await repository.history(actor, change.path)).toMatchObject([
      { revision: published.revision, source: "knowledge-publication" },
    ]);
  }
  expect(
    (await repository.read(actor, proposed.path, preview.revision)).content
  ).toContain("Define project budgets");
  expect((await listKnowledgeProposals(actor)).items).toEqual([]);
  expect(
    await query(
      sql`SELECT count(*)::int AS n FROM workspace_revision WHERE workspace_id = ${actor.workspaceId} AND operation_id = ${approve.operationId}`
    )
  ).toEqual([{ n: 1 }]);
});

test("source edits and concurrent reviews never partially publish; rejecting preserves source files", async () => {
  await using fixture = await workspaceFixture();
  const { actor, guest, repository } = fixture;
  const first = await repository.write(actor, {
    operationId: randomUUID(),
    expectedRevision: null,
    path: "knowledge/source.md",
    content: "Original",
  });
  const proposed = await proposeKnowledge(actor, {
    operationId: randomUUID(),
    expectedRevision: first.revision,
    title: "Refine definition",
    summary: "Two related files",
    evidence,
    dependencies: ["knowledge/source.md"],
    changes: [
      { path: "knowledge/meaning.md", content: "New definition" },
      { path: "knowledge/guide.md", content: "New guide" },
    ],
  });
  await repository.write(guest, {
    operationId: randomUUID(),
    expectedRevision: proposed.revision,
    path: "knowledge/source.md",
    content: "Changed by teammate",
  });
  const preview = await readKnowledgeProposal(actor, proposed.path);
  expect(preview.conflicts).toEqual(["knowledge/source.md"]);
  await expect(
    reviewKnowledgeProposal(actor, {
      proposal: proposed.path,
      expectedRevision: preview.revision,
      operationId: randomUUID(),
      decision: "approve",
    })
  ).rejects.toMatchObject({ reason: "conflict" });
  const reject = {
    proposal: proposed.path,
    expectedRevision: preview.revision,
    operationId: randomUUID(),
    decision: "reject" as const,
  };
  const rejected = await reviewKnowledgeProposal(actor, reject);
  expect(await reviewKnowledgeProposal(actor, reject)).toEqual(rejected);
  expect((await repository.read(actor)).files).toEqual(["knowledge/source.md"]);
  const next = await proposeKnowledge(actor, {
    operationId: randomUUID(),
    expectedRevision: rejected.revision,
    title: "Two new files",
    summary: "Publish together",
    evidence,
    dependencies: [],
    changes: [
      { path: "knowledge/one.md", content: "One" },
      { path: "knowledge/two.md", content: "Two" },
    ],
  });
  const outcomes = await Promise.allSettled(
    (["approve", "reject"] as const).map((decision) =>
      reviewKnowledgeProposal(actor, {
        proposal: next.path,
        expectedRevision: next.revision,
        operationId: randomUUID(),
        decision,
      })
    )
  );
  expect(
    outcomes.filter((result) => result.status === "fulfilled")
  ).toHaveLength(1);
  const files = (await repository.read(actor)).files;
  expect(files.includes("knowledge/one.md")).toBe(
    files.includes("knowledge/two.md")
  );
});

test("a batch validates all changes before publishing and rechecks membership on every decision", async () => {
  await using fixture = await workspaceFixture();
  const { actor, guest, repository } = fixture;
  const input = {
    operationId: randomUUID(),
    expectedRevision: null,
    changes: [
      { path: "knowledge/a.md", content: "Valid" },
      { path: "knowledge/a.md", content: "Duplicate" },
    ],
  };
  await expect(repository.publish(actor, input)).rejects.toMatchObject({
    reason: "invalid_input",
  });
  await expect(
    repository.publish(guest, {
      ...input,
      changes: [
        { path: "knowledge/a.md", content: "Valid" },
        { path: "agent/SOUL.md", content: "Forbidden" },
      ],
    })
  ).rejects.toBeInstanceOf(WorkspaceAccessDenied);
  expect((await repository.read(actor)).files).toEqual([]);
  await expect(
    repository.write(
      actor,
      {
        operationId: randomUUID(),
        expectedRevision: null,
        path: "knowledge/models/unreviewed.malloy",
        content: "source: unreviewed is postgres.table('projects')",
      },
      { kind: "agent" }
    )
  ).rejects.toBeInstanceOf(WorkspaceAccessDenied);
  const proposed = await proposeKnowledge(guest, {
    operationId: randomUUID(),
    expectedRevision: null,
    title: "New definition",
    summary: "Proposed by member",
    evidence,
    dependencies: [],
    changes: [{ path: "knowledge/a.md", content: "Valid" }],
  });
  await query(
    sql`DELETE FROM workspace_memberships WHERE user_id = ${guest.userId} AND workspace_id = ${actor.workspaceId}`
  );
  await expect(
    readKnowledgeProposal(guest, proposed.path)
  ).rejects.toBeInstanceOf(WorkspaceAccessDenied);
  await expect(listKnowledgeProposals(guest)).rejects.toBeInstanceOf(
    WorkspaceAccessDenied
  );
  expect((await repository.read(actor)).files).toEqual([proposed.path]);
});

test("the native agent can propose canonical knowledge but cannot publish it through the document save tool", async () => {
  await using fixture = await workspaceFixture();
  const { actor, repository } = fixture;
  const execution = workspaceExecutionFor(actor);
  const input = {
    expectedRevision: null,
    title: "Native proposal",
    summary: "Review an analysis definition and source together",
    evidence,
    dependencies: [],
    changes: [
      {
        path: "knowledge/definitions/project.md",
        content: "# Project\nOne record per project.",
      },
      {
        path: "knowledge/models/project.malloy",
        content: "source: projects is postgres.table('projects')",
      },
    ],
  };
  const staged = await callNativeTool(
    execution,
    "workspace-knowledge-propose",
    input
  );
  expect(
    await callNativeTool(execution, "workspace-knowledge-propose", input)
  ).toEqual(staged);
  expect((await listKnowledgeProposals(actor)).items[0]?.title).toBe(
    input.title
  );
  const listing = await repository.read(actor);
  expect(listing.files).toHaveLength(1);
  expect(listing.files[0]).toMatch(/^proposals\/knowledge\//u);
  await expect(
    callNativeTool(workspaceExecutionFor(actor), "workspace-save", {
      path: input.changes[0]?.path,
      expectedRevision: listing.revision,
      content: "Bypass",
    })
  ).rejects.toThrow(Error);
  expect((await repository.read(actor)).files).toEqual(listing.files);
});
