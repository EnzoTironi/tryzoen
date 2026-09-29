import { randomUUID } from "node:crypto";
import { expect, test } from "vitest";
import { sql } from "drizzle-orm";
import { query } from "@db/queries";
import { workspaceFixture } from "./workspace-fixture";
import {
  createMatrixRoom,
  joinMatrixRoom,
  sendMatrixMessage,
} from "../../server/matrix/rooms";
import {
  markMatrixRoomRead,
  readReadReceiptPreference,
  setReadReceiptPreference,
} from "../../server/matrix/read-position";
import { readMatrixRoomSync } from "../../server/matrix/sync/room";
import { WorkspaceAccessDenied } from "../../server/workspaces/access";

test(
  "public read receipts require human opt-in and preserve thread and membership boundaries",
  { timeout: 60000 },
  async () => {
    await using fixture = await workspaceFixture();
    await using outsider = await workspaceFixture();
    const room = await createMatrixRoom(fixture.actor, {
      operationId: randomUUID(),
      name: "Synthetic read receipts",
    });
    const reader = await joinMatrixRoom(fixture.guest, room.id);
    let cursor: string | undefined;
    const sync = async () => {
      const result = await readMatrixRoomSync(fixture.actor, {
        id: room.id,
        cursor,
      });
      expect(result.status).toBe("ready");
      cursor = result.cursor ?? undefined;
      return result;
    };
    const send = (text: string, rootId?: string) =>
      sendMatrixMessage(fixture.actor, {
        id: room.id,
        operationId: randomUUID(),
        text,
        rootId,
      });
    const first = await send("Privately read");
    expect(await readReadReceiptPreference(fixture.guest, room.id)).toEqual({
      enabled: false,
    });
    await markMatrixRoomRead(fixture.guest, {
      id: room.id,
      messageId: first.event_id,
    });
    expect((await sync()).receipts).toEqual([]);
    await expect(
      setReadReceiptPreference(outsider.actor, room.id, true)
    ).rejects.toThrow(WorkspaceAccessDenied);
    await expect(
      setReadReceiptPreference(
        { ...fixture.guest, authSessionId: undefined },
        room.id,
        true
      )
    ).rejects.toThrow(WorkspaceAccessDenied);

    await setReadReceiptPreference(fixture.guest, room.id, true);
    expect(await readReadReceiptPreference(fixture.actor, room.id)).toEqual({
      enabled: false,
    });
    const second = await send("Publicly read");
    await markMatrixRoomRead(fixture.guest, {
      id: room.id,
      messageId: second.event_id,
    });
    const publicRead = await sync();
    expect(publicRead.status).toBe("ready");
    expect(publicRead.receipts).toContainEqual(
      expect.objectContaining({
        userId: reader.matrixId,
        messageId: second.event_id,
        threadId: "main",
      })
    );
    const child = await send("Read inside the thread", first.event_id);
    await markMatrixRoomRead(fixture.guest, {
      id: room.id,
      messageId: child.event_id,
      rootId: first.event_id,
    });
    const threaded = await sync();
    expect(threaded.receipts).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          userId: reader.matrixId,
          messageId: child.event_id,
          threadId: first.event_id,
        }),
      ])
    );
    await expect(
      markMatrixRoomRead(fixture.guest, {
        id: room.id,
        messageId: child.event_id,
      })
    ).rejects.toThrow(WorkspaceAccessDenied);

    await setReadReceiptPreference(fixture.guest, room.id, false);
    const third = await send("Private again");
    await markMatrixRoomRead(fixture.guest, {
      id: room.id,
      messageId: third.event_id,
    });
    const optedOut = await sync();
    expect(
      optedOut.receipts.some((receipt) => receipt.messageId === third.event_id)
    ).toBe(false);
    await query(
      sql`UPDATE matrix_room_members SET state = 'removed' WHERE binding_id = ${room.id} AND user_id = ${fixture.guest.userId}`
    );
    expect((await sync()).receipts).toEqual([]);
    await expect(
      markMatrixRoomRead(fixture.guest, {
        id: room.id,
        messageId: third.event_id,
      })
    ).rejects.toThrow(WorkspaceAccessDenied);
    await expect(
      setReadReceiptPreference(fixture.guest, room.id, true)
    ).rejects.toThrow(WorkspaceAccessDenied);
  }
);
