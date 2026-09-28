import { and, eq } from "drizzle-orm";
import { expect, test } from "vitest";
import { db, personalFeedPosts, workspaceMemberships } from "@db";
import {
  deleteFeedPost,
  likeFeedPost,
  listFeedPosts,
  publishFeedPost,
  readFeedPost,
  readFeedInstructions,
  saveFeedInstructions,
} from "@db/services/feed";
import { workspaceFixture } from "./workspace-fixture";

test("concurrent publications produce one private immutable post and deletion survives replay", async () => {
  await using fixture = await workspaceFixture();
  const content = {
    key: "reading-2026-09-27",
    title: "A small reading habit",
    content: "Read for fifteen minutes tonight.",
    rationale: "The synthetic owner asked for a reading routine.",
    sources: [],
  };
  const receipts = await Promise.all(
    Array.from({ length: 20 }, () => publishFeedPost(fixture.actor, content))
  );
  const id = receipts[0]?.id;
  if (!id) throw new Error("Publication returned no receipt");
  expect(new Set(receipts.map((item) => item.id)).size).toBe(1);
  await publishFeedPost(fixture.actor, {
    ...content,
    content: "A retry must not change the edition.",
  });
  expect((await readFeedPost(fixture.actor, id)).content).toBe(content.content);
  expect((await listFeedPosts(fixture.guest)).items).toEqual([]);
  await expect(readFeedPost(fixture.guest, id)).rejects.toThrow("not found");
  await expect(likeFeedPost(fixture.guest, id, true)).rejects.toThrow(
    "not found"
  );
  await deleteFeedPost(fixture.guest, id);
  await Promise.all(
    Array.from({ length: 5 }, () => likeFeedPost(fixture.actor, id, true))
  );
  expect((await readFeedPost(fixture.actor, id)).liked).toBe(true);
  await likeFeedPost(fixture.actor, id, false);
  expect((await readFeedPost(fixture.actor, id)).liked).toBe(false);
  await deleteFeedPost(fixture.actor, id);
  await deleteFeedPost(fixture.actor, id);
  expect(await publishFeedPost(fixture.actor, content)).toEqual({
    id,
    deleted: true,
  });
  expect((await listFeedPosts(fixture.actor)).items).toEqual([]);
  await expect(readFeedPost(fixture.actor, id)).rejects.toThrow("not found");
  const [receipt] = await db
    .select()
    .from(personalFeedPosts)
    .where(eq(personalFeedPosts.id, id));
  expect(receipt?.content).toBeNull();
  expect(receipt?.liked).toBe(false);
});

test("membership removal erases private posts and prevents republication", async () => {
  await using fixture = await workspaceFixture();
  const content = {
    key: "reading",
    title: "Reading",
    content: "Read tonight.",
    rationale: "Requested.",
    sources: [],
  };
  await publishFeedPost(fixture.guest, content);
  await db
    .delete(workspaceMemberships)
    .where(
      and(
        eq(workspaceMemberships.workspaceId, fixture.guest.workspaceId),
        eq(workspaceMemberships.userId, fixture.guest.userId)
      )
    );
  expect((await listFeedPosts(fixture.guest)).items).toEqual([]);
  await expect(publishFeedPost(fixture.guest, content)).rejects.toThrow(
    "Failed query"
  );
});

test("personal Feed instructions reject stale writes, survive retries and remain private", async () => {
  await using fixture = await workspaceFixture();
  expect(await readFeedInstructions(fixture.actor)).toEqual({
    content: "",
    revision: 0,
  });
  const choices = await Promise.allSettled([
    saveFeedInstructions(fixture.actor, {
      content: "Reading and walking",
      revision: 0,
    }),
    saveFeedInstructions(fixture.actor, { content: "Technology", revision: 0 }),
  ]);
  expect(
    choices.filter((result) => result.status === "fulfilled")
  ).toHaveLength(1);
  const current = await readFeedInstructions(fixture.actor);
  expect(current.revision).toBe(1);
  expect(
    await saveFeedInstructions(fixture.actor, { ...current, revision: 0 })
  ).toEqual(current);
  expect(await readFeedInstructions(fixture.guest)).toEqual({
    content: "",
    revision: 0,
  });
  const update = await saveFeedInstructions(fixture.actor, {
    content: "**Reading** and short practical posts.",
    revision: 1,
  });
  expect(update.revision).toBe(2);
  await expect(
    saveFeedInstructions(fixture.actor, { content: "Old tab", revision: 1 })
  ).rejects.toThrow("changed on another device");
  expect(await readFeedInstructions(fixture.actor)).toEqual(update);
});
