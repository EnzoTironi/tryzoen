import { query } from "@db/queries";
import { sql } from "drizzle-orm";
import { z } from "zod";
import { matrixRequest } from "../../server/matrix/client";
import { ensureMatrixIdentity } from "../../server/matrix/identities";
import { randomUUID } from "node:crypto";
import { expect, test } from "vitest";
import { workspaceFixture } from "./workspace-fixture";
import { matrixReceiver } from "./matrix-fixture";
import {
  createMatrixRoom,
  readMatrixMessages,
  closeMatrixRoom,
} from "../../server/matrix/rooms";
import { sendMatrixMessage } from "../../server/matrix/send";
import {
  readSavedCleanupState,
  clearUnavailableSavedMessages,
  listSavedMatrixMessages,
  setSavedMatrixMessage,
  readSavedMessageState,
} from "../../server/matrix/saved";
import { readMatrixContext } from "../../server/matrix/context";
import { editMatrixMessage } from "../../server/matrix/edits";
import { deleteMatrixMessage } from "../../server/matrix/message-actions";

test(
  "private native saved references survive edits, locate old thread sources and lose revoked content",
  { timeout: 60000 },
  async () => {
    const receiver = await matrixReceiver();
    try {
      await using fixture = await workspaceFixture();
      const { actor, guest } = fixture;
      const room = await createMatrixRoom(actor, {
        operationId: randomUUID(),
        name: "Synthetic saved messages",
      });
      await readMatrixMessages(guest, room.id);
      const first = await sendMatrixMessage(actor, {
        id: room.id,
        operationId: randomUUID(),
        text: "Old original",
      });
      const ref = { id: room.id, messageId: first.event_id };
      const empty = await listSavedMatrixMessages(actor, {});
      expect(empty.items).toHaveLength(0);
      const saved = await setSavedMatrixMessage(actor, {
        ...ref,
        saved: true,
        expectedRevision: empty.revision,
      });
      expect(saved.status).toBe("saved");
      expect(
        await setSavedMatrixMessage(actor, {
          ...ref,
          saved: true,
          expectedRevision: empty.revision,
        })
      ).toEqual(saved);
      expect((await listSavedMatrixMessages(guest, {})).items).toHaveLength(0);
      const reply = await sendMatrixMessage(actor, {
        id: room.id,
        rootId: first.event_id,
        operationId: randomUUID(),
        text: "Saved thread reply",
      });
      expect(
        (
          await setSavedMatrixMessage(actor, {
            id: room.id,
            messageId: reply.event_id,
            saved: true,
            expectedRevision: empty.revision,
          })
        ).status
      ).toBe("conflict");
      await setSavedMatrixMessage(actor, {
        id: room.id,
        messageId: reply.event_id,
        saved: true,
        expectedRevision: saved.revision,
      });
      await editMatrixMessage(actor, {
        ...ref,
        operationId: randomUUID(),
        expectedRevision: first.event_id,
        text: "Edited source",
      });
      const list = await listSavedMatrixMessages(actor, {});
      expect(list.items.map((item) => item.message?.text)).toEqual([
        "Saved thread reply",
        "Edited source",
      ]);
      const context = await readMatrixContext(actor, {
        id: room.id,
        messageId: reply.event_id,
      });
      expect(context.target.id).toBe(reply.event_id);
      expect(
        context.members.find((member) => member.id === context.target.senderId)
      ).toMatchObject({ mine: true, bot: false });
      expect(context.root?.id).toBe(first.event_id);
      expect(context.root?.text).toBe("Edited source");
      expect(context.messages.map((item) => item.timestamp)).toEqual(
        context.messages.map((item) => item.timestamp).toSorted((a, b) => a - b)
      );
      await deleteMatrixMessage(actor, { ...ref, operationId: randomUUID() });
      expect(
        (await listSavedMatrixMessages(actor, {})).items.find(
          (item) => item.reference.messageId === first.event_id
        )?.message
      ).toMatchObject({ redacted: true, text: "Mensagem removida" });
      expect(
        (
          await readMatrixContext(actor, {
            id: room.id,
            messageId: reply.event_id,
          })
        ).root
      ).toMatchObject({
        id: first.event_id,
        redacted: true,
        text: "Mensagem removida",
      });
      await closeMatrixRoom(actor, room.id);
      const revoked = await listSavedMatrixMessages(actor, {});
      expect(revoked.items).toHaveLength(2);
      expect(
        revoked.items.every(
          (item) => item.room === null && item.message === null
        )
      ).toBe(true);
      const state = await readSavedMessageState(actor, ref);
      expect(
        (
          await setSavedMatrixMessage(actor, {
            ...ref,
            saved: false,
            expectedRevision: state.revision,
          })
        ).status
      ).toBe("saved");
      expect((await listSavedMatrixMessages(actor, {})).items).toHaveLength(1);
      await query(
        sql`DELETE FROM workspace_memberships WHERE workspace_id=${actor.workspaceId} AND user_id=${actor.userId}`
      );
      const cleanup = await readSavedCleanupState(fixture.personal);
      expect(cleanup.count).toBe(1);
      expect(Object.keys(cleanup).toSorted()).toEqual(["count", "revision"]);
      expect(
        (
          await clearUnavailableSavedMessages(fixture.personal, {
            revision: cleanup.revision,
          })
        ).status
      ).toBe("saved");
      expect((await readSavedCleanupState(fixture.personal)).count).toBe(0);
    } finally {
      await receiver.close();
    }
  }
);

