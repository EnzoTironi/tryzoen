import {
  creatorPilotInviteSchema,
  creatorPilotFeedbackSaveSchema,
} from "@zoen/companion-ui/creators";
import { randomUUID } from "node:crypto";
import { query } from "@db/queries";
import { sql } from "drizzle-orm";
import { expect, test } from "vitest";
import { workspaceFixture } from "./workspace-fixture";
import { reviewedCreatorVersion } from "../helpers/creator-release";
import { saveDirectoryProfile } from "../../server/accounts/directory";
import { saveCreatorDraft } from "../../server/creators/drafts";
import {
  approveCreatorRelease,
  readCreatorRelease,
} from "../../server/creators/releases";
import {
  actOnCreatorPilot,
  inviteCreatorPilot,
  listCreatorPilots,
  readCreatorPilot,
  readCreatorPilotFeedback,
  saveCreatorPilotFeedback,
} from "../../server/creators/pilots";
import {
  claimCreatorPreview,
  createCreatorPreview,
  exportCreatorPreview,
  finishCreatorPreview,
  listCreatorPreviews,
} from "../../server/creators/previews";
import { recordCreatorPreviewModel } from "../../server/creators/execution";
import { saveCreatorPreviewReview } from "../../server/creators/reviews";
import { WorkspaceAccessDenied } from "../../server/workspaces/access";

async function invitedPilot(
  workspace: Awaited<ReturnType<typeof workspaceFixture>>
) {
  const source = await reviewedCreatorVersion(workspace.actor);
  const release = await approveCreatorRelease(workspace.actor, source.input);
  const username = `pilot_${randomUUID().replaceAll("-", "").slice(0, 20)}`;
  await saveDirectoryProfile(workspace.guest, {
    username,
    discoverable: false,
  });
  const invitation = {
    id: randomUUID(),
    releaseId: release.id,
    username,
    shareTeaching: true as const,
  };
  const pilot = await inviteCreatorPilot(workspace.actor, invitation);
  const request = {
    id: randomUUID(),
    draftId: release.draftId,
    revision: release.revision,
    pilotId: pilot.id,
    kind: "answer" as const,
    question: "A private participant question, not shared with the creator.",
  };
  return { ...source, release, pilot, request, invitation };
}

test("only named workspace peers can accept selected teaching; invitations are bounded, private and retry-safe", async () => {
  await using workspace = await workspaceFixture();
  const { release, pilot, invitation, request } = await invitedPilot(workspace);
  expect(pilot.status).toBe("pending");
  expect((await listCreatorPilots(workspace.guest))[0]).toMatchObject({
    id: pilot.id,
    isCreator: false,
    status: "pending",
  });
  expect(
    JSON.stringify(await listCreatorPilots(workspace.guest))
  ).not.toContain(release.content.playbook);
  await expect(
    readCreatorPilot(workspace.guest, pilot.id)
  ).rejects.toBeInstanceOf(WorkspaceAccessDenied);
  await expect(
    createCreatorPreview(workspace.guest, request)
  ).rejects.toBeInstanceOf(WorkspaceAccessDenied);
  await expect(
    readCreatorRelease(workspace.guest, release.id)
  ).rejects.toBeInstanceOf(WorkspaceAccessDenied);
  await expect(
    actOnCreatorPilot(workspace.actor, { id: pilot.id, action: "accept" })
  ).rejects.toBeInstanceOf(WorkspaceAccessDenied);
  await expect(
    inviteCreatorPilot(workspace.guest, { ...invitation, id: randomUUID() })
  ).rejects.toBeInstanceOf(WorkspaceAccessDenied);
  await expect(
    inviteCreatorPilot(workspace.personal, invitation)
  ).rejects.toBeInstanceOf(WorkspaceAccessDenied);
  expect(() =>
    creatorPilotInviteSchema.parse({ ...invitation, shareTeaching: false })
  ).toThrow("Invalid input: expected true");
  const retries = await Promise.all(
    Array.from({ length: 12 }, () =>
      inviteCreatorPilot(workspace.actor, invitation)
    )
  );
  expect(new Set(retries.map((item) => item.id)).size).toBe(1);
  await expect(
    inviteCreatorPilot(workspace.actor, { ...invitation, id: randomUUID() })
  ).rejects.toThrow("already has");
  await actOnCreatorPilot(workspace.guest, { id: pilot.id, action: "accept" });
  const teaching = await readCreatorPilot(workspace.guest, pilot.id);
  expect(teaching.content).toEqual(release.content);
  expect(teaching).not.toHaveProperty("evidence");
  expect(teaching).not.toHaveProperty("notes");
  await expect(
    readCreatorPilot(workspace.guestPersonal, pilot.id)
  ).rejects.toBeInstanceOf(WorkspaceAccessDenied);
  await expect(
    readCreatorPilot(
      { ...workspace.guest, groupBindingId: randomUUID() },
      pilot.id
    )
  ).rejects.toBeInstanceOf(WorkspaceAccessDenied);
});

