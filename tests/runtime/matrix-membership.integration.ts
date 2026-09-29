import { randomUUID } from "node:crypto";
import { sql } from "drizzle-orm";
import { afterAll, beforeAll, expect, test, vi } from "vitest";
import { query } from "@db/queries";
import { workspaceFixture } from "./workspace-fixture";
import { matrixReceiver } from "./matrix-fixture";
import {
  createMatrixRoom,
  joinMatrixRoom,
  listMatrixRooms,
  readMatrixMessages,
  sendMatrixMessage,
} from "../../server/matrix/rooms";
import {
  changeMatrixGroupMembership,
  readNativeGroupMembership,
  reconcileGroupDepartures,
} from "../../server/matrix/membership";
import { readMatrixRoomSync } from "../../server/matrix/sync/room";
import {
  WorkspaceAccessDenied,
  requireWorkspaceAccess,
} from "../../server/workspaces/access";
import { readInboxSyncHead } from "@db/services/inbox";
import * as matrix from "../../server/matrix/client";

let receiver: Awaited<ReturnType<typeof matrixReceiver>> | undefined;
beforeAll(async () => {
  receiver = await matrixReceiver();
});
afterAll(async () => {
  await receiver?.close();
});

test(
  "leave blocks auto-join, inbox and agent authority; administrator re-add restores native membership",
  { timeout: 60000 },
  async () => {
    await using fixture = await workspaceFixture();
    const username = `g${randomUUID().replaceAll("-", "").slice(0, 20)}`;
    await query(
      sql`INSERT INTO user_directory(user_id, username) VALUES (${fixture.guest.userId.replace("better-auth:", "")}, ${username})`
    );
    const room = await createMatrixRoom(fixture.actor, {
      operationId: randomUUID(),
      name: "Synthetic membership lifecycle",
    });
    await joinMatrixRoom(fixture.actor, room.id);
    const guest = await joinMatrixRoom(fixture.guest, room.id);
    const message = await sendMatrixMessage(fixture.guest, {
      id: room.id,
      operationId: randomUUID(),
      text: "Retain this synthetic message",
    });
    const cursor = await readMatrixRoomSync(fixture.guest, { id: room.id });
    const leave = { id: room.id, action: "leave" as const };
    expect(await changeMatrixGroupMembership(fixture.guest, leave)).toEqual({
      nativePending: false,
    });
    expect(await changeMatrixGroupMembership(fixture.guest, leave)).toEqual({
      nativePending: false,
    });
    expect(await readNativeGroupMembership(room.roomId, guest.matrixId)).toBe(
      "leave"
    );
    await expect(
      readMatrixMessages(fixture.guest, room.id)
    ).rejects.toBeInstanceOf(WorkspaceAccessDenied);
    await expect(joinMatrixRoom(fixture.guest, room.id)).rejects.toBeInstanceOf(
      WorkspaceAccessDenied
    );
    await expect(
      readMatrixRoomSync(fixture.guest, {
        id: room.id,
        cursor: cursor.cursor ?? undefined,
      })
    ).resolves.toMatchObject({
      status: "denied",
      changes: null,
      userIds: [],
      cursor: null,
    });
    expect((await listMatrixRooms(fixture.guest)).rooms).toEqual([]);
    expect(
      (
        await readInboxSyncHead(
          fixture.guest,
          {
            query: "",
            filter: "groups",
            archived: false,
          },
          room.id
        )
      ).rows
    ).toEqual([]);
    await expect(
      requireWorkspaceAccess({
        userId: fixture.guest.userId,
        workspaceId: fixture.guest.workspaceId,
        matrixIdentityId: guest.matrixId,
        groupBindingId: room.id,
        groupEpoch: guest.epoch,
      })
    ).rejects.toBeInstanceOf(WorkspaceAccessDenied);
    expect(
      (await readMatrixMessages(fixture.actor, room.id)).messages.some(
        (item) => item.id === message.event_id
      )
    ).toBe(true);
    await expect(
      changeMatrixGroupMembership(fixture.guest, {
        id: room.id,
        action: "add",
        username,
      })
    ).rejects.toBeInstanceOf(WorkspaceAccessDenied);
    expect(
      await changeMatrixGroupMembership(fixture.actor, {
        id: room.id,
        action: "add",
        username,
      })
    ).toEqual({ nativePending: false });
    expect(await readNativeGroupMembership(room.roomId, guest.matrixId)).toBe(
      "join"
    );
    await vi.waitFor(
      () => {
        expect(
          receiver?.receipts.some((item) =>
            item.body.includes(message.event_id)
          )
        ).toBe(true);
      },
      { timeout: 15000 }
    );
    expect(
      (await readMatrixMessages(fixture.guest, room.id)).members.some(
        (member) => member.mine
      )
    ).toBe(true);
    const after = await sendMatrixMessage(fixture.guest, {
      id: room.id,
      operationId: randomUUID(),
      text: "Back after explicit addition",
    });
    expect(
      (await readMatrixMessages(fixture.actor, room.id)).messages.some(
        (item) => item.id === after.event_id
      )
    ).toBe(true);
  }
);

