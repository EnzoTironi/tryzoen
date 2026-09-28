import { randomUUID } from "node:crypto";
import { and, eq } from "drizzle-orm";
import { expect, test } from "vitest";
import { db, messageReactions, workspaceMemberships } from "@db";
import { claimSession } from "@db/services/sessions";
import {
  readMessageReactions,
  setMessageReaction,
} from "@db/services/message-reactions";
import { workspaceFixture } from "./workspace-fixture";

test("reactions are private to the conversation owner and workspace, including after revocation", async () => {
  await using fixture = await workspaceFixture();
  const sessionId = randomUUID();
  await claimSession(fixture.actor, sessionId);
  const change = { sessionId, messageId: "message-one", emoji: "❤️" };
  await setMessageReaction(fixture.actor, change);
  const read = { sessionId, messageIds: [change.messageId] };
  for (const other of [
    fixture.guest,
    fixture.personal,
    fixture.guestPersonal,
  ]) {
    expect(await readMessageReactions(other, read)).toEqual([]);
    await expect(setMessageReaction(other, change)).rejects.toThrow(
      "Conversation not found"
    );
    await expect(
      setMessageReaction(other, { ...change, emoji: null })
    ).rejects.toThrow("Conversation not found");
  }
  expect(await readMessageReactions(fixture.actor, read)).toEqual([
    { messageId: change.messageId, emoji: "❤️" },
  ]);
  await db
    .delete(workspaceMemberships)
    .where(
      and(
        eq(workspaceMemberships.workspaceId, fixture.actor.workspaceId),
        eq(workspaceMemberships.userId, fixture.actor.userId)
      )
    );
  expect(await readMessageReactions(fixture.actor, read)).toEqual([]);
  expect(
    await db
      .select()
      .from(messageReactions)
      .where(eq(messageReactions.sessionId, sessionId))
  ).toEqual([]);
  await expect(setMessageReaction(fixture.actor, change)).rejects.toThrow(
    "Conversation not found"
  );
});

test("retries set one reaction, replacement persists, and removal is idempotent", async () => {
  await using fixture = await workspaceFixture();
  const sessionId = randomUUID();
  await claimSession(fixture.actor, sessionId);
  const change = { sessionId, messageId: "message-one", emoji: "👍" };
  await Promise.all(
    Array.from({ length: 12 }, () => setMessageReaction(fixture.actor, change))
  );
  expect(
    await db
      .select()
      .from(messageReactions)
      .where(eq(messageReactions.sessionId, sessionId))
  ).toHaveLength(1);
  await setMessageReaction(fixture.actor, { ...change, emoji: "🦋" });
  expect(
    await readMessageReactions(fixture.actor, {
      sessionId,
      messageIds: [change.messageId],
    })
  ).toEqual([{ messageId: change.messageId, emoji: "🦋" }]);
  await setMessageReaction(fixture.actor, { ...change, emoji: null });
  await setMessageReaction(fixture.actor, { ...change, emoji: null });
  expect(
    await readMessageReactions(fixture.actor, {
      sessionId,
      messageIds: [change.messageId],
    })
  ).toEqual([]);
});

test("reaction reads are bounded to requested messages and reject arbitrary text", async () => {
  await using fixture = await workspaceFixture();
  const sessionId = randomUUID();
  await claimSession(fixture.actor, sessionId);
  await db.insert(messageReactions).values(
    Array.from({ length: 60 }, (_, i) => ({
      sessionId,
      messageId: `message-${i}`,
      emoji: "👍",
    }))
  );
  const messageIds = Array.from({ length: 50 }, (_, i) => `message-${i}`);
  const page = await readMessageReactions(fixture.actor, {
    sessionId,
    messageIds,
  });
  expect(page).toHaveLength(50);
  expect(page.every((item) => messageIds.includes(item.messageId))).toBe(true);
  await expect(
    readMessageReactions(fixture.actor, {
      sessionId,
      messageIds: [...messageIds, "extra"],
    })
  ).rejects.toThrow("Too big");
  await expect(
    setMessageReaction(fixture.actor, {
      sessionId,
      messageId: "invalid",
      emoji: "<script>",
    })
  ).rejects.toThrow("Choose an emoji");
});
