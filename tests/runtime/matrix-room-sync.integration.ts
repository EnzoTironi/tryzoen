import { randomUUID } from "node:crypto";
import { afterAll, beforeAll, expect, test, vi } from "vitest";
import { query } from "@db/queries";
import { sql } from "drizzle-orm";
import { matrixReceiver } from "./matrix-fixture";
import { workspaceFixture } from "./workspace-fixture";
import {
  createMatrixRoom,
  joinMatrixRoom,
  readMatrixMessages,
  sendMatrixMessage,
} from "../../server/matrix/rooms";
import { readMatrixRoomSync } from "../../server/matrix/sync/room";
import {
  readMatrixReactions,
  setMatrixReaction,
} from "../../server/matrix/reactions";
import { editMatrixMessage } from "../../server/matrix/edits";
import { deleteMatrixMessage } from "../../server/matrix/message-actions";
import { WorkspaceAccessDenied } from "../../server/workspaces/access";

let receiver: Awaited<ReturnType<typeof matrixReceiver>> | undefined;
beforeAll(async () => {
  receiver = await matrixReceiver();
});
afterAll(async () => {
  await receiver?.close();
});

test(
  "native room sync distinguishes idle history from new, edited and removed content",
  { timeout: 120000 },
  async () => {
    await using fixture = await workspaceFixture();
    const room = await createMatrixRoom(fixture.actor, {
      operationId: randomUUID(),
      name: "Synthetic room change feed",
    });
    await joinMatrixRoom(fixture.actor, room.id);
    await joinMatrixRoom(fixture.guest, room.id);
    const baseline = await sendMatrixMessage(fixture.actor, {
      id: room.id,
      operationId: randomUUID(),
      text: "Synthetic membership baseline",
    });
    // Room creation and joins reach the application service asynchronously.
    // Wait for their projection before asserting that an idle audience is stable.
    await vi.waitFor(
      () => {
        expect(
          receiver?.receipts.some((receipt) =>
            receipt.body.includes(baseline.event_id)
          )
        ).toBe(true);
      },
      { timeout: 15000, interval: 100 }
    );
    let cursor: string | undefined;
    const sync = async () => {
      const result = await readMatrixRoomSync(fixture.guest, {
        id: room.id,
        cursor,
      });
      expect(result.status).toBe("ready");
      cursor = result.cursor ?? undefined;
      return result;
    };
    expect(await sync()).toMatchObject({ reset: true });
    expect(await sync()).toMatchObject({
      reset: false,
      timelineChanged: false,
    });
    const sent = await sendMatrixMessage(fixture.actor, {
      id: room.id,
      operationId: randomUUID(),
      text: "Synthetic original message",
    });
    const changed = await sync();
    expect(changed.timelineChanged).toBe(true);
    expect(changed.changes?.added).toEqual([
      expect.objectContaining({
        id: sent.event_id,
        text: "Synthetic original message",
      }),
    ]);
    const reaction = await setMatrixReaction(fixture.actor, {
      id: room.id,
      messageId: sent.event_id,
      operationId: randomUUID(),
      emoji: "❤️",
    });
    expect(await sync()).toMatchObject({
      reset: false,
      timelineChanged: false,
      reactionsChanged: true,
      changes: null,
    });
    expect(
      await readMatrixReactions(fixture.guest, {
        id: room.id,
        messageIds: [sent.event_id],
      })
    ).toMatchObject([{ reactions: [{ emoji: "❤️", count: 1 }] }]);
    await setMatrixReaction(fixture.actor, {
      id: room.id,
      messageId: sent.event_id,
      operationId: randomUUID(),
      previousEventId: reaction.mineEventId ?? undefined,
      emoji: null,
    });
    expect(await sync()).toMatchObject({ reactionsChanged: true });
    expect(
      await readMatrixReactions(fixture.guest, {
        id: room.id,
        messageIds: [sent.event_id],
      })
    ).toMatchObject([{ reactions: [] }]);
    await editMatrixMessage(fixture.actor, {
      id: room.id,
      messageId: sent.event_id,
      expectedRevision: sent.event_id,
      operationId: randomUUID(),
      text: "Synthetic edited message",
    });
    const edited = await sync();
    expect(edited.changes?.updated).toEqual([
      expect.objectContaining({
        id: sent.event_id,
        text: "Synthetic edited message",
      }),
    ]);
    expect(
      (await readMatrixMessages(fixture.guest, room.id)).messages.find(
        (m) => m.id === sent.event_id
      )?.text
    ).toBe("Synthetic edited message");
    const reply = await sendMatrixMessage(fixture.actor, {
      id: room.id,
      rootId: sent.event_id,
      operationId: randomUUID(),
      text: "Synthetic thread arrival",
    });
    const thread = await sync();
    expect(thread.changes?.added[0]).toMatchObject({
      id: reply.event_id,
      rootId: sent.event_id,
    });
    expect(thread.changes?.updated[0]).toMatchObject({
      id: sent.event_id,
      replies: 1,
      text: "Synthetic edited message",
    });
    await deleteMatrixMessage(fixture.actor, {
      id: room.id,
      messageId: sent.event_id,
      operationId: randomUUID(),
    });
    expect(await sync()).toMatchObject({
      timelineChanged: true,
      changes: null,
    });
    expect(
      (await readMatrixMessages(fixture.guest, room.id)).messages.find(
        (m) => m.id === sent.event_id
      )?.redacted
    ).toBe(true);

    for (let n = 0; n < 21; n += 1) {
      await sendMatrixMessage(fixture.actor, {
        id: room.id,
        operationId: randomUUID(),
        text: `Synthetic burst ${n}`,
      });
    }
    expect(await sync()).toMatchObject({ reset: true, timelineChanged: true });
    expect(
      (await readMatrixMessages(fixture.guest, room.id)).messages.filter((m) =>
        m.text.startsWith("Synthetic burst")
      )
    ).toHaveLength(21);
    await query(
      sql`DELETE FROM workspace_memberships WHERE workspace_id=${fixture.guest.workspaceId} AND user_id=${fixture.guest.userId}`
    );
    await expect(sync()).rejects.toBeInstanceOf(WorkspaceAccessDenied);
  }
);