test("participant runs use immutable selected teaching and remain private from the creator and other contexts", async () => {
  await using workspace = await workspaceFixture();
  const { release, pilot, request, draft } = await invitedPilot(workspace);
  await actOnCreatorPilot(workspace.guest, { id: pilot.id, action: "accept" });
  await saveCreatorDraft(workspace.actor, {
    id: draft.id,
    expectedRevision: draft.revision,
    content: {
      ...draft.content,
      playbook: "NEW-PRIVATE-CREATOR-INSTRUCTIONS-MUST-NOT-CROSS",
    },
  });
  await expect(
    createCreatorPreview(workspace.guest, { ...request, kind: "playbook" })
  ).rejects.toBeInstanceOf(WorkspaceAccessDenied);
  await expect(
    createCreatorPreview(workspace.guest, {
      ...request,
      caseRef: { id: randomUUID(), revision: randomUUID() },
    })
  ).rejects.toBeInstanceOf(WorkspaceAccessDenied);
  await expect(
    createCreatorPreview(workspace.guest, {
      ...request,
      revision: randomUUID(),
    })
  ).rejects.toBeInstanceOf(WorkspaceAccessDenied);
  await expect(
    createCreatorPreview(workspace.guest, { ...request, pilotId: undefined })
  ).rejects.toBeInstanceOf(WorkspaceAccessDenied);
  const preview = await createCreatorPreview(workspace.guest, request);
  expect((await createCreatorPreview(workspace.guest, request)).id).toBe(
    preview.id
  );
  const origin = { sessionId: randomUUID(), turnId: randomUUID() };
  const source = await claimCreatorPreview(
    workspace.guest,
    preview.id,
    "pilot-worker",
    origin
  );
  expect(source).toEqual({
    kind: "answer",
    snapshot: release.content,
    question: request.question,
  });
  const model = { provider: "synthetic-provider", modelId: "synthetic-model" };
  await expect(
    recordCreatorPreviewModel(workspace.actor, origin, model)
  ).rejects.toBeInstanceOf(WorkspaceAccessDenied);
  await recordCreatorPreviewModel(workspace.guest, origin, model);
  await finishCreatorPreview(
    workspace.guest,
    preview.id,
    "pilot-worker",
    "Ask the group an open question."
  );
  await saveCreatorPreviewReview(workspace.guest, {
    id: preview.id,
    expectedRevision: null,
    content: {
      criteria: "Invite reflection.",
      verdict: "useful",
      notes: "Private participant notes.",
    },
  });
  expect(
    (await listCreatorPreviews(workspace.guest, release.draftId, pilot.id))[0]
  ).toMatchObject({ id: preview.id, status: "completed", pilotId: pilot.id });
  expect(
    (await exportCreatorPreview(workspace.guest, preview.id)).snapshot
  ).toEqual(release.content);
  await expect(
    exportCreatorPreview(workspace.actor, preview.id)
  ).rejects.toBeInstanceOf(WorkspaceAccessDenied);
  await expect(
    listCreatorPreviews(workspace.actor, release.draftId, pilot.id)
  ).rejects.toBeInstanceOf(WorkspaceAccessDenied);
  expect(
    (await listCreatorPreviews(workspace.actor, release.draftId)).some(
      (item) => item.id === preview.id
    )
  ).toBe(false);
  await expect(
    saveCreatorPreviewReview(workspace.actor, {
      id: preview.id,
      expectedRevision: null,
      content: {
        criteria: "wrong owner",
        verdict: "useful",
        notes: "wrong owner",
      },
    })
  ).rejects.toBeInstanceOf(WorkspaceAccessDenied);
});

