import { randomUUID } from "node:crypto";
import { query } from "@db/queries";
import { sql } from "drizzle-orm";
import { expect, test } from "vitest";
import { saveCreatorEvaluation } from "../../server/creators/evaluation";
import {
  saveCreatorDraft,
  readCreatorDraft,
  CreatorDraftConflict,
  setCreatorDraftArchived,
} from "../../server/creators/drafts";
import {
  createCreatorPreview,
  claimCreatorPreview,
  finishCreatorPreview,
  exportCreatorPreview,
} from "../../server/creators/previews";
import { saveCreatorPreviewReview } from "../../server/creators/reviews";
import { WorkspaceAccessDenied } from "../../server/workspaces/access";
import { workspaceFixture } from "./workspace-fixture";

const content = {
  title: "Synthetic evaluation coach",
  description: "Fictional test",
  playbook: "Ask an open question.",
  examples: [],
};
const sample = {
  title: "Quiet reading group",
  question: "Invite a fictional quiet group to contribute.",
  criteria:
    "# Criteria\n\nAsk an open question. Never invent facts. Allow people to pass.",
};

test("evaluation cases are private, versioned separately from teaching, bounded and reject stale writes", async () => {
  await using workspace = await workspaceFixture();
  const draft = await saveCreatorDraft(workspace.actor, {
    id: randomUUID(),
    expectedRevision: null,
    content,
  });
  const testCase = { id: randomUUID(), ...sample };
  const input = {
    draftId: draft.id,
    expectedRevision: null,
    cases: [testCase],
  };
  for (const actor of [
    workspace.guest,
    workspace.personal,
    { ...workspace.guest, authSessionId: workspace.actor.authSessionId },
    { ...workspace.actor, authSessionId: undefined },
  ]) {
    await expect(saveCreatorEvaluation(actor, input)).rejects.toBeInstanceOf(
      WorkspaceAccessDenied
    );
  }
  const saved = await saveCreatorEvaluation(workspace.actor, input);
  expect(saved.content).toEqual(content);
  expect(saved.revision).toBe(draft.revision);
  expect(saved.evaluation?.cases).toEqual(input.cases);
  expect(await saveCreatorEvaluation(workspace.actor, input)).toEqual(saved);
  const competing = await Promise.allSettled(
    ["First edit", "Second edit"].map((title) =>
      saveCreatorEvaluation(workspace.actor, {
        ...input,
        expectedRevision: saved.evaluation?.revision ?? null,
        cases: [{ ...testCase, title }],
      })
    )
  );
  expect(competing.filter((item) => item.status === "fulfilled")).toHaveLength(
    1
  );
  expect(competing.filter((item) => item.status === "rejected")).toHaveLength(
    1
  );
  await expect(
    saveCreatorEvaluation(workspace.actor, input)
  ).rejects.toBeInstanceOf(CreatorDraftConflict);
  for (const cases of [
    Array.from({ length: 21 }, () => ({ id: randomUUID(), ...sample })),
    [testCase, testCase],
    [{ id: randomUUID(), ...sample, criteria: "c".repeat(4001) }],
  ]) {
    expect(() =>
      saveCreatorEvaluation(workspace.actor, { ...input, cases })
    ).toThrow(/Too big|Each evaluation case/);
  }
  await setCreatorDraftArchived(workspace.actor, {
    id: draft.id,
    expectedRevision: draft.revision,
    archived: true,
  });
  await expect(
    saveCreatorEvaluation(workspace.actor, input)
  ).rejects.toBeInstanceOf(CreatorDraftConflict);
});

