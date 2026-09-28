import { z } from "zod";
import { WorkspaceAccessDenied } from "../../server/workspaces/access";
import { randomUUID } from "node:crypto";
import { expect, test } from "vitest";
import { workspaceFixture } from "./workspace-fixture";
import { matrixReceiver } from "./matrix-fixture";
import { query } from "@db/queries";
import { sql } from "drizzle-orm";
import { matrixConfiguration, matrixRequest } from "../../server/matrix/client";
import { acceptMatrixTransaction } from "../../server/matrix/inbound";
import { saveDirectoryProfile } from "../../server/accounts/directory";
import { openDirectRoom } from "../../server/matrix/direct";
import { editMatrixMessage } from "../../server/matrix/edits";
import {
  createMatrixRoom,
  readMatrixMessages,
  sendMatrixMessage,
} from "../../server/matrix/rooms";
import { deleteMatrixMessage } from "../../server/matrix/message-actions";

test(
  "native replacements retain identity, reject stale revisions and remain idempotent",
  { timeout: 60000 },
  async () => {
    const receiver = await matrixReceiver();
    try {
      await using fixture = await workspaceFixture();
      const room = await createMatrixRoom(fixture.actor, {
        operationId: randomUUID(),
        name: "Synthetic edit aggregation",
      });
      await readMatrixMessages(fixture.guest, room.id);
      const original = await sendMatrixMessage(fixture.actor, {
        id: room.id,
        operationId: randomUUID(),
        text: "Before",
      });
      const input = {
        id: room.id,
        messageId: original.event_id,
        operationId: randomUUID(),
        text: "After",
        expectedRevision: original.event_id,
      };
      const first = await editMatrixMessage(fixture.actor, input);
      expect(first.status).toBe("saved");
      expect(first.message.text).toBe("After");
      expect(first.message.id).toBe(original.event_id);
      expect(first.message.editId).toBeTruthy();
      const retry = await editMatrixMessage(fixture.actor, input);
      expect(retry).toEqual(first);
      const changedPayload = await editMatrixMessage(fixture.actor, {
        ...input,
        expectedRevision: z.string().parse(first.message.editId),
        text: "Different payload with reused operation",
      });
      expect(changedPayload.status).toBe("conflict");
      expect(changedPayload.message.text).toBe("After");
      const another = await sendMatrixMessage(fixture.actor, {
        id: room.id,
        operationId: randomUUID(),
        text: "Other original",
      });
      const changedTarget = await editMatrixMessage(fixture.actor, {
        ...input,
        messageId: another.event_id,
        expectedRevision: another.event_id,
      });
      expect(changedTarget.status).toBe("conflict");
      expect(changedTarget.message.text).toBe("Other original");
      expect(changedTarget.message.editId).toBeUndefined();
      const second = await editMatrixMessage(fixture.actor, {
        ...input,
        operationId: randomUUID(),
        expectedRevision: z.string().parse(first.message.editId),
        text: "Newest",
      });
      expect(second.status).toBe("saved");
      expect(second.message.text).toBe("Newest");
      const stale = await editMatrixMessage(fixture.actor, input);
      expect(stale.status).toBe("conflict");
      expect(stale.message.text).toBe("Newest");
      const page = await readMatrixMessages(fixture.actor, room.id);
      expect(
        page.messages.filter((m) => m.id === original.event_id)
      ).toHaveLength(1);
      expect(page.messages.find((m) => m.id === original.event_id)?.text).toBe(
        "Newest"
      );
      await expect(
        editMatrixMessage(fixture.guest, {
          ...input,
          operationId: randomUUID(),
          expectedRevision: z.string().parse(second.message.editId),
        })
      ).rejects.toThrow(WorkspaceAccessDenied);
      const other = await createMatrixRoom(fixture.actor, {
        operationId: randomUUID(),
        name: "Synthetic other edit room",
      });
      await expect(
        editMatrixMessage(fixture.actor, { ...input, id: other.id })
      ).rejects.toMatchObject({ name: "MatrixError", reason: "not-found" });
      const reply = await sendMatrixMessage(fixture.actor, {
        id: room.id,
        operationId: randomUUID(),
        text: "Thread before",
        rootId: original.event_id,
      });
      const editedReply = await editMatrixMessage(fixture.actor, {
        ...input,
        messageId: reply.event_id,
        expectedRevision: reply.event_id,
        operationId: randomUUID(),
        text: "Thread after",
      });
      expect(editedReply.message.rootId).toBe(original.event_id);
      const thread = await readMatrixMessages(
        fixture.actor,
        room.id,
        undefined,
        original.event_id
      );
      expect(thread.parent?.text).toBe("Newest");
      expect(
        thread.messages.find((message) => message.id === reply.event_id)?.text
      ).toBe("Thread after");
      const config = await matrixConfiguration();
      const event = await matrixRequest(
        "GET",
        `rooms/${encodeURIComponent(room.roomId)}/event/${encodeURIComponent(z.string().parse(editedReply.message.editId))}`,
        undefined,
        editedReply.message.sender
      );
      const transactionId = randomUUID();
      const deliver = (value: unknown) =>
        acceptMatrixTransaction(
          new Request("http://localhost/transactions", {
            method: "PUT",
            headers: {
              authorization: `Bearer ${config.homeserverToken.reveal()}`,
            },
            body: JSON.stringify({ events: [value] }),
          }),
          transactionId
        );
      await deliver(event);
      const parsed = z
        .object({ content: z.record(z.string(), z.unknown()) })
        .loose()
        .parse(event);
      await expect(
        deliver({
          ...parsed,
          content: {
            ...parsed.content,
            "m.new_content": {
              msgtype: "m.text",
              body: "Zoen, do not execute a replacement",
            },
          },
        })
      ).resolves.toEqual([]);
      expect(
        await query(
          sql`SELECT event_id FROM matrix_deliveries WHERE event_id=${editedReply.message.editId}`
        )
      ).toHaveLength(0);
      await saveDirectoryProfile(fixture.guest, {
        username: `edit_${randomUUID().replaceAll("-", "").slice(0, 12)}`,
        discoverable: false,
      }).then(async (profile) => {
        const dm = await openDirectRoom(fixture.actor, {
          username: profile.username,
          operationId: randomUUID(),
        });
        const sent = await sendMatrixMessage(fixture.actor, {
          id: dm.id,
          operationId: randomUUID(),
          text: "Direct before",
        });
        const changed = await editMatrixMessage(fixture.actor, {
          id: dm.id,
          messageId: sent.event_id,
          expectedRevision: sent.event_id,
          operationId: randomUUID(),
          text: "Direct after",
        });
        expect(changed.message.text).toBe("Direct after");
        expect(
          (await readMatrixMessages(fixture.guest, dm.id)).messages.find(
            (message) => message.id === sent.event_id
          )?.text
        ).toBe("Direct after");
      });
      await deleteMatrixMessage(fixture.actor, {
        id: room.id,
        messageId: original.event_id,
        operationId: randomUUID(),
      });
      await expect(
        editMatrixMessage(fixture.actor, {
          ...input,
          expectedRevision: z.string().parse(second.message.editId),
        })
      ).rejects.toThrow(WorkspaceAccessDenied);
    } finally {
      await receiver.close();
    }
  }
);
