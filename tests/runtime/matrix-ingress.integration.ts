import { randomUUID } from "node:crypto";
import { sql } from "drizzle-orm";
import { z } from "zod";
import { expect, test } from "vitest";
import { query } from "@db/queries";
import { env } from "@shared/environment/env";
import { acceptMatrixTransaction } from "../../server/matrix/inbound";
import { workspaceFixture } from "./workspace-fixture";

function request(events: unknown[]) {
  return new Request("http://localhost/transactions", {
    method: "PUT",
    headers: {
      authorization: `Bearer ${z.string().parse(env.ZOEN_MATRIX_HS_TOKEN?.reveal())}`,
    },
    body: JSON.stringify({ events }),
  });
}

test("Matrix retries ignore refreshed unsigned age but reject changed semantic events", async () => {
  const id = randomUUID();
  const event = {
    event_id: randomUUID(),
    type: "m.room.message",
    sender: "@synthetic:zoen-eve.test",
    content: { msgtype: "m.text", body: "Same delivery" },
  };
  try {
    await acceptMatrixTransaction(
      request([{ ...event, unsigned: { age: 10 } }]),
      id
    );
    await expect(
      acceptMatrixTransaction(
        request([
          {
            unsigned: { age: 5000 },
            content: event.content,
            sender: event.sender,
            type: event.type,
            event_id: event.event_id,
          },
        ]),
        id
      )
    ).resolves.toEqual([]);
    expect(
      await query(
        sql`SELECT id FROM matrix_received_events WHERE id=${event.event_id}`
      )
    ).toHaveLength(1);
    await expect(
      acceptMatrixTransaction(
        request([
          { ...event, content: { ...event.content, body: "Changed content" } },
        ]),
        id
      )
    ).rejects.toMatchObject({ reason: "conflict" });
  } finally {
    await query(sql`DELETE FROM matrix_transactions WHERE id=${id}`);
    await query(
      sql`DELETE FROM matrix_received_events WHERE id=${event.event_id}`
    );
  }
});

test("late Matrix invitations do not remove an already joined member or invalidate approvals", async () => {
  await using workspace = await workspaceFixture();
  const { actor, guest } = workspace;
  const binding = randomUUID();
  const room = `!${randomUUID()}:zoen-eve.test`;
  const epoch = randomUUID();
  const member = `@_zoen_${randomUUID()}:zoen-eve.test`;
  await query(
    sql`INSERT INTO matrix_identities(user_id,matrix_id) VALUES(${guest.userId},${member})`
  );
  await query(sql`INSERT INTO workspace_group_bindings(id,workspace_id,channel,installation_id,conversation_id,label,created_by,epoch)
    VALUES(${binding},${actor.workspaceId},'matrix','zoen-eve.test',${room},'Synthetic membership',${actor.userId},${epoch})`);
  await query(
    sql`INSERT INTO matrix_room_members(binding_id,user_id) VALUES(${binding},${guest.userId})`
  );
  const transactions: string[] = [];
  const events: string[] = [];
  const receive = async (membership: string) => {
    const id = randomUUID();
    const eventId = randomUUID();
    transactions.push(id);
    events.push(eventId);
    await acceptMatrixTransaction(
      request([
        {
          event_id: eventId,
          room_id: room,
          type: "m.room.member",
          sender: "@_zoen_bot:zoen-eve.test",
          state_key: member,
          content: { membership },
        },
      ]),
      id
    );
  };
  try {
    await receive("invite");
    expect(
      (
        await query<{ epoch: string }>(
          sql`SELECT epoch FROM workspace_group_bindings WHERE id=${binding}`
        )
      )[0]?.epoch
    ).toBe(epoch);
    expect(
      await query(
        sql`SELECT user_id FROM matrix_room_members WHERE binding_id=${binding}`
      )
    ).toHaveLength(1);
    await receive("join");
    expect(
      (
        await query<{ epoch: string }>(
          sql`SELECT epoch FROM workspace_group_bindings WHERE id=${binding}`
        )
      )[0]?.epoch
    ).not.toBe(epoch);
    await receive("leave");
    expect(
      await query(
        sql`SELECT user_id FROM matrix_room_members WHERE binding_id=${binding}`
      )
    ).toHaveLength(0);
  } finally {
    for (const id of transactions)
      await query(sql`DELETE FROM matrix_transactions WHERE id=${id}`);
    for (const id of events)
      await query(sql`DELETE FROM matrix_received_events WHERE id=${id}`);
  }
});