test("a preview freezes the selected question and criteria, omits evaluation context from the child, and rejects changed review criteria", async () => {
  await using workspace = await workspaceFixture();
  const draft = await saveCreatorDraft(workspace.actor, {
    id: randomUUID(),
    expectedRevision: null,
    content,
  });
  const testCase = { id: randomUUID(), ...sample };
  const saved = await saveCreatorEvaluation(workspace.actor, {
    draftId: draft.id,
    expectedRevision: null,
    cases: [testCase],
  });
  if (!saved.evaluation) throw new Error("Expected evaluation cases");
  const request = {
    id: randomUUID(),
    draftId: draft.id,
    revision: draft.revision,
    question: testCase.question,
    caseRef: { id: testCase.id, revision: saved.evaluation.revision },
  };
  for (const invalid of [
    { ...request, question: "Swapped question" },
    { ...request, caseRef: { ...request.caseRef, revision: randomUUID() } },
    { ...request, caseRef: { ...request.caseRef, id: randomUUID() } },
  ])
    await expect(
      createCreatorPreview(workspace.actor, invalid)
    ).rejects.toBeInstanceOf(CreatorDraftConflict);
  const preview = await createCreatorPreview(workspace.actor, request);
  await saveCreatorEvaluation(workspace.actor, {
    draftId: draft.id,
    expectedRevision: saved.evaluation.revision,
    cases: [],
  });
  expect(await createCreatorPreview(workspace.actor, request)).toEqual(preview);
  await expect(
    createCreatorPreview(workspace.actor, { ...request, caseRef: undefined })
  ).rejects.toBeInstanceOf(CreatorDraftConflict);
  const claimed = await claimCreatorPreview(
    workspace.actor,
    preview.id,
    "worker",
    { sessionId: randomUUID(), turnId: "turn_0" }
  );
  expect(claimed).toEqual({ snapshot: content, question: testCase.question });
  await finishCreatorPreview(
    workspace.actor,
    preview.id,
    "worker",
    "What stayed with you? It is fine to pass."
  );
  const review = {
    id: preview.id,
    expectedRevision: null,
    content: {
      criteria: "Changed after seeing answer",
      verdict: "useful" as const,
      notes: "Synthetic feedback",
    },
  };
  await expect(
    saveCreatorPreviewReview(workspace.actor, review)
  ).rejects.toThrow("criteria saved before");
  await saveCreatorPreviewReview(workspace.actor, {
    ...review,
    content: { ...review.content, criteria: testCase.criteria },
  });
  const exported = await exportCreatorPreview(workspace.actor, preview.id);
  expect(exported.evaluation).toEqual({
    revision: saved.evaluation.revision,
    case: testCase,
  });
  expect(exported.review?.content.criteria).toBe(testCase.criteria);
  expect(exported.snapshot).toEqual(content);
  await expect(
    query(
      sql`UPDATE creator_previews SET review = jsonb_set(review, '{criteria}', '"Tampered"'::jsonb) WHERE id = ${preview.id}`
    )
  ).rejects.toMatchObject({
    cause: {
      cause: { code: "23514", constraint: "creator_previews_evaluation_check" },
    },
  });
});

test("removing cases cannot be undone by an old save retry and does not alter playbook edits", async () => {
  await using workspace = await workspaceFixture();
  const draft = await saveCreatorDraft(workspace.actor, {
    id: randomUUID(),
    expectedRevision: null,
    content,
  });
  const input = {
    draftId: draft.id,
    expectedRevision: null,
    cases: [{ id: randomUUID(), ...sample }],
  };
  const saved = await saveCreatorEvaluation(workspace.actor, input);
  const changed = await saveCreatorDraft(workspace.actor, {
    id: draft.id,
    expectedRevision: draft.revision,
    content: { ...content, playbook: "Revised teaching" },
  });
  const removed = await saveCreatorEvaluation(workspace.actor, {
    draftId: draft.id,
    expectedRevision: saved.evaluation?.revision ?? null,
    cases: [],
  });
  expect(removed.content).toEqual(changed.content);
  expect(removed.revision).toBe(changed.revision);
  await expect(
    saveCreatorEvaluation(workspace.actor, input)
  ).rejects.toBeInstanceOf(CreatorDraftConflict);
  expect(
    (await readCreatorDraft(workspace.actor, draft.id)).evaluation?.cases
  ).toEqual([]);
  await query(
    sql`DELETE FROM workspace_memberships WHERE workspace_id = ${workspace.actor.workspaceId} AND user_id = ${workspace.actor.userId}`
  );
  await expect(
    saveCreatorEvaluation(workspace.actor, input)
  ).rejects.toBeInstanceOf(WorkspaceAccessDenied);
  expect(
    await query(sql`SELECT id FROM creator_drafts WHERE id = ${draft.id}`)
  ).toEqual([]);
});