test("withdrawal denies queued claims and running completion, provenance, reads and exports without reopening on retry", async () => {
  await using workspace = await workspaceFixture();
  const { pilot, request, invitation } = await invitedPilot(workspace);
  await actOnCreatorPilot(workspace.guest, { id: pilot.id, action: "accept" });
  const preview = await createCreatorPreview(workspace.guest, request);
  const origin = { sessionId: randomUUID(), turnId: randomUUID() };
  await claimCreatorPreview(
    workspace.guest,
    preview.id,
    "pilot-worker",
    origin
  );
  await actOnCreatorPilot(workspace.actor, {
    id: pilot.id,
    action: "withdraw",
  });
  expect((await inviteCreatorPilot(workspace.actor, invitation)).status).toBe(
    "withdrawn"
  );
  expect(
    (
      await actOnCreatorPilot(workspace.guest, {
        id: pilot.id,
        action: "withdraw",
      })
    ).status
  ).toBe("withdrawn");
  await expect(
    actOnCreatorPilot(workspace.guest, { id: pilot.id, action: "accept" })
  ).rejects.toThrow("already closed");
  await expect(
    createCreatorPreview(workspace.guest, request)
  ).rejects.toBeInstanceOf(WorkspaceAccessDenied);
  await expect(
    claimCreatorPreview(workspace.guest, preview.id, "another-worker", origin)
  ).rejects.toBeInstanceOf(WorkspaceAccessDenied);
  await expect(
    recordCreatorPreviewModel(workspace.guest, origin, {
      provider: "synthetic",
      modelId: "synthetic",
    })
  ).rejects.toBeInstanceOf(WorkspaceAccessDenied);
  await expect(
    finishCreatorPreview(
      workspace.guest,
      preview.id,
      "pilot-worker",
      "Late response"
    )
  ).rejects.toBeInstanceOf(WorkspaceAccessDenied);
  await expect(
    exportCreatorPreview(workspace.guest, preview.id)
  ).rejects.toBeInstanceOf(WorkspaceAccessDenied);
  await expect(
    listCreatorPreviews(workspace.guest, request.draftId, pilot.id)
  ).rejects.toBeInstanceOf(WorkspaceAccessDenied);
  const [stored] = await query(
    sql`SELECT status, response FROM creator_previews WHERE id = ${preview.id}`
  );
  expect(stored).toEqual({ status: "running", response: null });
});

test("decline, organization revocation and workspace removal cannot retain or widen pilot access", async () => {
  await using workspace = await workspaceFixture();
  const { pilot, request, invitation } = await invitedPilot(workspace);
  await actOnCreatorPilot(workspace.guest, { id: pilot.id, action: "decline" });
  await expect(
    actOnCreatorPilot(workspace.guest, { id: pilot.id, action: "accept" })
  ).rejects.toThrow("already closed");
  const next = await inviteCreatorPilot(workspace.actor, {
    ...invitation,
    id: randomUUID(),
  });
  await actOnCreatorPilot(workspace.guest, { id: next.id, action: "accept" });
  const preview = await createCreatorPreview(workspace.guest, {
    ...request,
    pilotId: next.id,
  });
  await query(
    sql`DELETE FROM organization_memberships WHERE user_id = ${workspace.actor.userId}`
  );
  await expect(
    claimCreatorPreview(workspace.guest, preview.id, "worker", {
      sessionId: randomUUID(),
      turnId: randomUUID(),
    })
  ).rejects.toBeInstanceOf(WorkspaceAccessDenied);
  await expect(
    readCreatorPilot(workspace.guest, next.id)
  ).rejects.toBeInstanceOf(WorkspaceAccessDenied);
  await query(
    sql`DELETE FROM workspace_memberships WHERE user_id = ${workspace.guest.userId} AND workspace_id = ${workspace.guest.workspaceId}`
  );
  expect(
    await query(sql`SELECT id FROM creator_pilots WHERE id = ${next.id}`)
  ).toEqual([]);
  expect(
    await query(sql`SELECT id FROM creator_previews WHERE id = ${preview.id}`)
  ).toEqual([]);
});

