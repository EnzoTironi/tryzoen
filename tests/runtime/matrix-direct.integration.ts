import { randomUUID } from "node:crypto";
import { afterAll, beforeAll, expect, test } from "vitest";
import { sql } from "drizzle-orm";
import { query } from "@db/queries";
import { saveDirectoryProfile } from "../../server/accounts/directory";
import {
  listDirectRooms,
  openDirectRoom,
  searchDirectPeople,
} from "../../server/matrix/direct";
import { MatrixError, matrixRequest } from "../../server/matrix/client";
import {
  readMatrixMessages,
  sendMatrixMessage,
  closeMatrixRoom,
} from "../../server/matrix/rooms";
import { readMatrixMedia } from "../../server/matrix/media/read";
import {
  readMatrixReactions,
  setMatrixReaction,
} from "../../server/matrix/reactions";
import { WorkspaceAccessDenied } from "../../server/workspaces/access";
import { sleep } from "../../server/operations/async";
import { matrixReceiver } from "./matrix-fixture";
import { workspaceFixture } from "./workspace-fixture";

let receiver: Awaited<ReturnType<typeof matrixReceiver>>;
beforeAll(async () => {
  receiver = await matrixReceiver();
});
afterAll(async () => {
  await receiver.close();
});

test(
  "direct conversations reuse native Matrix messages, attachments, reactions and threads without the shared agent",
  { timeout: 60_000 },
  async () => {
    await using workspace = await workspaceFixture();
    const { actor, guest } = workspace;
    const suffix = randomUUID().replaceAll("-", "").slice(0, 16);
    const ownerName = `owner_${suffix}`;
    const guestName = `guest_${suffix}`;
    await saveDirectoryProfile(actor, {
      username: ownerName,
      discoverable: false,
    });
    await saveDirectoryProfile(guest, {
      username: guestName,
      discoverable: false,
    });
    expect(await searchDirectPeople(actor, `@${guestName}`)).toMatchObject([
      { username: guestName, name: "Synthetic guest" },
    ]);
    expect(await searchDirectPeople(actor, ownerName)).toEqual([]);
    const [room, otherView] = await Promise.all([
      openDirectRoom(actor, { username: guestName, operationId: randomUUID() }),
      openDirectRoom(guest, { username: ownerName, operationId: randomUUID() }),
    ]);
    expect(room.kind).toBe("direct");
    expect(otherView.id).toBe(room.id);
    expect(otherView.label).toBe("Synthetic owner");
    expect((await listDirectRooms(actor)).items).toEqual([room]);
    expect((await listDirectRooms(guest)).items).toEqual([otherView]);
    expect((await listDirectRooms(actor, room.id)).items).toEqual([]);
    const page = await readMatrixMessages(actor, room.id);
    expect(page.members).toHaveLength(2);
    expect(page.members.every((person) => !person.bot)).toBe(true);
    for (const person of page.members) {
      const peer = page.members.find((item) => item.id !== person.id);
      const account = await matrixRequest(
        "GET",
        `user/${encodeURIComponent(person.id)}/account_data/m.direct`,
        undefined,
        person.id
      );
      if (!peer) throw new Error("Missing direct participant");
      expect(account).toEqual({ [peer.id]: [room.roomId] });
    }
    const input = {
      id: room.id,
      operationId: randomUUID(),
      text: "Zoen, this stays between the two people.",
    };
    const message = await sendMatrixMessage(actor, input);
    expect(await sendMatrixMessage(actor, input)).toEqual(message);
    expect(
      (await readMatrixMessages(guest, room.id)).messages.filter(
        (item) => item.id === message.event_id
      )
    ).toHaveLength(1);
    await sendMatrixMessage(guest, {
      id: room.id,
      operationId: randomUUID(),
      text: "Received privately",
      replyTo: message.event_id,
    });
    expect(
      (await readMatrixMessages(actor, room.id)).messages.at(-1)
    ).toMatchObject({
      text: "Received privately",
      reply: { id: message.event_id },
      mine: false,
    });
    await sendMatrixMessage(guest, {
      id: room.id,
      operationId: randomUUID(),
      text: "Thread response",
      rootId: message.event_id,
    });
    expect(
      (await readMatrixMessages(actor, room.id, undefined, message.event_id))
        .messages
    ).toMatchObject([{ text: "Thread response", rootId: message.event_id }]);
    await setMatrixReaction(guest, {
      id: room.id,
      operationId: randomUUID(),
      messageId: message.event_id,
      emoji: "❤️",
    });
    expect(
      (
        await readMatrixReactions(actor, {
          id: room.id,
          messageIds: [message.event_id],
        })
      )[0]?.reactions
    ).toEqual([{ emoji: "❤️", count: 1 }]);
    const file = {
      type: "file" as const,
      filename: "direct-note.txt",
      mediaType: "text/plain",
      url: "data:text/plain;base64,UHJpdmF0ZSBmaWxl",
    };
    const attachment = await sendMatrixMessage(guest, {
      id: room.id,
      operationId: randomUUID(),
      text: "",
      files: [file],
    });
    expect(
      await readMatrixMedia(actor, {
        id: room.id,
        messageId: attachment.event_id,
      })
    ).toEqual(file);
    for (
      let index = 0;
      index < 150 &&
      !receiver.receipts.some((receipt) =>
        receipt.body.includes(message.event_id)
      );
      index++
    )
      await sleep(100);
    expect(
      receiver.receipts.some((receipt) =>
        receipt.body.includes(message.event_id)
      )
    ).toBe(true);
    expect(
      await query(
        sql`SELECT event_id FROM matrix_deliveries WHERE event_id = ${message.event_id}`
      )
    ).toEqual([]);
    expect(
      await query(
        sql`SELECT id FROM workspace_group_bindings WHERE conversation_id = ${room.roomId}`
      )
    ).toEqual([]);
  }
);

