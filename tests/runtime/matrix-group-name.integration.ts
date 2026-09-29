import { randomUUID } from "node:crypto";
import { afterAll, beforeAll, expect, test, vi } from "vitest";
import { workspaceFixture } from "./workspace-fixture";
import { matrixReceiver } from "./matrix-fixture";
import { renameMatrixRoom } from "../../server/matrix/group-name";
import {
  createMatrixRoom,
  joinMatrixRoom,
  listMatrixRooms,
  readMatrixMessages,
  sendMatrixMessage,
} from "../../server/matrix/rooms";
import { readMatrixRoomSync } from "../../server/matrix/sync/room";
import * as matrix from "../../server/matrix/client";
import { WorkspaceAccessDenied } from "../../server/workspaces/access";
import { readInboxSyncHead } from "@db/services/inbox";

let receiver: Awaited<ReturnType<typeof matrixReceiver>> | undefined;
beforeAll(async () => {
  receiver = await matrixReceiver();
});
afterAll(async () => {
  await receiver?.close();
});

test(
  "group rename persists natively, rejects stale edits and reaches another member through sync",
  { timeout: 60000 },
  async () => {
    await using fixture = await workspaceFixture();
    const room = await createMatrixRoom(fixture.actor, {
      operationId: randomUUID(),
      name: "Synthetic original group",
    });
    await joinMatrixRoom(fixture.actor, room.id);
    await joinMatrixRoom(fixture.guest, room.id);
    const message = await sendMatrixMessage(fixture.actor, {
      id: room.id,
      operationId: randomUUID(),
      text: "Synthetic group name review",
    });
    await vi.waitFor(
      () => {
        expect(
          receiver?.receipts.some((item) =>
            item.body.includes(message.event_id)
          )
        ).toBe(true);
      },
      { timeout: 15000, interval: 100 }
    );
    const before = await readMatrixMessages(fixture.guest, room.id);
    const sync = await readMatrixRoomSync(fixture.guest, { id: room.id });
    expect(sync.status).toBe("ready");
    const input = {
      id: room.id,
      expectedName: room.label,
      name: "Synthetic renamed group",
    };
    const result = await renameMatrixRoom(fixture.actor, input);
    expect(result).toMatchObject({
      status: "saved",
      room: {
        label: input.name,
        epoch: before.room.epoch,
        roomId: room.roomId,
      },
    });
    expect(
      await matrix.matrixRequest(
        "GET",
        `rooms/${encodeURIComponent(room.roomId)}/state/m.room.name`
      )
    ).toEqual({ name: input.name });
    expect(await renameMatrixRoom(fixture.actor, input)).toEqual(result);
    expect(
      (await listMatrixRooms(fixture.guest)).rooms.find(
        (item) => item.id === room.id
      )?.label
    ).toBe(input.name);
    const head = await readInboxSyncHead(fixture.guest, {
      query: input.name,
      filter: "groups",
      archived: false,
    });
    expect(head.rows.map((item) => item.id)).toContain(room.id);
    const change = await readMatrixRoomSync(fixture.guest, {
      id: room.id,
      cursor: sync.cursor ?? undefined,
    });
    expect(change).toMatchObject({
      status: "ready",
      reset: false,
      timelineChanged: true,
      changes: null,
    });
    const after = await readMatrixMessages(fixture.guest, room.id);
    expect(after.room.label).toBe(input.name);
    expect(after.messages).toEqual(before.messages);
    const stale = await renameMatrixRoom(fixture.actor, {
      ...input,
      name: "Must not replace newer name",
    });
    expect(stale).toEqual({ status: "conflict", room: result.room });
    const concurrent = await Promise.all(
      ["Synthetic choice A", "Synthetic choice B"].map((name) =>
        renameMatrixRoom(fixture.actor, {
          id: room.id,
          expectedName: input.name,
          name,
        })
      )
    );
    expect(concurrent.map((item) => item.status).toSorted()).toEqual([
      "conflict",
      "saved",
    ]);
    const latest = concurrent.find((item) => item.status === "saved");
    if (!latest) throw new Error("Expected one saved rename");
    expect(
      concurrent.find((item) => item.status === "conflict")?.room.label
    ).toBe(latest.room.label);
    expect(
      await matrix.matrixRequest(
        "GET",
        `rooms/${encodeURIComponent(room.roomId)}/state/m.room.name`
      )
    ).toEqual({ name: latest.room.label });
    for (const denied of [
      fixture.guest,
      fixture.personal,
      { ...fixture.actor, authSessionId: undefined },
    ])
      await expect(
        renameMatrixRoom(denied, {
          id: room.id,
          expectedName: latest.room.label,
          name: "Forbidden change",
        })
      ).rejects.toThrow(WorkspaceAccessDenied);
    expect((await readMatrixMessages(fixture.guest, room.id)).room.label).toBe(
      latest.room.label
    );
  }
);

test("a failed native rename preserves the displayed name and can be retried", async () => {
  await using fixture = await workspaceFixture();
  const room = await createMatrixRoom(fixture.actor, {
    operationId: randomUUID(),
    name: "Synthetic failure baseline",
  });
  const input = {
    id: room.id,
    expectedName: room.label,
    name: "Synthetic retry name",
  };
  const native = vi
    .spyOn(matrix, "matrixRequest")
    .mockRejectedValueOnce(new matrix.MatrixError({ reason: "unavailable" }));
  try {
    await expect(renameMatrixRoom(fixture.actor, input)).rejects.toThrow(
      matrix.MatrixError
    );
  } finally {
    native.mockRestore();
  }
  expect((await listMatrixRooms(fixture.actor)).rooms[0]?.label).toBe(
    room.label
  );
  expect(await renameMatrixRoom(fixture.actor, input)).toMatchObject({
    status: "saved",
    room: { label: input.name },
  });
});
