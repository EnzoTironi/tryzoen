import { randomUUID } from "node:crypto";
import { sql } from "drizzle-orm";
import { afterAll, beforeAll, expect, test } from "vitest";
import { query } from "@db/queries";
import { listConversationInbox } from "@db/services/inbox";
import { saveDirectoryProfile } from "../../server/accounts/directory";
import { openDirectRoom } from "../../server/matrix/direct";
import {
  createMatrixRoom,
  readMatrixMessages,
} from "../../server/matrix/rooms";
import { sendMatrixMessage } from "../../server/matrix/send";
import { reconcileMatrixActivity } from "../../server/matrix/activity-reconcile";
import { WorkspaceAccessDenied } from "../../server/workspaces/access";
import { matrixReceiver } from "./matrix-fixture";
import { workspaceFixture } from "./workspace-fixture";

let receiver: Awaited<ReturnType<typeof matrixReceiver>>;
beforeAll(async () => {
  receiver = await matrixReceiver();
});
afterAll(async () => {
  await receiver.close();
});

test(
  "globally pages authorized agent, group and direct conversations before loading bounded previews",
  { timeout: 60_000 },
  async () => {
    await using workspace = await workspaceFixture();
    const { actor, guest } = workspace;
    const username = `peer_${randomUUID().replaceAll("-", "").slice(0, 12)}`;
    await saveDirectoryProfile(guest, { username, discoverable: false });
    const direct = await openDirectRoom(actor, {
      username,
      operationId: randomUUID(),
    });
    const group = await createMatrixRoom(actor, {
      name: "Inbox group",
      operationId: randomUUID(),
    });
    await readMatrixMessages(guest, direct.id);
    await readMatrixMessages(actor, direct.id);
    await readMatrixMessages(actor, group.id);
    await sendMatrixMessage(guest, {
      id: direct.id,
      operationId: randomUUID(),
      text: "Private direct preview",
    });
    await sendMatrixMessage(actor, {
      id: group.id,
      operationId: randomUUID(),
      text: "Group preview",
    });
    await reconcileMatrixActivity();
    const sessionIds = Array.from({ length: 34 }, () => randomUUID());
    for (const [index, id] of sessionIds.entries()) {
      await query(
        sql`INSERT INTO agent_sessions(session_id, workspace_id, created_by_user_id) VALUES (${id}, ${actor.workspaceId}, ${actor.userId})`
      );
      await query(sql`INSERT INTO chats(session_id, workspace_id, title, updated_at, pinned)
      VALUES (${id}, ${actor.workspaceId}, ${`Agent ${index}`}, ${index === 0 ? new Date(Date.now() + 60_000) : new Date(2020, 0, 1)}, ${index === 1})`);
    }
    const guestSession = randomUUID();
    await query(
      sql`INSERT INTO agent_sessions(session_id, workspace_id, created_by_user_id) VALUES (${guestSession}, ${actor.workspaceId}, ${guest.userId})`
    );
    await query(
      sql`INSERT INTO chats(session_id, workspace_id, title) VALUES (${guestSession}, ${actor.workspaceId}, 'Private guest agent')`
    );

    const first = await listConversationInbox(actor, {});
    expect(first.items).toHaveLength(30);
    expect(first.items[0]).toMatchObject({
      kind: "agent",
      chat: { sessionId: sessionIds[0] },
    });
    expect(first.items.slice(1, 3).map((item) => item.kind)).toEqual([
      "room",
      "room",
    ]);
    expect(first.pinned.map((item) => item.sessionId)).toEqual([sessionIds[1]]);
    expect(first.nextCursor).not.toBeNull();
    const second = await listConversationInbox(actor, {
      cursor: first.nextCursor,
    });
    expect(second.nextCursor).toBeNull();
    const items = [...first.items, ...second.items];
    const ids = items.map((item) =>
      item.kind === "room" ? item.room.id : item.chat.sessionId
    );
    expect(ids).toHaveLength(36);
    expect(new Set(ids).size).toBe(36);
    expect(ids).not.toContain(guestSession);
    expect(first.items.filter((item) => item.kind === "room")).toHaveLength(2);

    const people = await listConversationInbox(actor, {
      filter: "people",
      query: username,
    });
    expect(people.items).toHaveLength(1);
    expect(people.items[0]).toMatchObject({
      kind: "room",
      room: { id: direct.id, workspaceId: actor.workspaceId },
      preview: "Private direct preview",
    });
    expect((await listConversationInbox(actor, { query: "%_" })).items).toEqual(
      []
    );
    expect(
      (await listConversationInbox(actor, { archived: true })).items
    ).toEqual([]);
    await query(
      sql`UPDATE chats SET archived = true WHERE session_id = ${sessionIds[0]}`
    );
    expect(
      (await listConversationInbox(actor, { archived: true })).items
    ).toHaveLength(1);
    await query(
      sql`DELETE FROM workspace_memberships WHERE workspace_id = ${actor.workspaceId} AND user_id = ${guest.userId}`
    );
    expect(
      (await listConversationInbox(actor, { filter: "people" })).items
    ).toEqual([]);
    await expect(listConversationInbox(guest, {})).rejects.toBeInstanceOf(
      WorkspaceAccessDenied
    );
  }
);