test(
  "a third workspace administrator cannot access a direct conversation; removing either participant revokes it",
  { timeout: 60_000 },
  async () => {
    await using outside = await workspaceFixture();
    await using workspace = await workspaceFixture();
    const { actor, guest } = workspace;
    const suffix = randomUUID().replaceAll("-", "").slice(0, 16);
    const username = `guest_${suffix}`;
    await saveDirectoryProfile(guest, { username, discoverable: true });
    await saveDirectoryProfile(outside.actor, {
      username: `other_${suffix}`,
      discoverable: true,
    });
    expect(await searchDirectPeople(actor, `other_${suffix}`)).toEqual([]);
    await expect(
      openDirectRoom(actor, {
        username: `other_${suffix}`,
        operationId: randomUUID(),
      })
    ).rejects.toThrow(WorkspaceAccessDenied);
    await expect(
      openDirectRoom(guest, { username, operationId: randomUUID() })
    ).rejects.toThrow(WorkspaceAccessDenied);
    const room = await openDirectRoom(actor, {
      username,
      operationId: randomUUID(),
    });
    const third = { ...outside.actor, workspaceId: actor.workspaceId };
    await query(
      sql`INSERT INTO organization_memberships(organization_id, user_id, role) SELECT organization_id, ${third.userId}, 'admin' FROM workspaces WHERE id = ${actor.workspaceId}`
    );
    await query(
      sql`INSERT INTO workspace_memberships(workspace_id, user_id, role) VALUES (${actor.workspaceId}, ${third.userId}, 'admin')`
    );
    expect((await listDirectRooms(third)).items).toEqual([]);
    const file = {
      type: "file" as const,
      filename: "private.txt",
      mediaType: "text/plain",
      url: "data:text/plain;base64,UHJpdmF0ZQ==",
    };
    const message = await sendMatrixMessage(actor, {
      id: room.id,
      operationId: randomUUID(),
      text: "",
      files: [file],
    });
    await expect(readMatrixMessages(third, room.id)).rejects.toThrow(
      WorkspaceAccessDenied
    );
    await expect(
      readMatrixMedia(third, { id: room.id, messageId: message.event_id })
    ).rejects.toThrow(WorkspaceAccessDenied);
    await expect(
      sendMatrixMessage(third, {
        id: room.id,
        operationId: randomUUID(),
        text: "Intrusion",
      })
    ).rejects.toThrow(WorkspaceAccessDenied);
    await expect(
      setMatrixReaction(third, {
        id: room.id,
        messageId: message.event_id,
        operationId: randomUUID(),
        emoji: "❤️",
      })
    ).rejects.toThrow(WorkspaceAccessDenied);
    await expect(
      readMatrixReactions(third, {
        id: room.id,
        messageIds: [message.event_id],
      })
    ).rejects.toThrow(WorkspaceAccessDenied);
    await expect(closeMatrixRoom(third, room.id)).rejects.toThrow(
      WorkspaceAccessDenied
    );
    await expect(
      openDirectRoom(third, { username, operationId: room.id })
    ).rejects.toThrow(WorkspaceAccessDenied);
    const secondRoom = await openDirectRoom(third, {
      username,
      operationId: randomUUID(),
    });
    await expect(
      sendMatrixMessage(third, {
        id: secondRoom.id,
        rootId: message.event_id,
        operationId: randomUUID(),
        text: "Cross-room thread",
      })
    ).rejects.toThrow(MatrixError);
    await query(
      sql`DELETE FROM organization_memberships WHERE user_id = ${guest.userId}`
    );
    expect((await listDirectRooms(actor)).items).toEqual([]);
    await expect(readMatrixMessages(actor, room.id)).rejects.toThrow(
      WorkspaceAccessDenied
    );
    await expect(readMatrixMessages(guest, room.id)).rejects.toThrow(
      WorkspaceAccessDenied
    );
    await query(
      sql`DELETE FROM workspace_memberships WHERE workspace_id = ${actor.workspaceId} AND user_id = ${guest.userId}`
    );
    expect(
      await query(
        sql`SELECT id FROM matrix_direct_rooms WHERE id IN (${room.id}, ${secondRoom.id})`
      )
    ).toEqual([]);
  }
);
