import { searchMatrixMessages } from "../../server/matrix/search";
import { readMatrixContext } from "../../server/matrix/context";
import { WorkspaceAccessDenied } from "../../server/workspaces/access";
import { randomUUID } from "node:crypto";
import { expect, test, vi } from "vitest";
import { z } from "zod";
import { workspaceFixture } from "./workspace-fixture";
import { matrixReceiver } from "./matrix-fixture";
import { matrixRequest, MatrixEventSchema } from "../../server/matrix/client";
import { createMatrixRoom, joinMatrixRoom } from "../../server/matrix/rooms";
import { sendMatrixMessage } from "../../server/matrix/send";
import { editMatrixMessage } from "../../server/matrix/edits";
import { deleteMatrixMessage } from "../../server/matrix/message-actions";

const nativeResults = z.object({
  search_categories: z.object({
    room_events: z.object({
      results: z.array(z.object({ result: MatrixEventSchema })),
      next_batch: z.string().optional(),
    }),
  }),
});

async function waitForInitialMembership(
  receiver: Awaited<ReturnType<typeof matrixReceiver>>,
  roomId: string
) {
  const members = z
    .array(MatrixEventSchema)
    .parse(
      await matrixRequest("GET", `rooms/${encodeURIComponent(roomId)}/state`)
    )
    .filter(
      (event) =>
        event.type === "m.room.member" && event.content.membership === "join"
    )
    .map((event) => z.string().min(1).parse(event.event_id));
  expect(members.length).toBeGreaterThan(0);
  await vi.waitFor(
    () => {
      const committed = new Set(
        receiver.receipts.flatMap(({ body }) =>
          z
            .object({ events: z.array(MatrixEventSchema) })
            .parse(JSON.parse(body))
            .events.map((event) => event.event_id)
        )
      );
      for (const eventId of members) expect(committed).toContain(eventId);
    },
    { timeout: 10_000, interval: 25 }
  );
}

test(
  "native search indexes replacements and removes redacted content",
  { timeout: 60000 },
  async () => {
    const receiver = await matrixReceiver();
    try {
      await using fixture = await workspaceFixture();
      const room = await createMatrixRoom(fixture.actor, {
        operationId: randomUUID(),
        name: "Synthetic search protocol",
      });
      const joined = await joinMatrixRoom(fixture.actor, room.id);
      await waitForInitialMembership(receiver, room.roomId);
      const search = async (term: string) =>
        nativeResults.parse(
          await matrixRequest(
            "POST",
            "search",
            {
              search_categories: {
                room_events: {
                  search_term: term,
                  keys: ["content.body"],
                  order_by: "recent",
                  filter: {
                    rooms: [room.roomId],
                    types: ["m.room.message"],
                    limit: 20,
                  },
                  event_context: {
                    before_limit: 0,
                    after_limit: 0,
                    include_profile: false,
                  },
                  include_state: false,
                },
              },
            },
            joined.matrixId
          )
        ).search_categories.room_events;
      const sent = await sendMatrixMessage(fixture.actor, {
        id: room.id,
        operationId: randomUUID(),
        text: "oldquartz",
      });
      expect(
        (await search("oldquartz")).results.map((hit) => hit.result.event_id)
      ).toContain(sent.event_id);
      const edited = await editMatrixMessage(fixture.actor, {
        id: room.id,
        messageId: sent.event_id,
        expectedRevision: sent.event_id,
        operationId: randomUUID(),
        text: "newquartz",
      });
      expect(edited.status).toBe("saved");
      const newHits = await search("newquartz");
      expect(newHits.results.map((hit) => hit.result.event_id)).toContain(
        edited.message.editId
      );
      const oldHits = await search("oldquartz");
      expect(
        oldHits.results.some((hit) => hit.result.event_id === sent.event_id)
      ).toBe(true);
      expect(
        (
          await searchMatrixMessages(fixture.actor, {
            id: room.id,
            query: "oldquartz",
          })
        ).items
      ).toHaveLength(0);
      const fresh = await searchMatrixMessages(fixture.actor, {
        id: room.id,
        query: "newquartz",
      });
      expect(fresh.items.map((item) => item.id)).toEqual([sent.event_id]);
      expect(fresh.items[0]?.text).toBe("newquartz");
      await deleteMatrixMessage(fixture.actor, {
        id: room.id,
        messageId: sent.event_id,
        operationId: randomUUID(),
      });
      expect((await search("oldquartz")).results).toHaveLength(0);
      expect(
        (
          await searchMatrixMessages(fixture.actor, {
            id: room.id,
            query: "newquartz",
          })
        ).items
      ).toHaveLength(0);
    } finally {
      await receiver.close();
    }
  }
);

