import { randomUUID } from "node:crypto";
import { beforeAll, afterAll, expect, test, vi } from "vitest";
import { query } from "@db/queries";
import { sql } from "drizzle-orm";
import { z } from "zod";
import { matrixReceiver } from "./matrix-fixture";
import { workspaceFixture } from "./workspace-fixture";
import {
  createMatrixRoom,
  sendMatrixMessage,
  readMatrixMessages,
} from "../../server/matrix/rooms";
import { ensureMatrixIdentity } from "../../server/matrix/identities";
import { matrixRequest, matrixConfiguration } from "../../server/matrix/client";
import {
  authorizedInboxRooms,
  readMatrixInboxSummaries,
} from "../../server/matrix/inbox";
import { markMatrixRoomRead } from "../../server/matrix/read-position";
import { reconcileMatrixActivity } from "../../server/matrix/activity-reconcile";
import { projectMatrixActivity } from "../../server/matrix/activity";
import { deleteMatrixMessage } from "../../server/matrix/message-actions";
import { acceptMatrixTransaction } from "../../server/matrix/inbound";
import { openDirectRoom } from "../../server/matrix/direct";
import { saveDirectoryProfile } from "../../server/accounts/directory";
import { WorkspaceAccessDenied } from "../../server/workspaces/access";

let receiver: Awaited<ReturnType<typeof matrixReceiver>> | undefined;
beforeAll(async () => {
  receiver = await matrixReceiver();
});
afterAll(async () => {
  await receiver?.close();
});

test(
  "activity replay, reconciliation and viewer-filtered summaries keep Matrix authoritative",
  { timeout: 60000 },
  async () => {
    await using fixture = await workspaceFixture();
    const room = await createMatrixRoom(fixture.actor, {
      operationId: randomUUID(),
      name: "Synthetic inbox activity",
    });
    const beforeJoin = await readMatrixInboxSummaries(fixture.guest, [room.id]);
    expect(beforeJoin.get(room.id)).toMatchObject({
      preview: null,
      unread: null,
      summaryState: "pending",
    });
    await readMatrixMessages(fixture.guest, room.id);
    const message = await sendMatrixMessage(fixture.actor, {
      id: room.id,
      text: "Non-agent message",
      operationId: randomUUID(),
    });
    await vi.waitFor(
      async () => {
        const rows = await query(
          sql`SELECT latest_event_id FROM matrix_room_activity WHERE room_id = ${room.roomId}`
        );
        expect(rows).toEqual([{ latest_event_id: message.event_id }]);
      },
      { timeout: 10000 }
    );
    const config = await matrixConfiguration();
    await projectMatrixActivity(config.serverName, {
      type: "m.room.message",
      room_id: room.roomId,
      event_id: "$older",
      sender: "@synthetic:test",
      origin_server_ts: 1,
      content: { body: "Must not rewind" },
    });
    expect(
      await query(
        sql`SELECT latest_event_id FROM matrix_room_activity WHERE room_id = ${room.roomId}`
      )
    ).toEqual([{ latest_event_id: message.event_id }]);
    await vi.waitFor(
      () => {
        expect(
          receiver?.receipts.some((item) =>
            item.body.includes(message.event_id)
          )
        ).toBe(true);
      },
      { timeout: 10000 }
    );
    const receipt = receiver?.receipts.find((item) =>
      item.body.includes(message.event_id)
    );
    if (!receipt) throw new Error("Expected received event");
    await query(
      sql`DELETE FROM matrix_room_activity WHERE room_id = ${room.roomId}`
    );
    await acceptMatrixTransaction(
      new Request("http://localhost/transactions", {
        method: "PUT",
        headers: { authorization: receipt.authorization },
        body: receipt.body,
      }),
      receipt.id
    );
    expect(
      await query(
        sql`SELECT latest_event_id FROM matrix_room_activity WHERE room_id = ${room.roomId}`
      )
    ).toEqual([{ latest_event_id: message.event_id }]);
    await vi.waitFor(
      async () => {
        await reconcileMatrixActivity();
        expect(
          await query(
            sql`SELECT reconciled_at IS NOT NULL AS ready FROM matrix_room_activity WHERE room_id = ${room.roomId}`
          )
        ).toEqual([{ ready: true }]);
      },
      { timeout: 10000 }
    );
    expect(
      (await readMatrixInboxSummaries(fixture.guest, [room.id])).get(room.id)
    ).toEqual({
      preview: "Non-agent message",
      unread: null,
      summaryState: "ready",
    });
    const sender = await ensureMatrixIdentity(fixture.actor);
    await matrixRequest(
      "PUT",
      `rooms/${encodeURIComponent(room.roomId)}/send/m.room.message/${randomUUID()}`,
      {
        msgtype: "m.text",
        body: "* Changed",
        "m.new_content": { msgtype: "m.text", body: "Changed" },
        "m.relates_to": { rel_type: "m.replace", event_id: message.event_id },
      },
      sender
    );
    await vi.waitFor(
      async () => {
        expect(
          (await readMatrixInboxSummaries(fixture.guest, [room.id])).get(
            room.id
          )?.preview
        ).toBe("Changed");
      },
      { timeout: 10000 }
    );
    await query(
      sql`UPDATE matrix_room_activity SET latest_edited=false,reconciled_at=NULL WHERE room_id=${room.roomId}`
    );
    await reconcileMatrixActivity();
    expect(
      (await readMatrixInboxSummaries(fixture.guest, [room.id])).get(room.id)
        ?.preview
    ).toBe("Changed");
    expect(
      await query(
        sql`SELECT latest_event_id, latest_edited FROM matrix_room_activity WHERE room_id = ${room.roomId}`
      )
    ).toEqual([{ latest_event_id: message.event_id, latest_edited: true }]);
    await deleteMatrixMessage(fixture.actor, {
      id: room.id,
      messageId: message.event_id,
      operationId: randomUUID(),
    });
    expect(
      (await readMatrixInboxSummaries(fixture.guest, [room.id])).get(room.id)
        ?.preview
    ).toBe("Mensagem removida");
    const next = await sendMatrixMessage(fixture.actor, {
      id: room.id,
      text: "New latest",
      operationId: randomUUID(),
    });
    await vi.waitFor(
      async () => {
        expect(
          await query(
            sql`SELECT latest_event_id, latest_edited FROM matrix_room_activity WHERE room_id=${room.roomId}`
          )
        ).toEqual([{ latest_event_id: next.event_id, latest_edited: false }]);
      },
      { timeout: 10000 }
    );
  }
);

