import { randomUUID } from "node:crypto";
import { afterAll, beforeAll, expect, test } from "vitest";
import { query } from "@db/queries";
import { sql } from "drizzle-orm";
import { matrixReceiver } from "./matrix-fixture";
import { workspaceFixture } from "./workspace-fixture";
import {
  createMatrixRoom,
  readMatrixMessages,
  sendMatrixMessage,
} from "../../server/matrix/rooms";
import { deleteMatrixMessage } from "../../server/matrix/message-actions";
import { readMatrixMedia } from "../../server/matrix/media/read";
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
  "native group redaction preserves thread history and rejects foreign or revoked actors",
  { timeout: 60000 },
  async () => {
    await using fixture = await workspaceFixture();
    const { actor, guest } = fixture;
    const room = await createMatrixRoom(actor, {
      operationId: randomUUID(),
      name: "Synthetic redaction verification",
    });
    await readMatrixMessages(guest, room.id);
    const root = await sendMatrixMessage(actor, {
      id: room.id,
      text: "Private root",
      operationId: randomUUID(),
    });
    const reply = await sendMatrixMessage(guest, {
      id: room.id,
      text: "Keep the reply",
      rootId: root.event_id,
      operationId: randomUUID(),
    });
    const deletion = {
      id: room.id,
      messageId: root.event_id,
      operationId: randomUUID(),
    };
    await expect(deleteMatrixMessage(guest, deletion)).rejects.toThrow(
      WorkspaceAccessDenied
    );
    await deleteMatrixMessage(actor, deletion);
    await deleteMatrixMessage(actor, deletion);
    const thread = await readMatrixMessages(
      guest,
      room.id,
      undefined,
      root.event_id
    );
    expect(thread.parent).toMatchObject({
      text: "Mensagem removida",
      redacted: true,
    });
    expect(thread.messages).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ id: reply.event_id, text: "Keep the reply" }),
      ])
    );
    await sendMatrixMessage(guest, {
      id: room.id,
      text: "After root deletion",
      rootId: root.event_id,
      operationId: randomUUID(),
    });
    expect(
      (await readMatrixMessages(actor, room.id, undefined, root.event_id))
        .messages
    ).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ text: "After root deletion" }),
      ])
    );
    await deleteMatrixMessage(guest, {
      id: room.id,
      messageId: reply.event_id,
      operationId: randomUUID(),
    });
    expect(
      (
        await readMatrixMessages(actor, room.id, undefined, root.event_id)
      ).messages.every((item) => item.text !== "Keep the reply")
    ).toBe(true);
    await query(
      sql`DELETE FROM workspace_memberships WHERE workspace_id = ${guest.workspaceId} AND user_id = ${guest.userId}`
    );
    await expect(
      deleteMatrixMessage(guest, {
        id: room.id,
        messageId: reply.event_id,
        operationId: randomUUID(),
      })
    ).rejects.toThrow(WorkspaceAccessDenied);
  }
);

test(
  "direct redaction removes media from both views and denies future downloads",
  { timeout: 60000 },
  async () => {
    await using fixture = await workspaceFixture();
    const { actor, guest } = fixture;
    const username = `redact_${randomUUID().replaceAll("-", "").slice(0, 16)}`;
    await saveDirectoryProfile(guest, { username, discoverable: false });
    const room = await openDirectRoom(actor, {
      username,
      operationId: randomUUID(),
    });
    const media = await sendMatrixMessage(actor, {
      id: room.id,
      text: "",
      operationId: randomUUID(),
      files: [
        {
          type: "file",
          filename: "private.txt",
          mediaType: "text/plain",
          url: "data:text/plain;base64,UHJpdmF0ZQ==",
        },
      ],
    });
    expect(
      await readMatrixMedia(guest, { id: room.id, messageId: media.event_id })
    ).toMatchObject({ filename: "private.txt" });
    await expect(
      deleteMatrixMessage(guest, {
        id: room.id,
        messageId: media.event_id,
        operationId: randomUUID(),
      })
    ).rejects.toThrow(WorkspaceAccessDenied);
    await deleteMatrixMessage(actor, {
      id: room.id,
      messageId: media.event_id,
      operationId: randomUUID(),
    });
    for (const viewer of [actor, guest]) {
      const removed = (await readMatrixMessages(viewer, room.id)).messages.find(
        (item) => item.id === media.event_id
      );
      expect(removed).toMatchObject({
        redacted: true,
        text: "Mensagem removida",
      });
      expect(removed).not.toHaveProperty("media");
      await expect(
        readMatrixMedia(viewer, { id: room.id, messageId: media.event_id })
      ).rejects.toThrow(WorkspaceAccessDenied);
    }
  }
);
