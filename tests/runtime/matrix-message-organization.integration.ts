import {
  markMatrixRoomRead,
  setMatrixRoomUnread,
} from "../../server/matrix/read-position";
import { pollNativeSync } from "../../server/matrix/sync/native";
import { randomUUID } from "node:crypto";
import { expect, test } from "vitest";
import { workspaceFixture } from "./workspace-fixture";
import { createMatrixRoom, joinMatrixRoom } from "../../server/matrix/rooms";
import { matrixRequest } from "../../server/matrix/client";
import { readMatrixPins, setMatrixPin } from "../../server/matrix/pins";
import {
  readMatrixReactors,
  setMatrixReaction,
} from "../../server/matrix/reactions";
import { readMatrixRoomSync } from "../../server/matrix/sync/room";
import { WorkspaceAccessDenied } from "../../server/workspaces/access";
import { z } from "zod";
import { readMatrixContext } from "../../server/matrix/context";
import {
  roomMessageUrl,
  parseRoomMessageLocation,
} from "../../packages/companion-ui/src/rooms/links";

test(
  "native pins and reactor identities preserve room authorization and reviewed state",
  { timeout: 90000 },
  async () => {
    await using fixture = await workspaceFixture();
    await using outsider = await workspaceFixture();
    const room = await createMatrixRoom(fixture.actor, {
      operationId: randomUUID(),
      name: "Synthetic pinned messages",
    });
    const writer = await joinMatrixRoom(fixture.actor, room.id);
    const guest = await joinMatrixRoom(fixture.guest, room.id);
    const send = async (body: string) =>
      z
        .object({ event_id: z.string() })
        .parse(
          await matrixRequest(
            "PUT",
            `rooms/${encodeURIComponent(room.roomId)}/send/m.room.message/${randomUUID()}`,
            { msgtype: "m.text", body },
            writer.matrixId
          )
        ).event_id;
    const first = await send("First pinned reference");
    const second = await send("Second pinned reference");
    const link = roomMessageUrl("https://app.tryzoen.com", {
      id: room.id,
      workspaceId: room.workspaceId,
      messageId: first,
    });
    const location = parseRoomMessageLocation(new URL(link).searchParams);
    expect(location?.workspaceId).toBe(fixture.actor.workspaceId);
    if (!location) throw new Error("Expected a valid message link");
    expect(await readMatrixContext(fixture.guest, location)).toMatchObject({
      room: { id: room.id, workspaceId: fixture.actor.workspaceId },
      target: { id: first, text: "First pinned reference" },
    });
    await expect(readMatrixContext(outsider.actor, location)).rejects.toThrow(
      WorkspaceAccessDenied
    );
    await markMatrixRoomRead(fixture.actor, { id: room.id, messageId: first });
    const accountData = (kind: string) =>
      matrixRequest(
        "GET",
        `user/${encodeURIComponent(writer.matrixId)}/rooms/${encodeURIComponent(room.roomId)}/account_data/${kind}`,
        undefined,
        writer.matrixId
      );
    const readBefore = await accountData("m.fully_read");
    const syncBefore = await pollNativeSync(
      writer.matrixId,
      [room.roomId],
      null,
      "inbox"
    );
    await setMatrixRoomUnread(fixture.actor, { id: room.id, unread: true });
    expect(await accountData("m.marked_unread")).toEqual({ unread: true });
    expect(await accountData("m.fully_read")).toEqual(readBefore);
    const syncAfter = await pollNativeSync(
      writer.matrixId,
      [room.roomId],
      syncBefore.next_batch,
      "inbox"
    );
    expect(
      syncAfter.rooms?.join?.[room.roomId]?.account_data?.events
    ).toContainEqual({ type: "m.marked_unread", content: { unread: true } });
    await expect(
      setMatrixRoomUnread(outsider.actor, { id: room.id, unread: true })
    ).rejects.toThrow(WorkspaceAccessDenied);
    await markMatrixRoomRead(fixture.actor, { id: room.id, messageId: first });
    expect(await accountData("m.marked_unread")).toEqual({ unread: false });
    const empty = await readMatrixPins(fixture.actor, { id: room.id });
    expect(empty).toMatchObject({
      messageIds: [],
      mayManage: true,
      messages: [],
    });
    expect(await readMatrixPins(fixture.guest, { id: room.id })).toMatchObject({
      mayManage: false,
    });
    await expect(
      setMatrixPin(fixture.guest, {
        id: room.id,
        messageId: first,
        pinned: true,
        expectedRevision: empty.revision,
      })
    ).rejects.toThrow(WorkspaceAccessDenied);
    const baseline = await readMatrixRoomSync(fixture.actor, { id: room.id });
    const pinned = await setMatrixPin(fixture.actor, {
      id: room.id,
      messageId: first,
      pinned: true,
      expectedRevision: empty.revision,
    });
    expect(pinned).toMatchObject({
      status: "saved",
      pins: { messageIds: [first] },
    });
    expect(
      await setMatrixPin(fixture.actor, {
        id: room.id,
        messageId: second,
        pinned: true,
        expectedRevision: empty.revision,
      })
    ).toMatchObject({ status: "conflict", pins: { messageIds: [first] } });
    const synced = await readMatrixRoomSync(fixture.actor, {
      id: room.id,
      cursor: baseline.cursor ?? undefined,
    });
    expect(synced).toMatchObject({ status: "ready", pinsChanged: true });
    const listed = await readMatrixPins(fixture.guest, {
      id: room.id,
      includeMessages: true,
    });
    expect(listed.messages).toMatchObject([
      { id: first, text: "First pinned reference" },
    ]);
    await setMatrixReaction(fixture.guest, {
      id: room.id,
      messageId: first,
      emoji: "❤️",
      operationId: randomUUID(),
    });
    const reactors = await readMatrixReactors(fixture.actor, {
      id: room.id,
      messageId: first,
    });
    expect(reactors.items).toMatchObject([
      { emoji: "❤️", person: { id: guest.matrixId, mine: false, bot: false } },
    ]);
    await expect(
      readMatrixReactors(outsider.actor, { id: room.id, messageId: first })
    ).rejects.toThrow(WorkspaceAccessDenied);
    await expect(
      readMatrixPins(outsider.actor, { id: room.id })
    ).rejects.toThrow(WorkspaceAccessDenied);
    expect(
      await setMatrixPin(fixture.actor, {
        id: room.id,
        messageId: first,
        pinned: false,
        expectedRevision: pinned.pins.revision,
      })
    ).toMatchObject({ status: "saved", pins: { messageIds: [] } });
  }
);
