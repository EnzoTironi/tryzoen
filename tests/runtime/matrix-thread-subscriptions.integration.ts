import { randomUUID } from "node:crypto";
import { expect, test, vi } from "vitest";
import { z } from "zod";
import { workspaceFixture } from "./workspace-fixture";
import { createMatrixRoom, joinMatrixRoom } from "../../server/matrix/rooms";
import { matrixRequest } from "../../server/matrix/client";
import {
  readThreadSubscription,
  setThreadSubscription,
} from "../../server/matrix/thread-subscriptions";
import { pollNativeSync } from "../../server/matrix/sync/native";
import { setRoomNotifications } from "../../server/matrix/notifications";
import { markMatrixRoomRead } from "../../server/matrix/read-position";
import { changeMatrixGroupMembership } from "../../server/matrix/membership";
import { WorkspaceAccessDenied } from "../../server/workspaces/access";

test(
  "native thread subscriptions are private, idempotent, authorized and control attention",
  { timeout: 90000 },
  async () => {
    await using fixture = await workspaceFixture();
    await using outsider = await workspaceFixture();
    const room = await createMatrixRoom(fixture.actor, {
      operationId: randomUUID(),
      name: "Synthetic followed thread",
    });
    const writer = await joinMatrixRoom(fixture.actor, room.id);
    const reader = await joinMatrixRoom(fixture.guest, room.id);
    const send = async (body: string, rootId?: string) =>
      z.object({ event_id: z.string() }).parse(
        await matrixRequest(
          "PUT",
          `rooms/${encodeURIComponent(room.roomId)}/send/m.room.message/${randomUUID()}`,
          {
            msgtype: "m.text",
            body,
            ...(rootId
              ? {
                  "m.relates_to": {
                    rel_type: "m.thread",
                    event_id: rootId,
                    is_falling_back: true,
                    "m.in_reply_to": { event_id: rootId },
                  },
                }
              : {}),
          },
          writer.matrixId
        )
      ).event_id;
    const rootId = await send("Subscription root");
    const input = { id: room.id, rootId };
    await markMatrixRoomRead(fixture.guest, { id: room.id, messageId: rootId });
    expect(await readThreadSubscription(fixture.guest, input)).toEqual({
      status: "ready",
      following: false,
      automatic: false,
    });
    const subscribed = { status: "ready", following: true, automatic: false };
    expect(
      await setThreadSubscription(fixture.guest, { ...input, following: true })
    ).toEqual(subscribed);
    expect(
      await setThreadSubscription(fixture.guest, { ...input, following: true })
    ).toEqual(subscribed);
    expect(await readThreadSubscription(fixture.actor, input)).toMatchObject({
      following: false,
    });
    await expect(readThreadSubscription(outsider.actor, input)).rejects.toThrow(
      WorkspaceAccessDenied
    );
    let cursor: string | undefined;
    const count = async (expected: number) => {
      await vi.waitFor(
        async () => {
          const page = await pollNativeSync(
            reader.matrixId,
            [room.roomId],
            cursor ?? null,
            "inbox"
          );
          cursor = page.next_batch;
          expect(
            page.rooms?.join?.[room.roomId]?.unread_notifications
              ?.notification_count
          ).toBe(expected);
        },
        { timeout: 10000, interval: 200 }
      );
    };
    const reply = await send("Followed reply", rootId);
    await count(1);
    await expect(
      setThreadSubscription(fixture.guest, {
        id: room.id,
        rootId: reply,
        following: true,
      })
    ).rejects.toThrow(WorkspaceAccessDenied);
    await markMatrixRoomRead(fixture.guest, {
      id: room.id,
      rootId,
      messageId: reply,
    });
    await count(0);
    await setRoomNotifications(fixture.guest, { id: room.id, muted: true });
    await send("Muted room still silences followed thread", rootId);
    cursor = undefined;
    await count(0);
    await setRoomNotifications(fixture.guest, { id: room.id, muted: false });
    expect(
      await setThreadSubscription(fixture.guest, { ...input, following: false })
    ).toMatchObject({ following: false });
    expect(
      await setThreadSubscription(fixture.guest, { ...input, following: false })
    ).toMatchObject({ following: false });
    await send("Unfollowed reply", rootId);
    cursor = undefined;
    await count(0);
    await changeMatrixGroupMembership(fixture.guest, {
      id: room.id,
      action: "leave",
    });
    await expect(
      setThreadSubscription(fixture.guest, { ...input, following: true })
    ).rejects.toThrow(WorkspaceAccessDenied);
  }
);