test(
  "bounded native collection paginates before hydration, rejects stale cursors and enforces capacity",
  { timeout: 60000 },
  async () => {
    const receiver = await matrixReceiver();
    try {
      await using fixture = await workspaceFixture();
      const { actor } = fixture;
      const room = await createMatrixRoom(actor, {
        operationId: randomUUID(),
        name: "Synthetic saved pagination",
      });
      const first = await sendMatrixMessage(actor, {
        id: room.id,
        operationId: randomUUID(),
        text: "Old target beyond the first history page",
      });
      const viewer = await ensureMatrixIdentity(actor);
      for (let i = 0; i < 105; i++)
        await matrixRequest(
          "PUT",
          `rooms/${encodeURIComponent(room.roomId)}/send/m.room.message/${randomUUID()}`,
          { msgtype: "m.text", body: `Newer ${i}` },
          viewer
        );
      expect(
        (await readMatrixMessages(actor, room.id)).messages.some(
          (message) => message.id === first.event_id
        )
      ).toBe(false);
      expect(
        (
          await readMatrixContext(actor, {
            id: room.id,
            messageId: first.event_id,
          })
        ).target.text
      ).toBe("Old target beyond the first history page");
      const refs = Array.from({ length: 100 }, (_, index) => ({
        key: randomUUID(),
        workspaceId: actor.workspaceId,
        id: room.id,
        roomId: room.roomId,
        eventId: index === 0 ? first.event_id : `$missing_${index}`,
        savedAt: 100 - index,
      }));
      const nativePath = `user/${encodeURIComponent(viewer)}/account_data/org.zoen.saved_messages`;
      await matrixRequest(
        "PUT",
        nativePath,
        { version: 1, items: refs },
        viewer
      );
      const page = await listSavedMatrixMessages(actor, {});
      expect(page.items).toHaveLength(20);
      expect(page.nextCursor).not.toBeNull();
      const next = await listSavedMatrixMessages(actor, {
        cursor: page.nextCursor,
      });
      expect(next.items).toHaveLength(20);
      expect(
        new Set([...page.items, ...next.items].map((item) => item.key)).size
      ).toBe(40);
      const another = await sendMatrixMessage(actor, {
        id: room.id,
        operationId: randomUUID(),
        text: "Capacity",
      });
      await expect(
        setSavedMatrixMessage(actor, {
          id: room.id,
          messageId: another.event_id,
          saved: true,
          expectedRevision: page.revision,
        })
      ).rejects.toThrow("100 mensagens");
      await setSavedMatrixMessage(actor, {
        id: room.id,
        messageId: first.event_id,
        saved: false,
        expectedRevision: page.revision,
      });
      const reset = await listSavedMatrixMessages(actor, {
        cursor: page.nextCursor,
      });
      expect(reset.reset).toBe(true);
      expect(reset.items).toHaveLength(20);
      const native = z
        .object({ items: z.array(z.record(z.string(), z.unknown())) })
        .parse(await matrixRequest("GET", nativePath, undefined, viewer));
      expect(
        native.items.every(
          (item) =>
            !("text" in item) && !("body" in item) && !("content" in item)
        )
      ).toBe(true);
    } finally {
      await receiver.close();
    }
  }
);
