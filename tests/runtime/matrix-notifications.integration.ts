import { randomUUID } from "node:crypto";
import { afterAll, beforeAll, expect, test, vi } from "vitest";
import { z } from "zod";
import { workspaceFixture } from "./workspace-fixture";
import { matrixReceiver } from "./matrix-fixture";
import {
  createMatrixRoom,
  joinMatrixRoom,
  sendMatrixMessage,
} from "../../server/matrix/rooms";
import {
  readRoomNotifications,
  setRoomNotifications,
} from "../../server/matrix/notifications";
import { matrixRequest } from "../../server/matrix/client";
import { syncConversationInbox } from "../../server/matrix/sync";
import { markMatrixRoomRead } from "../../server/matrix/read-position";
import { saveDirectoryProfile } from "../../server/accounts/directory";
import { openDirectRoom } from "../../server/matrix/direct";
import { WorkspaceAccessDenied } from "../../server/workspaces/access";
import { setThreadSubscription } from "../../server/matrix/thread-subscriptions";

let receiver: Awaited<ReturnType<typeof matrixReceiver>>;
beforeAll(async () => {
  receiver = await matrixReceiver();
});
afterAll(async () => {
  await receiver.close();
});

test(
  "native notifications cover groups, mentions, thread receipts, DMs and mute without an app counter",
  { timeout: 60000 },
  async () => {
    await using fixture = await workspaceFixture();
    const { actor, guest } = fixture;
    const room = await createMatrixRoom(actor, {
      operationId: randomUUID(),
      name: "Synthetic native attention",
    });
    const author = await joinMatrixRoom(actor, room.id);
    const viewer = await joinMatrixRoom(guest, room.id);
    let cursor: string | undefined;
    let focusedRoomId = room.id;
    const poll = async () => {
      const page = await syncConversationInbox(guest, {
        cursor,
        focusedRoomId,
      });
      expect(page.status).toBe("ready");
      cursor = z.string().parse(page.cursor);
      return page;
    };
    const count = async (notificationCount: number, highlightCount = 0) => {
      await vi.waitFor(
        async () => {
          const page = await poll();
          expect(
            page.notifications?.find((item) => item.id === focusedRoomId)
          ).toEqual({
            id: focusedRoomId,
            notificationCount,
            highlightCount,
            markedUnread: false,
          });
        },
        { timeout: 10000, interval: 200 }
      );
    };
    const baseline = await sendMatrixMessage(actor, {
      id: room.id,
      operationId: randomUUID(),
      text: "Baseline",
    });
    await markMatrixRoomRead(guest, {
      id: room.id,
      messageId: baseline.event_id,
    });
    expect((await poll()).notifications).toBeNull();
    await count(0);
    const message = await sendMatrixMessage(actor, {
      id: room.id,
      operationId: randomUUID(),
      text: "Unread ordinary",
    });
    await count(1);
    const mention = z.object({ event_id: z.string() }).parse(
      await matrixRequest(
        "PUT",
        `rooms/${encodeURIComponent(room.roomId)}/send/m.room.message/${randomUUID()}`,
        {
          msgtype: "m.text",
          body: "Explicit mention",
          "m.mentions": { user_ids: [viewer.matrixId] },
        },
        author.matrixId
      )
    );
    await count(2, 1);
    await expect(
      syncConversationInbox(actor, { cursor, focusedRoomId })
    ).rejects.toThrow(WorkspaceAccessDenied);
    await markMatrixRoomRead(guest, {
      id: room.id,
      messageId: mention.event_id,
    });
    await count(0);
    await setThreadSubscription(guest, {
      id: room.id,
      rootId: message.event_id,
      following: true,
    });
    const reply = await sendMatrixMessage(actor, {
      id: room.id,
      operationId: randomUUID(),
      text: "Thread reply",
      rootId: message.event_id,
    });
    await count(1);
    await markMatrixRoomRead(guest, {
      id: room.id,
      messageId: reply.event_id,
      rootId: message.event_id,
    });
    await count(0);
    const username = `attention_${randomUUID().replaceAll("-", "").slice(0, 12)}`;
    await saveDirectoryProfile(guest, { username, discoverable: false });
    const direct = await openDirectRoom(actor, {
      username,
      operationId: randomUUID(),
    });
    await joinMatrixRoom(guest, direct.id);
    focusedRoomId = direct.id;
    cursor = undefined;
    expect((await poll()).notifications).toBeNull();
    const dm = await sendMatrixMessage(actor, {
      id: direct.id,
      operationId: randomUUID(),
      text: "Direct attention",
    });
    await count(1);
    await markMatrixRoomRead(guest, { id: direct.id, messageId: dm.event_id });
    await count(0);
    expect(await readRoomNotifications(guest, { id: direct.id })).toEqual({
      muted: false,
    });
    expect(
      await setRoomNotifications(guest, { id: direct.id, muted: true })
    ).toEqual({ muted: true });
    // Repeating the desired state is safe, and the sender's preference is independent.
    expect(
      await setRoomNotifications(guest, { id: direct.id, muted: true })
    ).toEqual({ muted: true });
    expect(await readRoomNotifications(actor, { id: direct.id })).toEqual({
      muted: false,
    });
    await sendMatrixMessage(actor, {
      id: direct.id,
      operationId: randomUUID(),
      text: "Muted message is not an unread notification",
    });
    await count(0);
    await matrixRequest(
      "PUT",
      `rooms/${encodeURIComponent(direct.roomId)}/send/m.room.message/${randomUUID()}`,
      {
        msgtype: "m.text",
        body: "Muted explicit mention",
        "m.mentions": { user_ids: [viewer.matrixId] },
      },
      author.matrixId
    );
    await count(0);
    expect(
      await setRoomNotifications(guest, { id: direct.id, muted: false })
    ).toEqual({ muted: false });
    expect(await readRoomNotifications(guest, { id: direct.id })).toEqual({
      muted: false,
    });
    await sendMatrixMessage(actor, {
      id: direct.id,
      operationId: randomUUID(),
      text: "Notifications restored",
    });
    await count(1);
    expect(
      await setRoomNotifications(guest, { id: room.id, muted: true })
    ).toEqual({ muted: true });
    expect(await readRoomNotifications(guest, { id: direct.id })).toEqual({
      muted: false,
    });
    focusedRoomId = room.id;
    cursor = undefined;
    await poll();
    await matrixRequest(
      "PUT",
      `rooms/${encodeURIComponent(room.roomId)}/send/m.room.message/${randomUUID()}`,
      {
        msgtype: "m.text",
        body: "Muted group mention",
        "m.mentions": { user_ids: [viewer.matrixId] },
      },
      author.matrixId
    );
    await count(0);
    for (const denied of [
      fixture.guestPersonal,
      { ...guest, authSessionId: undefined },
    ]) {
      await expect(
        readRoomNotifications(denied, { id: room.id })
      ).rejects.toThrow(WorkspaceAccessDenied);
      await expect(
        setRoomNotifications(denied, { id: room.id, muted: false })
      ).rejects.toThrow(WorkspaceAccessDenied);
    }
    expect(await readRoomNotifications(guest, { id: room.id })).toEqual({
      muted: true,
    });
  }
);