test(
  "private read position does not rewind and thread receipts stay in their thread",
  { timeout: 60000 },
  async () => {
    await using fixture = await workspaceFixture();
    const room = await createMatrixRoom(fixture.actor, {
      operationId: randomUUID(),
      name: "Synthetic private reads",
    });
    await readMatrixMessages(fixture.guest, room.id);
    const first = await sendMatrixMessage(fixture.actor, {
      id: room.id,
      text: "First",
      operationId: randomUUID(),
    });
    const second = await sendMatrixMessage(fixture.actor, {
      id: room.id,
      text: "Second",
      operationId: randomUUID(),
    });
    await markMatrixRoomRead(fixture.guest, {
      id: room.id,
      messageId: second.event_id,
    });
    await markMatrixRoomRead(fixture.guest, {
      id: room.id,
      messageId: first.event_id,
    });
    const viewer = await ensureMatrixIdentity(fixture.guest);
    const marker = await matrixRequest(
      "GET",
      `user/${encodeURIComponent(viewer)}/rooms/${encodeURIComponent(room.roomId)}/account_data/m.fully_read`,
      undefined,
      viewer
    );
    expect(marker).toEqual({ event_id: second.event_id });
    const child = await sendMatrixMessage(fixture.actor, {
      id: room.id,
      rootId: first.event_id,
      text: "Thread",
      operationId: randomUUID(),
    });
    await markMatrixRoomRead(fixture.guest, {
      id: room.id,
      rootId: first.event_id,
      messageId: child.event_id,
    });
    await markMatrixRoomRead(fixture.guest, {
      id: room.id,
      rootId: first.event_id,
      messageId: first.event_id,
    });
    await expect(
      markMatrixRoomRead(fixture.guest, {
        id: room.id,
        messageId: child.event_id,
      })
    ).rejects.toThrow(WorkspaceAccessDenied);
    expect(
      await matrixRequest(
        "GET",
        `user/${encodeURIComponent(viewer)}/rooms/${encodeURIComponent(room.roomId)}/account_data/m.fully_read`,
        undefined,
        viewer
      )
    ).toEqual({ event_id: second.event_id });
  }
);

