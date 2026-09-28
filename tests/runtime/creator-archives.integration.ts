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
import {
  AccountArchiveMissing,
  downloadAccountArchive,
  readAccountArchive,
} from "../../server/accounts/archives";
import { AccountControlError } from "../../server/accounts/controls";

test("account-archive exports include only the former owner's selected creator draft and require a live target session", async () => {
  await using workspace = await workspaceFixture();
  const content = {
    title: "Fictional archived specialist",
    description: "Synthetic",
    playbook: "# Strategy\nAsk a question.",
    examples: [],
  };
  const source = await saveCreatorDraft(workspace.personal, {
    id: randomUUID(),
    expectedRevision: null,
    content,
  });
  const archived = await setCreatorDraftArchived(workspace.personal, {
    id: source.id,
    expectedRevision: source.revision,
    archived: true,
  });
  const foreign = await saveCreatorDraft(workspace.guestPersonal, {
    id: randomUUID(),
    expectedRevision: null,
    content: { ...content, title: "Foreign private specialist" },
  });
  const team = await saveCreatorDraft(workspace.actor, {
    id: randomUUID(),
    expectedRevision: null,
    content: { ...content, title: "Team workspace specialist" },
  });
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
      (await readAccountArchive(headers, archiveId)).creatorDrafts
    ).toEqual([{ id: source.id, title: content.title }]);
    const response = await downloadAccountArchive(
      headers,
      archiveId,
      "creator",
      source.id
    );
    expect(response.headers.get("cache-control")).toBe("private, no-store");
    expect(response.headers.get("content-disposition")).toContain(
      `zoen-creator-${source.id}.json`
    );
    expect(await response.json()).toEqual({
      format: "zoen-creator-draft",
      version: 1,
      draft: archived,
    });
    for (const id of [foreign.id, team.id, randomUUID()])
      await expect(
        downloadAccountArchive(headers, archiveId, "creator", id)
      ).rejects.toBeInstanceOf(AccountArchiveMissing);
    await expect(
      downloadAccountArchive(headers, randomUUID(), "creator", source.id)
    ).rejects.toBeInstanceOf(AccountArchiveMissing);
    await query(
      sql`DELETE FROM public.session WHERE id = ${workspace.guest.authSessionId}`
    );
    await expect(
      downloadAccountArchive(headers, archiveId, "creator", source.id)
    ).rejects.toBeInstanceOf(AccountControlError);
  } finally {
    await query(sql`DELETE FROM account_archive WHERE id = ${archiveId}`);
  }
});
