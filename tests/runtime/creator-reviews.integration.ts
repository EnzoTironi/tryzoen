import { randomUUID } from "node:crypto";
import { query } from "@db/queries";
import { sql } from "drizzle-orm";
import { expect, test } from "vitest";
import {
  saveCreatorDraft,
  setCreatorDraftArchived,
} from "../../server/creators/drafts";
import {
  createCreatorPreview,
  claimCreatorPreview,
  finishCreatorPreview,
  exportCreatorPreview,
} from "../../server/creators/previews";
import {
  saveCreatorPreviewReview,
  CreatorReviewConflict,
} from "../../server/creators/reviews";
import { WorkspaceAccessDenied } from "../../server/workspaces/access";
import { workspaceFixture } from "./workspace-fixture";

const review = {
  criteria: "# Criteria\n\nAsk an open question. Do not invent facts.",
  verdict: "needs-revision" as const,
  notes:
    "# Feedback\n\nThe question is useful but needs a clearer invitation to pass.",
};

async function previewFor(
  actor: Awaited<ReturnType<typeof workspaceFixture>>["actor"]
) {
  const draft = await saveCreatorDraft(actor, {
    id: randomUUID(),
    expectedRevision: null,
    content: {
      title: "Synthetic review coach",
      description: "Fictional example",
      playbook: "Ask one open question.",
      examples: [],
    },
  });
  const preview = await createCreatorPreview(actor, {
    id: randomUUID(),
    draftId: draft.id,
    revision: draft.revision,
    kind: "answer" as const,
    question: "Welcome a fictional quiet book club.",
  });
  return { draft, preview };
}

test("human review is private, exported with the frozen result and leaves the source untouched", async () => {
  await using workspace = await workspaceFixture();
  const { draft, preview } = await previewFor(workspace.actor);
  await claimCreatorPreview(workspace.actor, preview.id, "worker", {
    sessionId: randomUUID(),
    turnId: "turn_0",
  });
  await finishCreatorPreview(
    workspace.actor,
    preview.id,
    "worker",
    "What surprised you about the story?"
  );
  const before = await exportCreatorPreview(workspace.actor, preview.id);
  for (const actor of [
    workspace.guest,
    workspace.personal,
    { ...workspace.guest, authSessionId: workspace.actor.authSessionId },
    { ...workspace.actor, authSessionId: undefined },
  ]) {
    await expect(
      saveCreatorPreviewReview(actor, {
        id: preview.id,
        expectedRevision: null,
        content: review,
      })
    ).rejects.toBeInstanceOf(WorkspaceAccessDenied);
  }
  await setCreatorDraftArchived(workspace.actor, {
    id: draft.id,
    expectedRevision: draft.revision,
    archived: true,
  });
  const saved = await saveCreatorPreviewReview(workspace.actor, {
    id: preview.id,
    expectedRevision: null,
    content: review,
  });
  expect(saved.content).toEqual(review);
  expect(saved.updatedAt).toBeGreaterThan(preview.createdAt);
  expect(await exportCreatorPreview(workspace.actor, preview.id)).toEqual({
    ...before,
    review: saved,
  });
  await expect(
    saveCreatorPreviewReview(workspace.actor, {
      id: preview.id,
      expectedRevision: null,
      content: review,
    })
  ).resolves.toEqual(saved);
});

