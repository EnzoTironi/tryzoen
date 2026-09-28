import { randomUUID } from "node:crypto";
import { query } from "@db/queries";
import { sql } from "drizzle-orm";
import { expect, test } from "vitest";
import {
  CreatorDraftConflict,
  saveCreatorDraft,
  setCreatorDraftArchived,
} from "../../server/creators/drafts";
import {
  claimCreatorPreview,
  createCreatorPreview,
  finishCreatorPreview,
  listCreatorPreviews,
  exportCreatorPreview,
} from "../../server/creators/previews";
import { WorkspaceAccessDenied } from "../../server/workspaces/access";
import { workspaceFixture } from "./workspace-fixture";
import { recordCreatorPreviewModel } from "../../server/creators/execution";

const content = {
  title: "Synthetic preview coach",
  description: "Fictional test",
  playbook: "# Strategies\n\nAsk one open question.",
  examples: [],
};

test("preview snapshots are immutable, owner scoped and survive later edits and archival", async () => {
  await using workspace = await workspaceFixture();
  const draft = await saveCreatorDraft(workspace.actor, {
    id: randomUUID(),
    expectedRevision: null,
    content,
  });
  const request = {
    id: randomUUID(),
    draftId: draft.id,
    revision: draft.revision,
    question: "Help a fictional quiet reading group.",
  };
  const preview = await createCreatorPreview(workspace.actor, request);
  expect(await createCreatorPreview(workspace.actor, request)).toEqual(preview);
  await expect(
    createCreatorPreview(workspace.actor, { ...request, question: "Changed" })
  ).rejects.toBeInstanceOf(CreatorDraftConflict);
  for (const actor of [
    workspace.guest,
    workspace.personal,
    { ...workspace.guest, authSessionId: workspace.actor.authSessionId },
    { ...workspace.actor, authSessionId: undefined },
  ]) {
    await expect(listCreatorPreviews(actor, draft.id)).rejects.toBeInstanceOf(
      WorkspaceAccessDenied
    );
    await expect(
      exportCreatorPreview(actor, preview.id)
    ).rejects.toBeInstanceOf(WorkspaceAccessDenied);
    await expect(
      claimCreatorPreview(actor, request.id, "foreign", {
        sessionId: randomUUID(),
        turnId: "turn_0",
      })
    ).rejects.toBeInstanceOf(WorkspaceAccessDenied);
    await expect(
      finishCreatorPreview(actor, request.id, "worker", "foreign")
    ).rejects.toBeInstanceOf(WorkspaceAccessDenied);
  }
  const edited = await saveCreatorDraft(workspace.actor, {
    id: draft.id,
    expectedRevision: draft.revision,
    content: { ...content, playbook: "Different playbook" },
  });
  await setCreatorDraftArchived(workspace.actor, {
    id: draft.id,
    expectedRevision: edited.revision,
    archived: true,
  });
  expect(
    await claimCreatorPreview(workspace.actor, preview.id, "worker", {
      sessionId: randomUUID(),
      turnId: "turn_0",
    })
  ).toEqual({ snapshot: content, question: request.question });
  await finishCreatorPreview(
    workspace.actor,
    preview.id,
    "worker",
    "An open question."
  );
  await finishCreatorPreview(
    workspace.actor,
    preview.id,
    "worker",
    "Cannot overwrite first answer"
  );
  const completed = await exportCreatorPreview(workspace.actor, preview.id);
  expect(completed.startedAt).toBeGreaterThanOrEqual(preview.createdAt);
  expect(completed.finishedAt).toBeGreaterThanOrEqual(
    completed.startedAt ?? Infinity
  );
  expect(await listCreatorPreviews(workspace.actor, draft.id)).toEqual([
    {
      ...preview,
      status: "completed",
      response: "An open question.",
      startedAt: completed.startedAt,
      finishedAt: completed.finishedAt,
    },
  ]);
  expect(completed).toEqual({
    ...preview,
    snapshot: content,
    status: "completed",
    response: "An open question.",
    startedAt: completed.startedAt,
    finishedAt: completed.finishedAt,
  });
  await expect(
    createCreatorPreview(workspace.actor, { ...request, id: randomUUID() })
  ).rejects.toBeInstanceOf(CreatorDraftConflict);
});

