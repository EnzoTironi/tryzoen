import { readMatrixMedia } from "../../server/matrix/media/read";
import { searchComposerReferences } from "../../server/workspaces/references";
import {
  readMatrixReactions,
  setMatrixReaction,
} from "../../server/matrix/reactions";
import { query, transaction } from "@db/queries";
import { sql } from "drizzle-orm";
import { sleep } from "../../server/operations/async";
import { randomUUID } from "node:crypto";
import { matrixReceiver } from "./matrix-fixture";

import { afterAll, beforeAll, expect, test } from "vitest";

import {
  requireWorkspaceAccess,
  WorkspaceAccessDenied,
} from "../../server/workspaces/access";
import { acceptMatrixTransaction } from "../../server/matrix/inbound";
import {
  createMatrixRoom,
  readMatrixMessages,
  closeMatrixRoom,
  reconcileMatrixRooms,
} from "../../server/matrix/rooms";
import { sendMatrixMessage } from "../../server/matrix/send";
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
      text: "@Zoen, summarize our shared workspace.",
    });
    await sendMatrixMessage(guest, {
      id: room.id,
      operationId: sendId,
      text: "@Zoen, summarize our shared workspace.",
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
    const parent = await sendMatrixMessage(actor, {
      id: room.id,
      operationId: randomUUID(),
      text: "Synthetic thread: release plan",
    });
    const reactionInput = {
      id: room.id,
      messageId: parent.event_id,
      operationId: randomUUID(),
      emoji: "❤️",
    };
    const reaction = await setMatrixReaction(guest, reactionInput);
    expect(reaction).toMatchObject({
      mine: "❤️",
      reactions: [{ emoji: "❤️", count: 1 }],
    });
    expect(await setMatrixReaction(guest, reactionInput)).toEqual(reaction);
    await setMatrixReaction(actor, {
      ...reactionInput,
      operationId: randomUUID(),
    });
    const changed = await setMatrixReaction(guest, {
      ...reactionInput,
      operationId: randomUUID(),
      previousEventId: reaction.mineEventId ?? undefined,
      emoji: "🎉",
    });
    expect(changed.reactions).toContainEqual({ emoji: "❤️", count: 1 });
    expect(changed.reactions).toContainEqual({ emoji: "🎉", count: 1 });
    const removed = await setMatrixReaction(guest, {
      ...reactionInput,
      operationId: randomUUID(),
      previousEventId: changed.mineEventId ?? undefined,
      emoji: null,
    });
    expect(removed.mine).toBeNull();
    expect(removed.reactions).toEqual([{ emoji: "❤️", count: 1 }]);
    expect(
      (
        await readMatrixReactions(actor, {
          id: room.id,
          messageIds: [parent.event_id],
        })
      )[0]?.mine
    ).toBe("❤️");
    await expect(
      readMatrixReactions(personal, {
        id: room.id,
        messageIds: [parent.event_id],
      })
    ).rejects.toThrow(WorkspaceAccessDenied);
    await expect(setMatrixReaction(personal, reactionInput)).rejects.toThrow(
      WorkspaceAccessDenied
    );
    const quoted = await sendMatrixMessage(guest, {
      id: room.id,
      text: "Quoted reply",
      replyTo: parent.event_id,
      operationId: randomUUID(),
    });
    const quotedView = (await readMatrixMessages(actor, room.id)).messages.find(
      (message) => message.id === quoted.event_id
    );
    expect(quotedView).toMatchObject({
      text: "Quoted reply",
      reply: {
        id: parent.event_id,
        text: "Synthetic thread: release plan",
        sender: "Synthetic owner",
      },
    });
    const nested = await sendMatrixMessage(actor, {
      id: room.id,
      text: "Reply to the quoted response",
      replyTo: quoted.event_id,
      operationId: randomUUID(),
    });
    expect(
      (await readMatrixMessages(actor, room.id)).messages.find(
        (message) => message.id === nested.event_id
      )
    ).toMatchObject({
      text: "Reply to the quoted response",
      reply: { id: quoted.event_id, text: "Quoted reply" },
    });
    const files = [
      {
        type: "file" as const,
        filename: "synthetic-note.txt",
        mediaType: "text/plain",
        url: "data:text/plain;base64,U3ludGhldGljIGZpbGU=",
      },
    ];
    const upload = { id: room.id, operationId: randomUUID(), text: "", files };
    const media = await sendMatrixMessage(actor, upload);
    expect(await sendMatrixMessage(actor, upload)).toEqual(media);
    expect(
      await readMatrixMedia(guest, { id: room.id, messageId: media.event_id })
    ).toEqual(files[0]);
    expect(
      (await readMatrixMessages(guest, room.id)).messages.filter(
        (item) => item.id === media.event_id
      )
    ).toHaveLength(1);
    await expect(
      readMatrixMedia(personal, { id: room.id, messageId: media.event_id })
    ).rejects.toThrow(WorkspaceAccessDenied);
    const privateWrite = await workspace.repository.write(actor, {
      operationId: randomUUID(),
      expectedRevision: null,
      path: "agent/MEMORY.md",
      content: "Private shared-workspace owner memory",
    });
    await workspace.repository.write(actor, {
      operationId: randomUUID(),
      expectedRevision: privateWrite.revision,
      path: "knowledge/visible.md",
      content: "Shared reference",
    });
    const references = await searchComposerReferences(guest, {
      trigger: "@",
      query: ".md",
      roomId: room.id,
    });
    expect(references.map((item) => item.id)).toContain("knowledge/visible.md");
    expect(references.map((item) => item.id)).not.toContain("agent/MEMORY.md");
    await expect(
      searchComposerReferences(personal, {
        trigger: "@",
        query: "",
        roomId: room.id,
      })
    ).rejects.toThrow(WorkspaceAccessDenied);
    const replyId = randomUUID();
    await sendMatrixMessage(guest, {
      id: room.id,
      operationId: replyId,
      text: "Ready for review",
      rootId: parent.event_id,
    });
    await sendMatrixMessage(guest, {
      id: room.id,
      operationId: replyId,
      text: "Ready for review",
      rootId: parent.event_id,
    });
    const thread = await readMatrixMessages(
      actor,
      room.id,
      undefined,
      parent.event_id
    );
    expect(thread.parent?.text).toBe("Synthetic thread: release plan");
    expect(thread.messages).toHaveLength(1);
    expect(thread.messages[0]?.text).toBe("Ready for review");
    expect(thread.messages[0]?.rootId).toBe(parent.event_id);
    await expect(
      readMatrixMessages(personal, room.id, undefined, parent.event_id)
    ).rejects.toThrow(WorkspaceAccessDenied);
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
    await reconcileMatrixRooms(Date.now() + 30_000, 5);
    expect(
      await query(
        sql`SELECT user_id FROM matrix_room_members WHERE binding_id = ${room.id} AND user_id = ${guest.userId}`
      )
    ).toEqual([]);
    await transaction(() => pendingMatrixEvents(25), { outermost: true });
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
    await reconcileMatrixRooms(Date.now() + 30_000, 5);
  }
);