test("stale and simultaneous reviews cannot overwrite another human edit or resurrect an earlier version", async () => {
  await using workspace = await workspaceFixture();
  const { preview } = await previewFor(workspace.actor);
  await claimCreatorPreview(workspace.actor, preview.id, "worker", {
    sessionId: randomUUID(),
    turnId: "turn_0",
  });
  await finishCreatorPreview(
    workspace.actor,
    preview.id,
    "worker",
    "A synthetic response."
  );
  const results = await Promise.allSettled(
    ["First", "Second"].map((notes) =>
      saveCreatorPreviewReview(workspace.actor, {
        id: preview.id,
        expectedRevision: null,
        content: { ...review, notes },
      })
    )
  );
  expect(
    results.filter((result) => result.status === "fulfilled")
  ).toHaveLength(1);
  const rejected = results.filter((result) => result.status === "rejected");
  expect(rejected).toHaveLength(1);
  for (const result of rejected)
    expect(result.reason).toBeInstanceOf(CreatorReviewConflict);
  const saved = (await exportCreatorPreview(workspace.actor, preview.id))
    .review;
  if (!saved) throw new Error("Expected the admitted review");
  const edited = await saveCreatorPreviewReview(workspace.actor, {
    id: preview.id,
    expectedRevision: saved.revision,
    content: review,
  });
  expect(edited.revision).not.toBe(saved.revision);
  await expect(
    saveCreatorPreviewReview(workspace.actor, {
      id: preview.id,
      expectedRevision: null,
      content: saved.content,
    })
  ).rejects.toBeInstanceOf(CreatorReviewConflict);
  expect(
    (await exportCreatorPreview(workspace.actor, preview.id)).review
  ).toEqual(edited);
});

test("incomplete previews and invalid review payloads cannot acquire a human verdict", async () => {
  await using workspace = await workspaceFixture();
  const { preview } = await previewFor(workspace.actor);
  const input = { id: preview.id, expectedRevision: null, content: review };
  await expect(
    saveCreatorPreviewReview(workspace.actor, input)
  ).rejects.toThrow("Only a completed preview");
  await claimCreatorPreview(workspace.actor, preview.id, "worker", {
    sessionId: randomUUID(),
    turnId: "turn_0",
  });
  await expect(
    saveCreatorPreviewReview(workspace.actor, input)
  ).rejects.toThrow("Only a completed preview");
  await finishCreatorPreview(workspace.actor, preview.id, "worker", null);
  await expect(
    saveCreatorPreviewReview(workspace.actor, input)
  ).rejects.toThrow("Only a completed preview");
  for (const content of [
    { ...review, criteria: " " },
    { ...review, notes: "n".repeat(8001) },
    { ...review, criteria: "c".repeat(4001) },
  ]) {
    expect(() =>
      saveCreatorPreviewReview(workspace.actor, { ...input, content })
    ).toThrow(/Too (small|big)/);
  }
  await expect(
    query(
      sql`UPDATE creator_previews SET review = ${JSON.stringify(review)}::jsonb, review_revision = ${randomUUID()}, reviewed_at = now() WHERE id = ${preview.id}`
    )
  ).rejects.toMatchObject({
    cause: {
      cause: { code: "23514", constraint: "creator_previews_review_check" },
    },
  });
  expect(
    (await exportCreatorPreview(workspace.actor, preview.id)).review
  ).toBeNull();
});

test("review writes require live authority and membership deletion removes the review with its preview", async () => {
  await using workspace = await workspaceFixture();
  const { preview } = await previewFor(workspace.actor);
  await claimCreatorPreview(workspace.actor, preview.id, "worker", {
    sessionId: randomUUID(),
    turnId: "turn_0",
  });
  await finishCreatorPreview(
    workspace.actor,
    preview.id,
    "worker",
    "Synthetic response"
  );
  const saved = await saveCreatorPreviewReview(workspace.actor, {
    id: preview.id,
    expectedRevision: null,
    content: review,
  });
  await query(
    sql`DELETE FROM public.session WHERE id = ${workspace.actor.authSessionId}`
  );
  await expect(
    saveCreatorPreviewReview(workspace.actor, {
      id: preview.id,
      expectedRevision: saved.revision,
      content: { ...review, notes: "Revoked change" },
    })
  ).rejects.toBeInstanceOf(WorkspaceAccessDenied);
  expect(
    await query(
      sql`SELECT review FROM creator_previews WHERE id = ${preview.id}`
    )
  ).toEqual([{ review }]);
  await query(
    sql`DELETE FROM workspace_memberships WHERE workspace_id = ${workspace.actor.workspaceId} AND user_id = ${workspace.actor.userId}`
  );
  expect(
    await query(sql`SELECT id FROM creator_previews WHERE id = ${preview.id}`)
  ).toEqual([]);
});