test("parallel requests admit one preview and competing workflows cannot duplicate execution", async () => {
  await using workspace = await workspaceFixture();
  const draft = await saveCreatorDraft(workspace.personal, {
    id: randomUUID(),
    expectedRevision: null,
    content,
  });
  const input = {
    draftId: draft.id,
    revision: draft.revision,
    question: "Synthetic test",
  };
  const attempts = await Promise.allSettled(
    Array.from({ length: 8 }, () =>
      createCreatorPreview(workspace.personal, { ...input, id: randomUUID() })
    )
  );
  expect(attempts.filter((item) => item.status === "fulfilled")).toHaveLength(
    1
  );
  const [preview] = await listCreatorPreviews(workspace.personal, draft.id);
  expect(preview).toBeDefined();
  if (!preview) throw new Error("Expected the admitted preview");
  const claims = await Promise.allSettled(
    Array.from({ length: 5 }, (_, i) =>
      claimCreatorPreview(workspace.personal, preview.id, `worker-${i}`, {
        sessionId: randomUUID(),
        turnId: "turn_0",
      })
    )
  );
  expect(claims.filter((item) => item.status === "fulfilled")).toHaveLength(1);
  await finishCreatorPreview(
    workspace.personal,
    preview.id,
    "wrong-worker",
    "Wrong answer"
  );
  expect(
    (await listCreatorPreviews(workspace.personal, draft.id))[0]?.response
  ).toBeNull();
  await query(
    sql`UPDATE creator_previews SET expires_at = now() - interval '1 second' WHERE id = ${preview.id}`
  );
  expect(
    (await listCreatorPreviews(workspace.personal, draft.id))[0]?.status
  ).toBe("expired");
  await finishCreatorPreview(
    workspace.personal,
    preview.id,
    "worker-0",
    "Late answer"
  );
  expect(
    (await listCreatorPreviews(workspace.personal, draft.id))[0]?.response
  ).toBeNull();
  await expect(
    claimCreatorPreview(workspace.personal, preview.id, "new-worker", {
      sessionId: randomUUID(),
      turnId: "turn_0",
    })
  ).rejects.toThrow("already started or expired");
  await expect(
    createCreatorPreview(workspace.personal, { ...input, id: randomUUID() })
  ).resolves.toMatchObject({ status: "pending" });
});

test("preview context is bounded without truncation and revoked sessions cannot record results", async () => {
  await using workspace = await workspaceFixture();
  const huge = await saveCreatorDraft(workspace.personal, {
    id: randomUUID(),
    expectedRevision: null,
    content: { ...content, playbook: "A".repeat(49000) },
  });
  await expect(
    createCreatorPreview(workspace.personal, {
      id: randomUUID(),
      draftId: huge.id,
      revision: huge.revision,
      question: "Test",
    })
  ).rejects.toThrow("48 KB");
  const draft = await saveCreatorDraft(workspace.personal, {
    id: randomUUID(),
    expectedRevision: null,
    content,
  });
  const preview = await createCreatorPreview(workspace.personal, {
    id: randomUUID(),
    draftId: draft.id,
    revision: draft.revision,
    question: "Test",
  });
  await claimCreatorPreview(workspace.personal, preview.id, "worker", {
    sessionId: randomUUID(),
    turnId: "turn_0",
  });
  await query(
    sql`DELETE FROM public.session WHERE id = ${workspace.personal.authSessionId}`
  );
  await expect(
    finishCreatorPreview(workspace.personal, preview.id, "worker", "Answer")
  ).rejects.toBeInstanceOf(WorkspaceAccessDenied);
  expect(
    await query(
      sql`SELECT response FROM creator_previews WHERE id = ${preview.id}`
    )
  ).toEqual([{ response: null }]);
  await query(
    sql`DELETE FROM workspace_memberships WHERE workspace_id = ${workspace.personal.workspaceId} AND user_id = ${workspace.personal.userId}`
  );
  expect(
    await query(sql`SELECT id FROM creator_previews WHERE id = ${preview.id}`)
  ).toEqual([]);
});

