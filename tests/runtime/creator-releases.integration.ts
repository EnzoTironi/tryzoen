import { reviewedCreatorVersion } from "../helpers/creator-release";
import { createHmac, randomUUID } from "node:crypto";
import { query } from "@db/queries";
import { getInstallationSecrets } from "@db/services/installation-secrets";
import { sql } from "drizzle-orm";
import { expect, test } from "vitest";
import { workspaceFixture } from "./workspace-fixture";
import {
  saveCreatorDraft,
  setCreatorDraftArchived,
} from "../../server/creators/drafts";
import { saveCreatorEvaluation } from "../../server/creators/evaluation";
import {
  createCreatorPreview,
  claimCreatorPreview,
  finishCreatorPreview,
} from "../../server/creators/previews";
import { saveCreatorPreviewReview } from "../../server/creators/reviews";
import { readCreatorReleaseCandidate } from "../../server/creators/release-candidate";
import {
  approveCreatorRelease,
  listCreatorReleases,
  readCreatorRelease,
} from "../../server/creators/releases";
import { WorkspaceAccessDenied } from "../../server/workspaces/access";
import {
  AccountArchiveMissing,
  readAccountArchive,
  downloadAccountArchive,
} from "../../server/accounts/archives";
import { AccountControlError } from "../../server/accounts/controls";

test("an approval freezes selected teaching and reviewed evaluations, survives edits and retries without publishing", async () => {
  await using workspace = await workspaceFixture();
  const { draft, preview, review, input } = await reviewedCreatorVersion(
    workspace.actor
  );
  expect(
    (await readCreatorReleaseCandidate(workspace.actor, draft.id)).issues
  ).toEqual([]);
  const release = await approveCreatorRelease(workspace.actor, input);
  expect(release.content).toEqual(draft.content);
  expect(release.evidence[0]?.review).toEqual(review);
  expect(release.evidence[0]?.evaluation.case).toEqual(
    draft.evaluation?.cases[0]
  );
  const edited = await saveCreatorDraft(workspace.actor, {
    id: draft.id,
    expectedRevision: draft.revision,
    content: { ...draft.content, playbook: "Changed teaching" },
  });
  await saveCreatorPreviewReview(workspace.actor, {
    id: preview.id,
    expectedRevision: review.revision,
    content: {
      ...review.content,
      verdict: "unsafe-or-unsupported",
      notes: "Later review",
    },
  });
  await saveCreatorEvaluation(workspace.actor, {
    draftId: draft.id,
    expectedRevision: input.evaluationRevision,
    cases: [],
  });
  await setCreatorDraftArchived(workspace.actor, {
    id: draft.id,
    expectedRevision: edited.revision,
    archived: true,
  });
  expect(await readCreatorRelease(workspace.actor, release.id)).toEqual(
    release
  );
  expect(await approveCreatorRelease(workspace.actor, input)).toEqual(release);
  expect(await listCreatorReleases(workspace.actor, draft.id)).toHaveLength(1);
  await expect(
    approveCreatorRelease(workspace.actor, {
      ...input,
      notes: "Rewritten approval",
    })
  ).rejects.toThrow("already saved");
  await expect(
    approveCreatorRelease(workspace.actor, { ...input, id: randomUUID() })
  ).rejects.toThrow("Restore this draft");
});

test("approval requires a live human owner and cannot leak a release across people or workspaces", async () => {
  await using workspace = await workspaceFixture();
  const { draft, input } = await reviewedCreatorVersion(workspace.actor);
  const release = await approveCreatorRelease(workspace.actor, input);
  for (const actor of [
    workspace.guest,
    workspace.personal,
    { ...workspace.guest, authSessionId: workspace.actor.authSessionId },
    { ...workspace.actor, authSessionId: undefined },
    { ...workspace.actor, groupBindingId: randomUUID() },
  ]) {
    await expect(
      readCreatorReleaseCandidate(actor, draft.id)
    ).rejects.toBeInstanceOf(WorkspaceAccessDenied);
    await expect(readCreatorRelease(actor, release.id)).rejects.toBeInstanceOf(
      WorkspaceAccessDenied
    );
    await expect(listCreatorReleases(actor, draft.id)).rejects.toBeInstanceOf(
      WorkspaceAccessDenied
    );
    await expect(approveCreatorRelease(actor, input)).rejects.toBeInstanceOf(
      WorkspaceAccessDenied
    );
  }
  await query(
    sql`DELETE FROM public.session WHERE id = ${workspace.actor.authSessionId}`
  );
  await expect(
    readCreatorRelease(workspace.actor, release.id)
  ).rejects.toBeInstanceOf(WorkspaceAccessDenied);
  await expect(
    approveCreatorRelease(workspace.actor, input)
  ).rejects.toBeInstanceOf(WorkspaceAccessDenied);
});

test("latest failed or unreviewed runs block approval instead of selecting an older good result", async () => {
  await using workspace = await workspaceFixture();
  const { draft, input, request } = await reviewedCreatorVersion(
    workspace.actor
  );
  const latest = await createCreatorPreview(workspace.actor, {
    ...request,
    id: randomUUID(),
  });
  expect(
    (await readCreatorReleaseCandidate(workspace.actor, draft.id)).issues
  ).toHaveLength(1);
  await expect(approveCreatorRelease(workspace.actor, input)).rejects.toThrow(
    "latest run"
  );
  await claimCreatorPreview(workspace.actor, latest.id, "failed-worker", {
    sessionId: randomUUID(),
    turnId: "turn_0",
  });
  await finishCreatorPreview(workspace.actor, latest.id, "failed-worker", null);
  await expect(approveCreatorRelease(workspace.actor, input)).rejects.toThrow(
    "latest run"
  );
  expect(await listCreatorReleases(workspace.actor, draft.id)).toEqual([]);
});