test("pilot capacity includes closed invitations and concurrent invitation attempts cannot exceed it", async () => {
  await using workspace = await workspaceFixture();
  const { pilot, invitation } = await invitedPilot(workspace);
  await actOnCreatorPilot(workspace.actor, {
    id: pilot.id,
    action: "withdraw",
  });
  for (let n = 0; n < 18; n++) {
    const created = await inviteCreatorPilot(workspace.actor, {
      ...invitation,
      id: randomUUID(),
    });
    await actOnCreatorPilot(workspace.guest, {
      id: created.id,
      action: "decline",
    });
  }
  const attempts = await Promise.allSettled(
    Array.from({ length: 8 }, () =>
      inviteCreatorPilot(workspace.actor, { ...invitation, id: randomUUID() })
    )
  );
  expect(attempts.filter((item) => item.status === "fulfilled")).toHaveLength(
    1
  );
  expect(await listCreatorPilots(workspace.guest)).toHaveLength(20);
});

test("only explicitly authored pilot feedback is shared with its creator", async () => {
  await using workspace = await workspaceFixture();
  const { pilot, request } = await invitedPilot(workspace);
  expect(
    (await readCreatorPilotFeedback(workspace.actor, pilot.id)).feedback
  ).toBeNull();
  const input = {
    id: pilot.id,
    expectedRevision: null,
    content:
      "Observed: the fictional group used the open question. Outcome was not measured.",
    shareWithCreator: true as const,
  };
  await expect(
    saveCreatorPilotFeedback(workspace.guest, input)
  ).rejects.toBeInstanceOf(WorkspaceAccessDenied);
  await actOnCreatorPilot(workspace.guest, { id: pilot.id, action: "accept" });
  await createCreatorPreview(workspace.guest, request);
  await expect(
    saveCreatorPilotFeedback(workspace.actor, input)
  ).rejects.toBeInstanceOf(WorkspaceAccessDenied);
  expect(() =>
    creatorPilotFeedbackSaveSchema.parse({ ...input, shareWithCreator: false })
  ).toThrow("Invalid input: expected true");
  expect(() =>
    creatorPilotFeedbackSaveSchema.parse({ ...input, previewId: request.id })
  ).toThrow("Unrecognized key");
  expect(() =>
    creatorPilotFeedbackSaveSchema.parse({ ...input, content: " " })
  ).toThrow("Too small");
  expect(() =>
    creatorPilotFeedbackSaveSchema.parse({
      ...input,
      content: "x".repeat(16001),
    })
  ).toThrow("Too big");
  const saved = await saveCreatorPilotFeedback(workspace.guest, input);
  expect(saved.feedback?.content).toBe(input.content);
  const read = await readCreatorPilotFeedback(workspace.actor, pilot.id);
  expect(read.feedback).toEqual(saved.feedback);
  expect(read.releaseId).toBe(pilot.releaseId);
  expect(read.revision).toBe(pilot.revision);
  expect(read).not.toHaveProperty("evidence");
  expect(read).not.toHaveProperty("content");
  expect(JSON.stringify(read)).not.toContain(request.question);
  expect(
    JSON.stringify(await listCreatorPilots(workspace.actor))
  ).not.toContain(input.content);
  await expect(
    exportCreatorPreview(workspace.actor, request.id)
  ).rejects.toBeInstanceOf(WorkspaceAccessDenied);
});