test("preview failures are explicit and the rolling per-person limit is enforced", async () => {
  await using workspace = await workspaceFixture();
  const draft = await saveCreatorDraft(workspace.actor, {
    id: randomUUID(),
    expectedRevision: null,
    content,
  });
  for (let i = 0; i < 10; i++) {
    const preview = await createCreatorPreview(workspace.actor, {
      id: randomUUID(),
      draftId: draft.id,
      revision: draft.revision,
      question: `Test ${i}`,
    });
    await claimCreatorPreview(workspace.actor, preview.id, "worker", {
      sessionId: randomUUID(),
      turnId: "turn_0",
    });
    await finishCreatorPreview(workspace.actor, preview.id, "worker", null);
  }
  const previews = await listCreatorPreviews(workspace.actor, draft.id);
  expect(previews).toHaveLength(10);
  expect(previews.every((item) => item.status === "failed")).toBe(true);
  await expect(
    createCreatorPreview(workspace.actor, {
      id: randomUUID(),
      draftId: draft.id,
      revision: draft.revision,
      question: "One too many",
    })
  ).rejects.toThrow("10 in 24 hours");
  const guest = await saveCreatorDraft(workspace.guest, {
    id: randomUUID(),
    expectedRevision: null,
    content,
  });
  await expect(
    createCreatorPreview(workspace.guest, {
      id: randomUUID(),
      draftId: guest.id,
      revision: guest.revision,
      question: "Independent person",
    })
  ).resolves.toMatchObject({ status: "pending" });
});

test("model selection binds to one coordinator turn, remains bounded and cannot arrive after completion", async () => {
  await using workspace = await workspaceFixture();
  const draft = await saveCreatorDraft(workspace.actor, {
    id: randomUUID(),
    expectedRevision: null,
    content,
  });
  const request = {
    draftId: draft.id,
    revision: draft.revision,
    question: "Synthetic measured preview",
  };
  const preview = await createCreatorPreview(workspace.actor, {
    ...request,
    id: randomUUID(),
  });
  const origin = { sessionId: randomUUID(), turnId: "turn_0" };
  const model = { provider: "synthetic-sdk", modelId: "synthetic-model" };
  await claimCreatorPreview(workspace.actor, preview.id, "worker", origin);
  for (const actor of [
    workspace.guest,
    workspace.personal,
    { ...workspace.actor, authSessionId: undefined },
  ]) {
    await expect(
      recordCreatorPreviewModel(actor, origin, model)
    ).rejects.toBeInstanceOf(WorkspaceAccessDenied);
  }
  await expect(
    recordCreatorPreviewModel(
      workspace.actor,
      { ...origin, turnId: "turn_1" },
      model
    )
  ).rejects.toBeInstanceOf(WorkspaceAccessDenied);
  await Promise.all(
    Array.from({ length: 4 }, () =>
      recordCreatorPreviewModel(workspace.actor, origin, model)
    )
  );
  expect(
    (await exportCreatorPreview(workspace.actor, preview.id)).models
  ).toEqual([model]);
  const results = await Promise.allSettled(
    Array.from({ length: 10 }, (_, i) =>
      recordCreatorPreviewModel(workspace.actor, origin, {
        ...model,
        modelId: `synthetic-${i}`,
      })
    )
  );
  expect(
    results.filter((result) => result.status === "fulfilled")
  ).toHaveLength(7);
  expect(
    (await exportCreatorPreview(workspace.actor, preview.id)).models
  ).toHaveLength(8);
  await finishCreatorPreview(
    workspace.actor,
    preview.id,
    "worker",
    "Synthetic measured response"
  );
  await expect(
    recordCreatorPreviewModel(workspace.actor, origin, model)
  ).rejects.toBeInstanceOf(WorkspaceAccessDenied);
  const next = await createCreatorPreview(workspace.actor, {
    ...request,
    id: randomUUID(),
  });
  await expect(
    claimCreatorPreview(workspace.actor, next.id, "worker-2", origin)
  ).rejects.toMatchObject({
    cause: {
      cause: { code: "23505", constraint: "creator_previews_source_idx" },
    },
  });
  await claimCreatorPreview(workspace.actor, next.id, "worker-2", {
    ...origin,
    turnId: "turn_1",
  });
  await expect(
    recordCreatorPreviewModel(workspace.actor, origin, model)
  ).rejects.toBeInstanceOf(WorkspaceAccessDenied);
  expect((await exportCreatorPreview(workspace.actor, next.id)).models).toEqual(
    []
  );
});