test("stale review references are rejected and simultaneous response-loss retries create one immutable version", async () => {
  await using workspace = await workspaceFixture();
  const { draft, preview, review, input } = await reviewedCreatorVersion(
    workspace.actor
  );
  const changed = await saveCreatorPreviewReview(workspace.actor, {
    id: preview.id,
    expectedRevision: review.revision,
    content: {
      ...review.content,
      notes: "A more precise synthetic evaluation.",
    },
  });
  await expect(approveCreatorRelease(workspace.actor, input)).rejects.toThrow(
    "evaluations changed"
  );
  const current = {
    ...input,
    evidence: [{ id: preview.id, reviewRevision: changed.revision }],
  };
  const [first, second] = await Promise.all([
    approveCreatorRelease(workspace.actor, current),
    approveCreatorRelease(workspace.actor, current),
  ]);
  expect(first).toEqual(second);
  expect(await listCreatorReleases(workspace.actor, draft.id)).toHaveLength(1);
  await saveCreatorEvaluation(workspace.actor, {
    draftId: draft.id,
    expectedRevision: input.evaluationRevision,
    cases: [
      ...(draft.evaluation?.cases ?? []),
      {
        id: randomUUID(),
        title: "Untested situation",
        question: "A new question",
        criteria: "Not yet evaluated",
      },
    ],
  });
  await expect(
    approveCreatorRelease(workspace.actor, { ...current, id: randomUUID() })
  ).rejects.toThrow("latest run");
});

test("approved versions remain individually exportable only through the authorized former-account archive", async () => {
  await using workspace = await workspaceFixture();
  const source = await reviewedCreatorVersion(workspace.personal);
  const release = await approveCreatorRelease(workspace.personal, source.input);
  const foreign = await reviewedCreatorVersion(workspace.guestPersonal);
  const foreignRelease = await approveCreatorRelease(
    workspace.guestPersonal,
    foreign.input
  );
  const archiveId = randomUUID();
  const { betterAuthSecret } = await getInstallationSecrets();
  const signature = createHmac("sha256", betterAuthSecret)
    .update(workspace.guest.authSessionId)
    .digest("base64");
  const headers = new Headers({
    cookie: `better-auth.session_token=${encodeURIComponent(`${workspace.guest.authSessionId}.${signature}`)}`,
  });
  await query(sql`INSERT INTO account_archive (id, source_user_id, target_user_id, workspace_id, challenge_id)
    VALUES (${archiveId}, ${workspace.personal.userId.slice("better-auth:".length)}, ${workspace.guest.userId.slice("better-auth:".length)}, ${workspace.personal.workspaceId}, ${randomUUID()})`);
  try {
    expect(
      (await readAccountArchive(headers, archiveId)).creatorReleases.map(
        (item) => item.id
      )
    ).toEqual([release.id]);
    const response = await downloadAccountArchive(
      headers,
      archiveId,
      "creator-release",
      release.id
    );
    expect(response.headers.get("cache-control")).toBe("private, no-store");
    expect(await response.json()).toEqual({
      format: "zoen-creator-release",
      version: 1,
      release,
    });
    await expect(
      downloadAccountArchive(
        headers,
        archiveId,
        "creator-release",
        foreignRelease.id
      )
    ).rejects.toBeInstanceOf(AccountArchiveMissing);
    await query(
      sql`DELETE FROM public.session WHERE id = ${workspace.guest.authSessionId}`
    );
    await expect(
      downloadAccountArchive(headers, archiveId, "creator-release", release.id)
    ).rejects.toBeInstanceOf(AccountControlError);
  } finally {
    await query(sql`DELETE FROM account_archive WHERE id = ${archiveId}`);
  }
});

test("approval storage is bounded and another owner's release identity cannot be overwritten", async () => {
  await using workspace = await workspaceFixture();
  const source = await reviewedCreatorVersion(workspace.actor);
  const release = await approveCreatorRelease(workspace.actor, source.input);
  const foreign = await reviewedCreatorVersion(workspace.guestPersonal);
  await expect(
    approveCreatorRelease(workspace.guestPersonal, {
      ...foreign.input,
      id: release.id,
    })
  ).rejects.toBeInstanceOf(WorkspaceAccessDenied);
  expect(await readCreatorRelease(workspace.actor, release.id)).toEqual(
    release
  );
  // Populate only this disposable owner's remaining capacity; no model calls.
  await query(sql`INSERT INTO creator_releases (id, workspace_id, user_id, draft_id, revision, evaluation_revision, content, evidence, notes)
    SELECT gen_random_uuid(), workspace_id, user_id, draft_id, revision, evaluation_revision, content, evidence, notes
    FROM creator_releases CROSS JOIN generate_series(1,49) WHERE id = ${release.id}`);
  await expect(
    approveCreatorRelease(workspace.actor, {
      ...source.input,
      id: randomUUID(),
    })
  ).rejects.toThrow("50 approved versions");
  expect(
    await listCreatorReleases(workspace.actor, source.draft.id)
  ).toHaveLength(50);
});
