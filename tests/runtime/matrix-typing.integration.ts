import { readMatrixRoomSync } from "../../server/matrix/sync/room";
import { query } from "@db/queries";
import { sql } from "drizzle-orm";
import { randomUUID } from "node:crypto";
import { beforeAll, afterAll, expect, test, vi } from "vitest";
import { matrixReceiver } from "./matrix-fixture";
import { workspaceFixture } from "./workspace-fixture";
import { createMatrixRoom, joinMatrixRoom } from "../../server/matrix/rooms";
import { matrixRequest, matrixConfiguration } from "../../server/matrix/client";
import { acceptMatrixTransaction } from "../../server/matrix/inbound";
import { z } from "zod";
let receiver: Awaited<ReturnType<typeof matrixReceiver>> | undefined;
beforeAll(async () => {
  receiver = await matrixReceiver();
});
afterAll(async () => {
  await receiver?.close();
});
test(
  "native typing expiry and incremental snapshot",
  { timeout: 60000 },
  async () => {
    await using fixture = await workspaceFixture();
    const room = await createMatrixRoom(fixture.actor, {
      operationId: randomUUID(),
      name: "Synthetic typing",
    });
    const author = await joinMatrixRoom(fixture.actor, room.id);
    const viewer = await joinMatrixRoom(fixture.guest, room.id);
    await matrixRequest(
      "PUT",
      "devices/ZOEN_ROOM_BRIDGE_V1",
      { display_name: "Zoen room bridge" },
      viewer.matrixId
    );
    const filter = encodeURIComponent(
      JSON.stringify({
        presence: { types: [] },
        account_data: { types: [] },
        room: {
          rooms: [room.roomId],
          state: { types: [] },
          account_data: { types: [] },
          timeline: { types: [], limit: 1 },
          ephemeral: { types: ["m.typing"] },
        },
      })
    );
    const schema = z.object({
      next_batch: z.string(),
      rooms: z
        .object({
          join: z
            .record(
              z.string(),
              z.object({
                ephemeral: z
                  .object({
                    events: z.array(
                      z.object({
                        type: z.string(),
                        content: z.object({ user_ids: z.array(z.string()) }),
                      })
                    ),
                  })
                  .optional(),
              })
            )
            .optional(),
        })
        .optional(),
    });
    const poll = async (since?: string) =>
      schema.parse(
        await matrixRequest(
          "GET",
          `sync?device_id=ZOEN_ROOM_BRIDGE_V1&timeout=1000&filter=${filter}${since ? `&since=${encodeURIComponent(since)}` : ""}`,
          undefined,
          viewer.matrixId
        )
      );
    const initial = await poll();
    await matrixRequest(
      "PUT",
      `rooms/${encodeURIComponent(room.roomId)}/typing/${encodeURIComponent(author.matrixId)}`,
      { typing: true, timeout: 2000 },
      author.matrixId
    );
    const active = await poll(initial.next_batch);
    expect(
      active.rooms?.join?.[room.roomId]?.ephemeral?.events.at(-1)?.content
        .user_ids
    ).toContain(author.matrixId);
    await new Promise((resolve) => setTimeout(resolve, 2500));
    let cursor = active.next_batch;
    await vi.waitFor(
      async () => {
        const expired = await poll(cursor);
        cursor = expired.next_batch;
        expect(
          expired.rooms?.join?.[room.roomId]?.ephemeral?.events.at(-1)?.content
            .user_ids
        ).toEqual([]);
      },
      { timeout: 15000, interval: 1000 }
    );
    await matrixRequest(
      "PUT",
      `rooms/${encodeURIComponent(room.roomId)}/typing/${encodeURIComponent(author.matrixId)}`,
      { typing: true, timeout: 20000 },
      author.matrixId
    );
    const renewed = await poll(cursor);
    await matrixRequest(
      "PUT",
      `rooms/${encodeURIComponent(room.roomId)}/typing/${encodeURIComponent(author.matrixId)}`,
      { typing: true, timeout: 20000 },
      author.matrixId
    );
    const started = performance.now();
    const unchanged = await poll(renewed.next_batch);
    console.info("Typing renewal probe", {
      sameToken: unchanged.next_batch === renewed.next_batch,
      elapsedMs: Math.round(performance.now() - started),
      events:
        unchanged.rooms?.join?.[room.roomId]?.ephemeral?.events.length ?? 0,
    });
    await matrixRequest(
      "PUT",
      `rooms/${encodeURIComponent(room.roomId)}/typing/${encodeURIComponent(author.matrixId)}`,
      { typing: false },
      author.matrixId
    );
    const replay = await poll(initial.next_batch);
    // Synapse may cache an older result; client must never extend the lease on replay.
    expect(replay.next_batch).toBeTruthy();
  }
);