test(
  "failed native retirement never restores product access and durable retry completes removal",
  { timeout: 60000 },
  async () => {
    await using fixture = await workspaceFixture();
    const username = `g${randomUUID().replaceAll("-", "").slice(0, 20)}`;
    await query(
      sql`INSERT INTO user_directory(user_id, username) VALUES (${fixture.guest.userId.replace("better-auth:", "")}, ${username})`
    );
    const room = await createMatrixRoom(fixture.actor, {
      operationId: randomUUID(),
      name: "Synthetic retirement failure",
    });
    await joinMatrixRoom(fixture.actor, room.id);
    const guest = await joinMatrixRoom(fixture.guest, room.id);
    const original = matrix.matrixRequest;
    const failure = vi
      .spyOn(matrix, "matrixRequest")
      .mockImplementation(async (...args) => {
        if (args[0] === "POST" && args[1].endsWith("/kick"))
          throw new matrix.MatrixError({ reason: "unavailable" });
        return original(...args);
      });
    try {
      expect(
        await changeMatrixGroupMembership(fixture.actor, {
          id: room.id,
          action: "remove",
          username,
        })
      ).toEqual({ nativePending: true });
    } finally {
      failure.mockRestore();
    }
    expect(await readNativeGroupMembership(room.roomId, guest.matrixId)).toBe(
      "join"
    );
    await expect(
      readMatrixMessages(fixture.guest, room.id)
    ).rejects.toBeInstanceOf(WorkspaceAccessDenied);
    await expect(
      sendMatrixMessage(fixture.guest, {
        id: room.id,
        operationId: randomUUID(),
        text: "Must not send",
      })
    ).rejects.toBeInstanceOf(WorkspaceAccessDenied);
    await query(
      sql`UPDATE matrix_room_members SET native_retry_at = now() WHERE binding_id = ${room.id} AND user_id = ${fixture.guest.userId}`
    );
    await reconcileGroupDepartures();
    expect(await readNativeGroupMembership(room.roomId, guest.matrixId)).toBe(
      "leave"
    );
    expect(
      await query(
        sql`SELECT state, native_pending FROM matrix_room_members WHERE binding_id = ${room.id} AND user_id = ${fixture.guest.userId}`
      )
    ).toEqual([{ state: "removed", native_pending: false }]);
    await expect(
      changeMatrixGroupMembership(
        { ...fixture.actor, authSessionId: undefined },
        { id: room.id, action: "add", username }
      )
    ).rejects.toBeInstanceOf(WorkspaceAccessDenied);
    await expect(
      changeMatrixGroupMembership(fixture.personal, {
        id: room.id,
        action: "add",
        username,
      })
    ).rejects.toBeInstanceOf(WorkspaceAccessDenied);
  }
);
