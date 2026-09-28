import { randomUUID } from "node:crypto";
import { expect, test } from "vitest";
import { z } from "zod";
import { workspaceFixture } from "./workspace-fixture";
import { matrixReceiver } from "./matrix-fixture";
import { matrixRequest } from "../../server/matrix/client";
import { ensureMatrixIdentity } from "../../server/matrix/identities";
import {
  createMatrixRoom,
  readMatrixMessages,
  sendMatrixMessage,
} from "../../server/matrix/rooms";
import { deleteMatrixMessage } from "../../server/matrix/message-actions";
const response = z.object({
  next_batch: z.string(),
  rooms: z
    .object({
      join: z
        .record(
          z.string(),
          z.object({
            timeline: z
              .object({
                events: z.array(
                  z.object({ event_id: z.string(), type: z.string() })
                ),
                limited: z.boolean().optional(),
              })
              .optional(),
          })
        )
        .optional(),
    })
    .optional(),
});
test(
  "measure device identity, advancing cursor and replay without copying bodies",
  { timeout: 60000 },
  async () => {
    const receiver = await matrixReceiver();
    try {
      await using fixture = await workspaceFixture();
      const room = await createMatrixRoom(fixture.actor, {
        operationId: randomUUID(),
        name: "Synthetic device sync spike",
      });
      await readMatrixMessages(fixture.guest, room.id);
      const viewer = await ensureMatrixIdentity(fixture.guest);
      const sender = await ensureMatrixIdentity(fixture.actor);
      const devices = [randomUUID(), randomUUID()];
      try {
        for (const device of devices) {
          await matrixRequest(
            "PUT",
            `devices/${device}`,
            { display_name: "Synthetic sync spike" },
            viewer
          );
          const who = z
            .object({ user_id: z.string(), device_id: z.string() })
            .parse(
              await matrixRequest(
                "GET",
                `account/whoami?device_id=${device}`,
                undefined,
                viewer
              )
            );
          expect(who).toEqual({ user_id: viewer, device_id: device });
        }
        const filter = encodeURIComponent(
          JSON.stringify({
            presence: { types: [] },
            account_data: { types: [] },
            room: {
              rooms: [room.roomId],
              include_leave: true,
              state: { types: [] },
              account_data: { types: [] },
              ephemeral: { types: [] },
              timeline: {
                limit: 4,
                types: ["m.room.message", "m.room.redaction"],
              },
            },
          })
        );
        const sync = async (device: string, since?: string) =>
          response.parse(
            await matrixRequest(
              "GET",
              `sync?device_id=${device}&timeout=0&filter=${filter}${since ? `&since=${encodeURIComponent(since)}` : ""}`,
              undefined,
              viewer
            )
          );
        const firstDevice = z.string().parse(devices[0]);
        const secondDevice = z.string().parse(devices[1]);
        const initial = await sync(firstDevice);
        const secondInitial = await sync(secondDevice);
        const message = await sendMatrixMessage(fixture.actor, {
          id: room.id,
          operationId: randomUUID(),
          text: "First measured message",
        });
        const next = await sync(firstDevice, initial.next_batch);
        expect(
          next.rooms?.join?.[room.roomId]?.timeline?.events.some(
            (event) => event.event_id === message.event_id
          )
        ).toBe(true);
        expect(await sync(firstDevice, initial.next_batch)).toEqual(next);
        await deleteMatrixMessage(fixture.actor, {
          id: room.id,
          messageId: message.event_id,
          operationId: randomUUID(),
        });
        const redacted = await sync(firstDevice, next.next_batch);
        expect(
          redacted.rooms?.join?.[room.roomId]?.timeline?.events.some(
            (event) => event.type === "m.room.redaction"
          )
        ).toBe(true);
        const original = await sendMatrixMessage(fixture.actor, {
          id: room.id,
          operationId: randomUUID(),
          text: "Before edit",
        });
        const originalSync = await sync(firstDevice, redacted.next_batch);
        const edit = z.object({ event_id: z.string() }).parse(
          await matrixRequest(
            "PUT",
            `rooms/${encodeURIComponent(room.roomId)}/send/m.room.message/${randomUUID()}`,
            {
              body: "* After",
              msgtype: "m.text",
              "m.new_content": { body: "After", msgtype: "m.text" },
              "m.relates_to": {
                rel_type: "m.replace",
                event_id: original.event_id,
              },
            },
            sender
          )
        );
        const edited = await sync(firstDevice, originalSync.next_batch);
        expect(
          edited.rooms?.join?.[room.roomId]?.timeline?.events.some(
            (event) => event.event_id === edit.event_id
          )
        ).toBe(true);
        const deviceTwo = await sync(secondDevice, secondInitial.next_batch);
        expect(
          deviceTwo.rooms?.join?.[room.roomId]?.timeline?.events.some(
            (event) => event.event_id === edit.event_id
          )
        ).toBe(true);
        expect(edited.next_batch).not.toBe(initial.next_batch);
      } finally {
        await matrixRequest("POST", "delete_devices", { devices }, viewer);
      }
    } finally {
      await receiver.close();
    }
  }
);
