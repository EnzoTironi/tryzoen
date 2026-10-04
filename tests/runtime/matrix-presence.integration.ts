import { randomUUID } from "node:crypto";
import { expect, test, vi } from "vitest";
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
import { MatrixError } from "../../server/matrix/client";
import { openRoomSyncCursor } from "../../server/matrix/sync/room-cursor";
import { sendMatrixMessage } from "../../server/matrix/send";

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

test(
  "a throttled presence heartbeat retains real native messages, privacy changes and current authority",
  { timeout: 60000 },
  async () => {
    await using fixture = await workspaceFixture();
    const room = await createMatrixRoom(fixture.actor, {
      operationId: randomUUID(),
      name: "Synthetic throttled presence",
    });
    const owner = await joinMatrixRoom(fixture.actor, room.id);
    await joinMatrixRoom(fixture.guest, room.id);
    await updateMatrixPresence(fixture.actor, room.id, true);

    // Inject the observed provider 429 only at this fixture's presence endpoint.
    // Database authority, account data and timeline sync use their real providers.
    const fetch = globalThis.fetch;
    let presenceAttempts = 0;
    vi.spyOn(globalThis, "fetch").mockImplementation(async (input, init) => {
      const url = new URL(input instanceof Request ? input.url : String(input));
      if (
        init?.method === "PUT" &&
        decodeURIComponent(url.pathname) ===
          `/_matrix/client/v3/presence/${owner.matrixId}/status`
      ) {
        presenceAttempts += 1;
        return Response.json(
          { errcode: "M_LIMIT_EXCEEDED", retry_after_ms: 120000 },
          { status: 429 }
        );
      }
      return fetch(input, init);
    });
    const first = await readMatrixRoomSync(fixture.actor, { id: room.id });
    expect(first.status).toBe("ready");
    const cursor = await openRoomSyncCursor(
      fixture.actor,
      first.cursor ?? undefined
    );
    expect(cursor?.presencePublishedAt).toBe(0);
    expect(cursor?.presenceRetryAt).toBeGreaterThan(Date.now() + 110000);
    expect(presenceAttempts).toBe(1);

    const sent = await sendMatrixMessage(fixture.guest, {
      id: room.id,
      operationId: randomUUID(),
      text: "Synthetic message received during presence cooldown",
    });
    const second = await readMatrixRoomSync(fixture.actor, {
      id: room.id,
      cursor: first.cursor ?? undefined,
    });
    expect(second.status).toBe("ready");
    expect(second.changes?.added).toContainEqual(
      expect.objectContaining({
        id: sent.event_id,
        text: "Synthetic message received during presence cooldown",
      })
    );
    expect(presenceAttempts).toBe(1);

    // An explicit privacy change still reports failure and retains its opt-out.
    await expect(
      updateMatrixPresence(fixture.actor, room.id, false)
    ).rejects.toBeInstanceOf(MatrixError);
    expect(await readPresencePreference(fixture.actor, room.id)).toEqual({
      sharing: false,
    });
    expect(presenceAttempts).toBe(2);
    await expect(
      readMatrixRoomSync(fixture.guest, {
        id: room.id,
        cursor: second.cursor ?? undefined,
      })
    ).rejects.toThrow(WorkspaceAccessDenied);
    await query(
      sql`UPDATE matrix_room_members SET state = 'removed' WHERE binding_id = ${room.id} AND user_id = ${fixture.actor.userId}`
    );
    expect(
      await readMatrixRoomSync(fixture.actor, {
        id: room.id,
        cursor: second.cursor ?? undefined,
      })
    ).toMatchObject({ status: "denied", changes: null, presence: [] });
    expect(presenceAttempts).toBe(2);
  }
);
