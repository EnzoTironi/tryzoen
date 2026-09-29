import { randomUUID } from "node:crypto";
import { afterAll, beforeAll, expect, test } from "vitest";
import { sql } from "drizzle-orm";
import { query } from "@db/queries";
import { workspaceFixture } from "./workspace-fixture";
import { matrixReceiver } from "./matrix-fixture";
import {
  createMatrixRoom,
  readMatrixMessages,
} from "../../server/matrix/rooms";
import { sendMatrixMessage } from "../../server/matrix/send";
import { syncConversationInbox } from "../../server/matrix/sync";
import { WorkspaceAccessDenied } from "../../server/workspaces/access";

let receiver: Awaited<ReturnType<typeof matrixReceiver>> | undefined;
beforeAll(async () => {
  receiver = await matrixReceiver();
});
afterAll(async () => receiver?.close());

test(
  "a limited native sync recovers a multi-page message burst and fences resumed history after revocation",
  { timeout: 120_000 },
  async () => {
    await using fixture = await workspaceFixture();
    const room = await createMatrixRoom(fixture.actor, {
      operationId: randomUUID(),
      name: "Synthetic history reconnection",
    });
    await readMatrixMessages(fixture.guest, room.id);
    const anchor = await sendMatrixMessage(fixture.actor, {
      id: room.id,
      operationId: randomUUID(),
      text: "Synthetic last seen message before disconnection.",
    });
    const before = await syncConversationInbox(fixture.guest, {
      focusedRoomId: room.id,
    });
    expect(before.status).toBe("ready");
    expect(before.cursor).not.toBeNull();
    const expected = [anchor.event_id];
    for (let index = 0; index < 135; index++) {
      const event = await sendMatrixMessage(fixture.actor, {
        id: room.id,
        operationId: randomUUID(),
        text: `Synthetic disconnected message ${index}.`,
      });
      expected.push(event.event_id);
    }
    const resumed = await syncConversationInbox(fixture.guest, {
      focusedRoomId: room.id,
      cursor: before.cursor ?? undefined,
    });
    expect(resumed.status).toBe("ready");
    expect(resumed.gapRoomIds).toContain(room.id);
    expect(resumed.changedRoomIds).toContain(room.id);
    const newest = await readMatrixMessages(fixture.guest, room.id);
    expect(newest.messages).toHaveLength(100);
    expect(newest.messages.map((message) => message.id)).not.toContain(
      anchor.event_id
    );
    expect(newest.nextCursor).not.toBeNull();
    const older = await readMatrixMessages(
      fixture.guest,
      room.id,
      newest.nextCursor ?? undefined
    );
    const recovered = [...older.messages, ...newest.messages].map(
      (message) => message.id
    );
    expect(recovered).toEqual(expected);
    expect(new Set(recovered).size).toBe(136);

    await query(
      sql`DELETE FROM organization_memberships WHERE user_id = ${fixture.guest.userId}`
    );
    await expect(
      readMatrixMessages(fixture.guest, room.id, newest.nextCursor ?? undefined)
    ).rejects.toBeInstanceOf(WorkspaceAccessDenied);
    await expect(
      syncConversationInbox(fixture.guest, {
        focusedRoomId: room.id,
        cursor: resumed.cursor ?? undefined,
      })
    ).rejects.toBeInstanceOf(WorkspaceAccessDenied);
  }
);