test(
  "conversation search pages natively, scopes cursors and opens old thread context",
  { timeout: 60000 },
  async () => {
    const receiver = await matrixReceiver();
    try {
      await using fixture = await workspaceFixture();
      const room = await createMatrixRoom(fixture.actor, {
        operationId: randomUUID(),
        name: "Synthetic paged search",
      });
      const guest = await joinMatrixRoom(fixture.guest, room.id);
      const root = await sendMatrixMessage(fixture.actor, {
        id: room.id,
        operationId: randomUUID(),
        text: "searchnebula root",
      });
      const reply = await sendMatrixMessage(fixture.guest, {
        id: room.id,
        operationId: randomUUID(),
        text: "searchnebula thread",
        rootId: root.event_id,
      });
      for (let index = 0; index < 23; index++)
        await sendMatrixMessage(fixture.actor, {
          id: room.id,
          operationId: randomUUID(),
          text: `searchnebula ${index}`,
        });
      await waitForInitialMembership(receiver, room.roomId);
      const input = { id: room.id, query: "searchnebula" };
      const first = await searchMatrixMessages(fixture.actor, input);
      expect(first.items).toHaveLength(20);
      const cursor = z.string().parse(first.nextCursor);
      const second = await searchMatrixMessages(fixture.actor, {
        ...input,
        cursor,
      });
      expect(
        new Set([...first.items, ...second.items].map((item) => item.id)).size
      ).toBe(25);
      expect(
        second.items.some(
          (item) => item.id === reply.event_id && item.rootId === root.event_id
        )
      ).toBe(true);
      const context = await readMatrixContext(fixture.actor, {
        id: room.id,
        messageId: reply.event_id,
      });
      expect(context.target.id).toBe(reply.event_id);
      expect(context.root?.id).toBe(root.event_id);
      const authored = await searchMatrixMessages(fixture.actor, {
        ...input,
        senderId: guest.matrixId,
      });
      expect(authored.items.map((item) => item.id)).toEqual([reply.event_id]);
      await expect(
        searchMatrixMessages(fixture.guest, { ...input, cursor })
      ).rejects.toThrow(WorkspaceAccessDenied);
      await expect(
        searchMatrixMessages(fixture.actor, {
          ...input,
          query: "other",
          cursor,
        })
      ).rejects.toThrow(WorkspaceAccessDenied);
      await expect(
        searchMatrixMessages(fixture.actor, {
          ...input,
          senderId: guest.matrixId,
          cursor,
        })
      ).rejects.toThrow(WorkspaceAccessDenied);
      await expect(
        searchMatrixMessages(fixture.actor, {
          ...input,
          cursor: `${cursor}invalid`,
        })
      ).rejects.toThrow(WorkspaceAccessDenied);
      const other = await createMatrixRoom(fixture.actor, {
        operationId: randomUUID(),
        name: "Synthetic private search scope",
      });
      await expect(
        searchMatrixMessages(fixture.actor, { ...input, id: other.id, cursor })
      ).rejects.toThrow(WorkspaceAccessDenied);
    } finally {
      await receiver.close();
    }
  }
);