test(
  "private scoped typing cursors survive independent sessions and reject cross-user replay",
  { timeout: 120000 },
  async () => {
    const { setMatrixTyping } = await import("../../server/matrix/typing");
    const { WorkspaceAccessDenied } =
      await import("../../server/workspaces/access");
    await using fixture = await workspaceFixture();
    const room = await createMatrixRoom(fixture.actor, {
      operationId: randomUUID(),
      name: "Typing product contract",
    });
    await joinMatrixRoom(fixture.actor, room.id);
    const guestRoom = await joinMatrixRoom(fixture.guest, room.id);
    const secondSession = randomUUID();
    await query(
      sql`INSERT INTO public.session(id,token,"userId","expiresAt","updatedAt") SELECT ${secondSession},${randomUUID()},"userId",now()+interval '1 day',now() FROM public.session WHERE id=${fixture.guest.authSessionId}`
    );
    const secondViewer = { ...fixture.guest, authSessionId: secondSession };
    const seeded = await readMatrixRoomSync(fixture.guest, { id: room.id });
    const secondSeeded = await readMatrixRoomSync(secondViewer, {
      id: room.id,
    });
    expect(seeded).toMatchObject({ status: "ready", userIds: [] });
    expect(seeded.cursor).toBeTruthy();
    // A delayed native join callback acknowledges the already-persisted member;
    // it must not change the audience epoch of an otherwise current cursor.
    const config = await matrixConfiguration();
    await acceptMatrixTransaction(
      new Request("http://localhost/transactions", {
        method: "PUT",
        headers: { authorization: `Bearer ${config.homeserverToken.reveal()}` },
        body: JSON.stringify({
          events: [
            {
              event_id: `$delayed-join-${randomUUID()}`,
              type: "m.room.member",
              room_id: room.roomId,
              sender: guestRoom.matrixId,
              state_key: guestRoom.matrixId,
              origin_server_ts: Date.now(),
              content: { membership: "join" },
            },
          ],
        }),
      }),
      randomUUID()
    );
    await setMatrixTyping(fixture.actor, { id: room.id, typing: true });
    const first = await readMatrixRoomSync(fixture.guest, {
      id: room.id,
      cursor: seeded.cursor ?? undefined,
    });
    expect(first.status).toBe("ready");
    expect(first.userIds).toHaveLength(1);
    const second = await readMatrixRoomSync(secondViewer, {
      id: room.id,
      cursor: secondSeeded.cursor ?? undefined,
    });
    expect(second.userIds).toEqual(first.userIds);
    await expect(
      readMatrixRoomSync(secondViewer, {
        id: room.id,
        cursor: first.cursor ?? undefined,
      })
    ).rejects.toBeInstanceOf(WorkspaceAccessDenied);
    await expect(
      readMatrixRoomSync(fixture.guestPersonal, {
        id: room.id,
        cursor: first.cursor ?? undefined,
      })
    ).rejects.toBeInstanceOf(WorkspaceAccessDenied);
    const replay = await readMatrixRoomSync(fixture.guest, {
      id: room.id,
      cursor: seeded.cursor ?? undefined,
    });
    expect(replay.expiresAt).toBe(first.expiresAt);
    await expect(
      readMatrixRoomSync(fixture.actor, {
        id: room.id,
        cursor: first.cursor ?? undefined,
      })
    ).rejects.toBeInstanceOf(WorkspaceAccessDenied);
    // A second independently authenticated observer enters while typing is already active.
    const entering = await readMatrixRoomSync(fixture.actor, { id: room.id });
    expect(entering.userIds).toEqual([]); // own typing is never displayed
    let retained = first;
    const renew = setInterval(() => {
      void setMatrixTyping(fixture.actor, { id: room.id, typing: true });
    }, 5000);
    try {
      const until = Date.now() + 22000;
      while (Date.now() < until) {
        retained = await readMatrixRoomSync(fixture.guest, {
          id: room.id,
          cursor: retained.cursor ?? undefined,
        });
        expect(retained.userIds).toEqual(first.userIds);
      }
    } finally {
      clearInterval(renew);
    }
    await setMatrixTyping(fixture.actor, { id: room.id, typing: false });
    await vi.waitFor(
      async () => {
        retained = await readMatrixRoomSync(fixture.guest, {
          id: room.id,
          cursor: retained.cursor ?? undefined,
        });
        expect(retained.userIds).toEqual([]);
      },
      { timeout: 15000, interval: 50 }
    );
    const alreadyTypingSeed = await readMatrixRoomSync(fixture.guest, {
      id: room.id,
    });
    await setMatrixTyping(fixture.actor, { id: room.id, typing: true });
    const alreadyTyping = await readMatrixRoomSync(fixture.guest, {
      id: room.id,
    });
    expect(alreadyTyping.userIds).toEqual([]);
    const reconciled = await readMatrixRoomSync(fixture.guest, {
      id: room.id,
      cursor: alreadyTyping.cursor ?? undefined,
    });
    expect(reconciled.userIds).toEqual(first.userIds);
    expect(alreadyTypingSeed.cursor).toBeTruthy();
    await expect(
      readMatrixRoomSync(fixture.guest, { id: room.id, cursor: "corrupted" })
    ).rejects.toBeInstanceOf(WorkspaceAccessDenied);
    await query(
      sql`DELETE FROM workspace_memberships WHERE workspace_id=${fixture.guest.workspaceId} AND user_id=${fixture.guest.userId}`
    );
    expect(
      await readMatrixRoomSync(fixture.guest, {
        id: room.id,
        cursor: first.cursor ?? undefined,
      })
    ).toMatchObject({
      status: "denied",
      cursor: null,
      userIds: [],
      changes: null,
    });
    await expect(
      setMatrixTyping(fixture.guest, { id: room.id, typing: true })
    ).rejects.toBeInstanceOf(WorkspaceAccessDenied);
    await setMatrixTyping(fixture.actor, { id: room.id, typing: false });
  }
);