test(
  "direct metadata and summaries exclude third administrators and revoked pairs",
  { timeout: 60000 },
  async () => {
    await using fixture = await workspaceFixture();
    await using other = await workspaceFixture();
    const username = `inbox_${randomUUID().replaceAll("-", "").slice(0, 16)}`;
    await saveDirectoryProfile(fixture.guest, {
      username,
      discoverable: false,
    });
    const room = await openDirectRoom(fixture.actor, {
      username,
      operationId: randomUUID(),
    });
    const third = { ...other.actor, workspaceId: fixture.actor.workspaceId };
    await query(
      sql`INSERT INTO organization_memberships(organization_id,user_id,role) SELECT organization_id,${third.userId},'admin' FROM workspaces WHERE id=${third.workspaceId}`
    );
    await query(
      sql`INSERT INTO workspace_memberships(workspace_id,user_id,role) VALUES (${third.workspaceId},${third.userId},'admin')`
    );
    const direct = await sendMatrixMessage(fixture.actor, {
      id: room.id,
      text: "Private direct",
      operationId: randomUUID(),
    });
    await vi.waitFor(
      async () => {
        expect(
          await query(
            sql`SELECT latest_event_id FROM matrix_room_activity WHERE room_id=${room.roomId}`
          )
        ).toEqual([{ latest_event_id: direct.event_id }]);
      },
      { timeout: 10000 }
    );
    expect(
      z
        .array(z.object({ id: z.string() }))
        .parse(await query(await authorizedInboxRooms(third)))
    ).toEqual([]);
    await expect(readMatrixInboxSummaries(third, [room.id])).rejects.toThrow(
      WorkspaceAccessDenied
    );
    await expect(
      markMatrixRoomRead(third, { id: room.id, messageId: direct.event_id })
    ).rejects.toThrow(WorkspaceAccessDenied);
    await query(
      sql`DELETE FROM organization_memberships WHERE user_id=${fixture.guest.userId} AND organization_id IN (SELECT organization_id FROM workspaces WHERE id=${fixture.guest.workspaceId})`
    );
    await expect(
      readMatrixInboxSummaries(fixture.actor, [room.id])
    ).rejects.toThrow(WorkspaceAccessDenied);
    await expect(
      markMatrixRoomRead(fixture.actor, {
        id: room.id,
        messageId: direct.event_id,
      })
    ).rejects.toThrow(WorkspaceAccessDenied);
  }
);

test(
  "successful sends update activity without an appservice callback and retries stay idempotent",
  { timeout: 60000 },
  async () => {
    await receiver?.close();
    receiver = undefined;
    await using fixture = await workspaceFixture();
    const room = await createMatrixRoom(fixture.actor, {
      operationId: randomUUID(),
      name: "Synthetic send projection",
    });
    const input = {
      id: room.id,
      operationId: randomUUID(),
      text: "Immediate activity",
    };
    const sent = await sendMatrixMessage(fixture.actor, input);
    const readIndex = () =>
      query(
        sql`SELECT latest_event_id, latest_at FROM matrix_room_activity WHERE room_id=${room.roomId}`
      );
    const first = await readIndex();
    expect(first).toHaveLength(1);
    expect(first[0]?.latest_event_id).toBe(sent.event_id);
    expect(first[0]?.latest_at).toEqual(expect.any(String));
    expect(await sendMatrixMessage(fixture.actor, input)).toEqual(sent);
    expect(await readIndex()).toEqual(first);
  }
);
