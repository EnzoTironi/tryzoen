import { randomUUID } from "node:crypto";
import { query } from "@db/queries";
import { sql } from "drizzle-orm";
import { ZodError } from "zod";
import { expect, test } from "vitest";
import { creatorDraftContentSchema } from "@zoen/companion-ui/creators";
import {
  CreatorDraftConflict,
  listCreatorDrafts,
  readCreatorDraft,
  saveCreatorDraft,
} from "../../server/creators/drafts";
import { WorkspaceAccessDenied } from "../../server/workspaces/access";
import { workspaceFixture } from "./workspace-fixture";

const content = creatorDraftContentSchema.parse({
  title: "Fictional book-club coach",
  description: "Practice choosing a reading discussion strategy.",
  playbook: "# Strategies\n\nAsk an open question before giving a suggestion.",
  examples: [
    {
      id: randomUUID(),
      title: "A quiet group",
      content: "# Situation\n\nInvite each person to choose one passage.",
      source: "Original synthetic example created for this test.",
      rights: "original",
    },
  ],
});

test("creator drafts stay private within a workspace, reject forged authority and disappear with membership", async () => {
  await using workspace = await workspaceFixture();
  const input = { id: randomUUID(), expectedRevision: null, content };
  const saved = await saveCreatorDraft(workspace.actor, input);
  expect(await readCreatorDraft(workspace.actor, saved.id)).toEqual(saved);
  expect(await listCreatorDrafts(workspace.guest)).toEqual([]);
  expect(await listCreatorDrafts(workspace.personal)).toEqual([]);
  for (const actor of [
    workspace.guest,
    workspace.personal,
    { ...workspace.guest, authSessionId: workspace.actor.authSessionId },
  ]) {
    await expect(readCreatorDraft(actor, saved.id)).rejects.toBeInstanceOf(
      WorkspaceAccessDenied
    );
    await expect(saveCreatorDraft(actor, input)).rejects.toBeInstanceOf(
      WorkspaceAccessDenied
    );
  }
  await expect(
    readCreatorDraft(
      {
        ...workspace.actor,
        authSessionId: undefined,
        agentGrantId: randomUUID(),
      },
      saved.id
    )
  ).rejects.toBeInstanceOf(WorkspaceAccessDenied);
  await query(
    sql`DELETE FROM workspace_memberships WHERE workspace_id = ${workspace.actor.workspaceId} AND user_id = ${workspace.actor.userId}`
  );
  expect(
    await query(sql`SELECT id FROM creator_drafts WHERE id = ${saved.id}`)
  ).toEqual([]);
  await expect(
    readCreatorDraft(workspace.actor, saved.id)
  ).rejects.toBeInstanceOf(WorkspaceAccessDenied);
});

test("revision conflicts cannot replace newer work and exact response-loss retries are idempotent", async () => {
  await using workspace = await workspaceFixture();
  const input = { id: randomUUID(), expectedRevision: null, content };
  const saved = await saveCreatorDraft(workspace.personal, input);
  expect(await saveCreatorDraft(workspace.personal, input)).toEqual(saved);
  const attempts = await Promise.allSettled(
    ["First", "Second"].map((title) =>
      saveCreatorDraft(workspace.personal, {
        ...input,
        expectedRevision: saved.revision,
        content: { ...content, title },
      })
    )
  );
  expect(
    attempts.filter((result) => result.status === "fulfilled")
  ).toHaveLength(1);
  const failure = attempts.find((result) => result.status === "rejected");
  expect(failure?.reason).toBeInstanceOf(CreatorDraftConflict);
  await expect(
    saveCreatorDraft(workspace.personal, input)
  ).rejects.toBeInstanceOf(CreatorDraftConflict);
  expect(
    (await readCreatorDraft(workspace.personal, saved.id)).revision
  ).not.toBe(saved.revision);
});

test("concurrent draft creation enforces the per-person bound without truncating another person's list", async () => {
  await using workspace = await workspaceFixture();
  const results = await Promise.allSettled(
    Array.from({ length: 25 }, (_, index) =>
      saveCreatorDraft(workspace.actor, {
        id: randomUUID(),
        expectedRevision: null,
        content: { ...content, title: `Synthetic ${index}` },
      })
    )
  );
  expect(
    results.filter((result) => result.status === "fulfilled")
  ).toHaveLength(20);
  expect(results.filter((result) => result.status === "rejected")).toHaveLength(
    5
  );
  expect(await listCreatorDrafts(workspace.actor)).toHaveLength(20);
  const guest = await saveCreatorDraft(workspace.guest, {
    id: randomUUID(),
    expectedRevision: null,
    content,
  });
  expect(
    (await listCreatorDrafts(workspace.guest)).map((item) => item.id)
  ).toEqual([guest.id]);
});

test("authored examples require bounded source attribution, declared rights and distinct IDs", async () => {
  await using workspace = await workspaceFixture();
  const example = content.examples[0];
  if (!example) throw new Error("Missing synthetic example");
  for (const examples of [
    [{ ...example, source: "" }],
    [{ ...example, rights: "unknown" }],
    [example, example],
    [{ ...example, content: "x".repeat(24001) }],
  ]) {
    await expect(
      Promise.resolve().then(() =>
        saveCreatorDraft(workspace.personal, {
          id: randomUUID(),
          expectedRevision: null,
          content: creatorDraftContentSchema.parse({ ...content, examples }),
        })
      )
    ).rejects.toBeInstanceOf(ZodError);
  }
  expect(await listCreatorDrafts(workspace.personal)).toEqual([]);
});
