import { randomUUID } from "node:crypto";
import { and, eq } from "drizzle-orm";
import { expect, test } from "vitest";
import { agentSessions, chats, db, workspaceMemberships } from "@db";
import { claimSession } from "@db/services/sessions";
import { listChats, readChat, saveChat } from "@db/services/chats";
import { changeChat, listChatLibrary } from "@db/services/chat-library";
import { workspaceFixture } from "./workspace-fixture";

test("conversation organization is private to the owner and denied after membership removal", async () => {
  await using fixture = await workspaceFixture();
  const sessionId = randomUUID();
  await claimSession(fixture.actor, sessionId);
  await saveChat(fixture.actor, { sessionId, title: "Synthetic conversation" });
  for (const scope of [
    fixture.guest,
    fixture.personal,
    fixture.guestPersonal,
  ]) {
    expect((await listChatLibrary(scope, {})).items).toEqual([]);
    expect(await readChat(scope, sessionId)).toBeUndefined();
    await expect(
      changeChat(scope, { sessionId, change: { title: "Forbidden" } })
    ).rejects.toThrow("Conversation not found");
    await expect(
      changeChat(scope, { sessionId, change: { archived: true } })
    ).rejects.toThrow("Conversation not found");
    await expect(
      changeChat(scope, { sessionId, change: { pinned: true } })
    ).rejects.toThrow("Conversation not found");
  }
  await db
    .delete(workspaceMemberships)
    .where(
      and(
        eq(workspaceMemberships.workspaceId, fixture.actor.workspaceId),
        eq(workspaceMemberships.userId, fixture.actor.userId)
      )
    );
  expect((await listChatLibrary(fixture.actor, {})).items).toEqual([]);
  await expect(
    changeChat(fixture.actor, { sessionId, change: { archived: true } })
  ).rejects.toThrow("Conversation not found");
});

test("independent edits preserve pin, archive and title; retry and restore do not lose conversation metadata", async () => {
  await using fixture = await workspaceFixture();
  const sessionId = randomUUID();
  await claimSession(fixture.actor, sessionId);
  await saveChat(fixture.actor, { sessionId, title: "Before" });
  const before = await readChat(fixture.actor, sessionId);
  await Promise.all([
    changeChat(fixture.actor, { sessionId, change: { title: "  Renamed  " } }),
    changeChat(fixture.actor, { sessionId, change: { pinned: true } }),
    changeChat(fixture.actor, { sessionId, change: { archived: true } }),
  ]);
  await changeChat(fixture.actor, { sessionId, change: { archived: true } });
  expect((await listChatLibrary(fixture.actor, {})).items).toEqual([]);
  expect(await listChats(fixture.actor)).toEqual([]);
  const archived = (await listChatLibrary(fixture.actor, { archived: true }))
    .items;
  expect(archived).toEqual([
    {
      sessionId,
      title: "Renamed",
      pinned: true,
      archived: true,
      updatedAt: before?.updatedAt,
    },
  ]);
  expect((await readChat(fixture.actor, sessionId))?.title).toBe("Renamed");
  await changeChat(fixture.actor, { sessionId, change: { archived: false } });
  await changeChat(fixture.actor, { sessionId, change: { pinned: false } });
  expect((await listChatLibrary(fixture.actor, {})).items[0]).toMatchObject({
    title: "Renamed",
    pinned: false,
    archived: false,
  });
  await expect(
    changeChat(fixture.actor, { sessionId, change: { title: "   " } })
  ).rejects.toThrow("Too small");
});

test("keyset pages cross pinned groups and timestamp ties without duplicates, and searches escape wildcards", async () => {
  await using fixture = await workspaceFixture();
  const ids = Array.from({ length: 67 }, () => randomUUID());
  await db.insert(agentSessions).values(
    ids.map((sessionId) => ({
      sessionId,
      workspaceId: fixture.actor.workspaceId,
      createdByUserId: fixture.actor.userId,
    }))
  );
  await db.insert(chats).values(
    ids.map((sessionId, i) => ({
      sessionId,
      workspaceId: fixture.actor.workspaceId,
      title: i === 0 ? "Budget 50%" : `Synthetic ${i}`,
      pinned: i < 35,
      updatedAt: new Date("2026-01-01T00:00:00Z"),
    }))
  );
  const first = await listChatLibrary(fixture.actor, {});
  expect(first.items).toHaveLength(30);
  expect(first.items.every((item) => item.pinned)).toBe(true);
  const second = await listChatLibrary(fixture.actor, {
    cursor: first.nextCursor,
  });
  const third = await listChatLibrary(fixture.actor, {
    cursor: second.nextCursor,
  });
  const all = [...first.items, ...second.items, ...third.items];
  expect(new Set(all.map((item) => item.sessionId)).size).toBe(67);
  expect(all.slice(0, 35).every((item) => item.pinned)).toBe(true);
  expect(all.slice(35).every((item) => !item.pinned)).toBe(true);
  expect(third.nextCursor).toBeNull();
  expect(
    (await listChatLibrary(fixture.actor, { query: "%" })).items.map(
      (item) => item.title
    )
  ).toEqual(["Budget 50%"]);
});
