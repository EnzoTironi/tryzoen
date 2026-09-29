import { randomUUID } from "node:crypto";
import { expect, test } from "vitest";
import { sql } from "drizzle-orm";
import { query } from "@db/queries";
import { workspaceFixture } from "./workspace-fixture";
import { createMatrixRoom, joinMatrixRoom } from "../../server/matrix/rooms";
import {
  readPresencePreference,
  updateMatrixPresence,
} from "../../server/matrix/presence";
import { readMatrixRoomSync } from "../../server/matrix/sync/room";
import { WorkspaceAccessDenied } from "../../server/workspaces/access";

test(
  "presence uses native opt-in and sync with account and membership isolation",
  { timeout: 60000 },
  async () => {
    await using fixture = await workspaceFixture();
    await using outsider = await workspaceFixture();
    const room = await createMatrixRoom(fixture.actor, {
      operationId: randomUUID(),
      name: "Synthetic presence",
    });
    const owner = await joinMatrixRoom(fixture.actor, room.id);
    await joinMatrixRoom(fixture.guest, room.id);
    expect(await readPresencePreference(fixture.actor, room.id)).toEqual({
      sharing: false,
    });
    await expect(
      readPresencePreference(outsider.actor, room.id)
    ).rejects.toThrow(WorkspaceAccessDenied);
    await expect(
      updateMatrixPresence(
        { ...fixture.actor, authSessionId: undefined },
        room.id,
        true
      )
    ).rejects.toThrow(WorkspaceAccessDenied);
    await updateMatrixPresence(fixture.actor, room.id, true);
    expect(await readPresencePreference(fixture.guest, room.id)).toEqual({
      sharing: false,
    });
    const first = await readMatrixRoomSync(fixture.guest, { id: room.id });
    expect(first.status).toBe("ready");
    expect(first.presence).toContainEqual({
      id: owner.matrixId,
      state: "online",
    });
    expect(await readPresencePreference(fixture.actor, room.id)).toEqual({
      sharing: true,
    });
    await updateMatrixPresence(fixture.actor, room.id, false);
    // An active stale client must not publish again after opting out.
    await updateMatrixPresence(fixture.actor, room.id);
    const second = await readMatrixRoomSync(fixture.guest, {
      id: room.id,
      cursor: first.cursor ?? undefined,
    });
    expect(second.status).toBe("ready");
    expect(second.presence).toContainEqual({
      id: owner.matrixId,
      state: "offline",
    });
    await query(
      sql`UPDATE matrix_room_members SET state = 'removed' WHERE binding_id = ${room.id} AND user_id = ${fixture.guest.userId}`
    );
    await expect(
      updateMatrixPresence(fixture.guest, room.id, true)
    ).rejects.toThrow(WorkspaceAccessDenied);
    expect(
      await readMatrixRoomSync(fixture.guest, {
        id: room.id,
        cursor: second.cursor ?? undefined,
      })
    ).toMatchObject({ status: "denied", presence: [] });
  }
);