test("shared feedback retries are idempotent and concurrent edits cannot overwrite a stale revision", async () => {
  await using workspace = await workspaceFixture();
  const { pilot } = await invitedPilot(workspace);
  await actOnCreatorPilot(workspace.guest, { id: pilot.id, action: "accept" });
  const input = {
    id: pilot.id,
    expectedRevision: null,
    content: "First observation",
    shareWithCreator: true as const,
  };
  const copies = await Promise.all(
    Array.from({ length: 6 }, () =>
      saveCreatorPilotFeedback(workspace.guest, input)
    )
  );
  expect(new Set(copies.map((value) => value.feedback?.revision)).size).toBe(1);
  expect(new Set(copies.map((value) => value.feedback?.updatedAt)).size).toBe(
    1
  );
  const first = copies[0]?.feedback;
  if (!first) throw new Error("Expected submitted feedback");
  const edits = await Promise.allSettled(
    ["Observation A", "Observation B"].map((content) =>
      saveCreatorPilotFeedback(workspace.guest, {
        ...input,
        content,
        expectedRevision: first.revision,
      })
    )
  );
  expect(edits.filter((result) => result.status === "fulfilled")).toHaveLength(
    1
  );
  expect(edits.filter((result) => result.status === "rejected")).toHaveLength(
    1
  );
  const current = (await readCreatorPilotFeedback(workspace.guest, pilot.id))
    .feedback;
  if (!current) throw new Error("Expected current feedback");
  expect(current.revision).not.toBe(first.revision);
  await expect(
    saveCreatorPilotFeedback(workspace.guest, {
      ...input,
      content: "Stale overwrite",
      expectedRevision: first.revision,
    })
  ).rejects.toThrow("changed elsewhere");
  expect(
    (
      await saveCreatorPilotFeedback(workspace.guest, {
        ...input,
        content: current.content,
        expectedRevision: first.revision,
      })
    ).feedback
  ).toEqual(current);
});

test("withdrawal freezes submitted feedback and live party membership still governs reads", async () => {
  await using workspace = await workspaceFixture();
  await using outsider = await workspaceFixture();
  await query(sql`INSERT INTO organization_memberships (organization_id, user_id, role)
    SELECT organization_id, ${outsider.actor.userId}, 'member' FROM workspaces WHERE id = ${workspace.actor.workspaceId}`);
  await query(sql`INSERT INTO workspace_memberships (workspace_id, user_id, role)
    VALUES (${workspace.actor.workspaceId}, ${outsider.actor.userId}, 'member')`);
  const otherMember = {
    ...outsider.actor,
    workspaceId: workspace.actor.workspaceId,
  };
  const { pilot } = await invitedPilot(workspace);
  await actOnCreatorPilot(workspace.guest, { id: pilot.id, action: "accept" });
  const input = {
    id: pilot.id,
    expectedRevision: null,
    content: "Explicitly shared report",
    shareWithCreator: true as const,
  };
  await saveCreatorPilotFeedback(workspace.guest, input);
  for (const actor of [
    workspace.guestPersonal,
    outsider.actor,
    otherMember,
    { ...workspace.guest, groupBindingId: randomUUID() },
    { ...workspace.guest, protocolTaskId: randomUUID() },
  ]) {
    await expect(
      readCreatorPilotFeedback(actor, pilot.id)
    ).rejects.toBeInstanceOf(WorkspaceAccessDenied);
    await expect(saveCreatorPilotFeedback(actor, input)).rejects.toBeInstanceOf(
      WorkspaceAccessDenied
    );
  }
  await actOnCreatorPilot(workspace.actor, {
    id: pilot.id,
    action: "withdraw",
  });
  await expect(
    saveCreatorPilotFeedback(workspace.guest, input)
  ).rejects.toBeInstanceOf(WorkspaceAccessDenied);
  for (const actor of [workspace.actor, workspace.guest])
    expect(
      (await readCreatorPilotFeedback(actor, pilot.id)).feedback?.content
    ).toBe(input.content);
  await query(
    sql`DELETE FROM organization_memberships WHERE user_id = ${workspace.actor.userId}`
  );
  await expect(
    readCreatorPilotFeedback(workspace.guest, pilot.id)
  ).rejects.toBeInstanceOf(WorkspaceAccessDenied);
});
