import { query } from "@db/queries";
import { sql } from "drizzle-orm";
import { sleep } from "../../server/operations/async";
import { randomUUID } from "node:crypto";
import { matrixReceiver } from "./matrix-fixture";

import { afterAll, beforeAll, expect, test } from "vitest";

import { requireWorkspaceAccess } from "../../server/workspaces/access";
import { acceptMatrixTransaction } from "../../server/matrix/inbound";
import {
  createMatrixRoom,
  readMatrixMessages,
  sendMatrixMessage,
  closeMatrixRoom,
  reconcileMatrixRooms,
} from "../../server/matrix/rooms";
import { matrixDeliveryActor } from "../../server/matrix/authority";
import { pendingMatrixEvents } from "../../server/matrix/delivery";

import { workspaceFixture } from "./workspace-fixture";

let receiver: Awaited<ReturnType<typeof matrixReceiver>>;
beforeAll(async () => {
  receiver = await matrixReceiver();
});
afterAll(async () => {
  await receiver.close();
});

test(
  "real Synapse rooms isolate history, durably accept mentions and revoke a removed member",
  { timeout: 60000 },
  async () => {
    await using workspace = await workspaceFixture();
    const { actor, guest, personal } = workspace;
    const operationId = randomUUID();
    const room = await createMatrixRoom(actor, {
      operationId,
      name: "Synthetic team room",
    });
    expect(
      (
        await createMatrixRoom(actor, {
          operationId,
          name: "Synthetic team room",
        })
      ).id
    ).toBe(room.id);
    expect(
      !(
        await Promise.try(async () =>
          readMatrixMessages(personal, room.id)
        ).then(
          (value) => ({ ok: true as const, value }),
          (error: unknown) => ({ ok: false as const, error })
        )
      ).ok
    ).toBe(true);
    await readMatrixMessages(actor, room.id);
    await sendMatrixMessage(actor, {
      id: room.id,
      operationId: randomUUID(),
      text: "Before the guest joined: synthetic private history.",
    });
    const firstGuestView = await readMatrixMessages(guest, room.id);
    expect(
      firstGuestView.messages.some((m) => m.text.includes("Before the guest"))
    ).toBe(false);
    const sendId = randomUUID();
    await sendMatrixMessage(guest, {
      id: room.id,
      operationId: sendId,
      text: "Zoen, summarize our shared workspace.",
    });
    await sendMatrixMessage(guest, {
      id: room.id,
      operationId: sendId,
      text: "Zoen, summarize our shared workspace.",
    });
    const deliveries = await (async function () {
      for (let n = 0; n < 150; n++) {
        const rows = await query<{
          eventId: string;
        }>(
          sql`SELECT event_id AS "eventId" FROM matrix_deliveries WHERE binding_id = ${room.id}`
        );
        if (rows.length) return rows;
        await sleep(100);
      }
      throw new Error("Synapse did not deliver a room mention");
    })();
    expect(deliveries).toHaveLength(1);
    const first = deliveries[0];
    if (!first) throw new Error("Missing Matrix receipt");
    const eventId = first.eventId;
    const source = receiver.receipts.find((r) => r.body.includes(eventId));
    expect(source).toBeDefined();
    if (!source) throw new Error("Missing homeserver transaction");
    await acceptMatrixTransaction(
      new Request("http://localhost/transactions", {
        method: "PUT",
        headers: { authorization: source.authorization },
        body: source.body,
      }),
      source.id
    );
    expect(
      await query(
        sql`SELECT event_id FROM matrix_deliveries WHERE binding_id = ${room.id}`
      )
    ).toHaveLength(1);
    const external = await matrixDeliveryActor(eventId);
    expect(external.userId).toBe(guest.userId);
    expect(external.workspaceId).toBe(actor.workspaceId);
    expect(
      !(
        await Promise.try(async () =>
          requireWorkspaceAccess({
            ...external,
            workspaceId: personal.workspaceId,
          })
        ).then(
          (value) => ({ ok: true as const, value }),
          (error: unknown) => ({ ok: false as const, error })
        )
      ).ok
    ).toBe(true);
    await query(
      sql`DELETE FROM organization_memberships WHERE user_id = ${guest.userId}`
    );
    expect(
      !(
        await Promise.try(async () => matrixDeliveryActor(eventId)).then(
          (value) => ({ ok: true as const, value }),
          (error: unknown) => ({ ok: false as const, error })
        )
      ).ok
    ).toBe(true);
    expect(
      !(
        await Promise.try(async () =>
          sendMatrixMessage(guest, {
            id: room.id,
            operationId: randomUUID(),
            text: "Denied message",
          })
        ).then(
          (value) => ({ ok: true as const, value }),
          (error: unknown) => ({ ok: false as const, error })
        )
      ).ok
    ).toBe(true);
    await reconcileMatrixRooms();
    expect(
      await query(
        sql`SELECT user_id FROM matrix_room_members WHERE binding_id = ${room.id} AND user_id = ${guest.userId}`
      )
    ).toEqual([]);
    await pendingMatrixEvents();
    expect(
      (
        await query<{
          state: string;
        }>(sql`SELECT state FROM matrix_deliveries WHERE event_id = ${eventId}`)
      )[0]?.state
    ).toBe("suppressed");
    await closeMatrixRoom(actor, room.id);
    expect(
      !(
        await Promise.try(async () => readMatrixMessages(actor, room.id)).then(
          (value) => ({ ok: true as const, value }),
          (error: unknown) => ({ ok: false as const, error })
        )
      ).ok
    ).toBe(true);
    await reconcileMatrixRooms();
  }
);
