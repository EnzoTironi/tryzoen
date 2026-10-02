import { randomUUID } from "node:crypto";
import { sql } from "drizzle-orm";
import { z } from "zod";
import { afterAll, beforeAll, expect, test, vi } from "vitest";
import { query } from "@db/queries";
import { workspaceFixture } from "./workspace-fixture";
import { matrixReceiver } from "./matrix-fixture";
import { saveDirectoryProfile } from "../../server/accounts/directory";
import { createMatrixRoom, joinMatrixRoom } from "../../server/matrix/rooms";
import {
  MatrixEventSchema,
  matrixConfiguration,
  matrixRequest,
} from "../../server/matrix/client";
import { sendMatrixMessage } from "../../server/matrix/send";
import { editMatrixMessage } from "../../server/matrix/edits";

let receiver: Awaited<ReturnType<typeof matrixReceiver>>;
beforeAll(async () => {
  receiver = await matrixReceiver();
});
afterAll(async () => {
  await receiver.close();
});

test(
  "native authored mentions isolate their audience and reply quotes do not become requests",
  { timeout: 60000 },
  async () => {
    await using fixture = await workspaceFixture();
    await using outsider = await workspaceFixture();
    const username = `mention_${randomUUID().replaceAll("-", "").slice(0, 12)}`;
    const outsideName = `outside_${randomUUID().replaceAll("-", "").slice(0, 12)}`;
    await saveDirectoryProfile(fixture.guest, {
      username,
      discoverable: false,
    });
    await saveDirectoryProfile(outsider.actor, {
      username: outsideName,
      discoverable: false,
    });
    const outsideRoom = await createMatrixRoom(outsider.actor, {
      operationId: randomUUID(),
      name: "Synthetic other mention audience",
    });
    await joinMatrixRoom(outsider.actor, outsideRoom.id);
    const room = await createMatrixRoom(fixture.actor, {
      operationId: randomUUID(),
      name: "Synthetic authored mention audience",
    });
    const author = await joinMatrixRoom(fixture.actor, room.id);
    const viewer = await joinMatrixRoom(fixture.guest, room.id);
    const config = await matrixConfiguration();
    const native = async (id: string) =>
      MatrixEventSchema.parse(
        await matrixRequest(
          "GET",
          `rooms/${encodeURIComponent(room.roomId)}/event/${encodeURIComponent(id)}`,
          undefined,
          author.matrixId
        )
      );
    const ids: string[] = [];
    const send = async (text: string, replyTo?: string) => {
      const result = await sendMatrixMessage(fixture.actor, {
        id: room.id,
        operationId: randomUUID(),
        text,
        replyTo,
      });
      ids.push(result.event_id);
      return result.event_id;
    };
    const root = await send("@Zoen original request");
    expect((await native(root)).content["m.mentions"]).toEqual({
      user_ids: [config.botId],
    });
    const quote = await send("Ready without another request", root);
    expect((await native(quote)).content.body).toContain(
      "@Zoen original request"
    );
    expect((await native(quote)).content["m.mentions"]).toEqual({
      user_ids: [],
    });
    for (const text of [
      "Zoen discussion",
      String.raw`\@Zoen escaped`,
      "https://example.invalid/?assignee=@zoen",
      "[docs](https://example.invalid/?assignee=@zoen)",
      "> @Zoen quoted",
      "`@Zoen`",
      `@${outsideName}`,
    ]) {
      const id = await send(text);
      expect((await native(id)).content["m.mentions"]).toEqual({
        user_ids: [],
      });
    }
    const human = await send(
      `@${username.toUpperCase()} and @${username}, please review`
    );
    expect((await native(human)).content["m.mentions"]).toEqual({
      user_ids: [viewer.matrixId],
    });
    const authored = await send("@Zoen confirm", root);
    expect((await native(authored)).content["m.mentions"]).toEqual({
      user_ids: [config.botId],
    });
    await vi.waitFor(
      async () => {
        const received = await query(
          sql`SELECT id FROM matrix_received_events WHERE id IN (${sql.join(
            ids.map((id) => sql`${id}`),
            sql`, `
          )})`
        );
        expect(received).toHaveLength(ids.length);
      },
      { timeout: 15000, interval: 100 }
    );
    const deliveries = await query(
      sql`SELECT event_id, message FROM matrix_deliveries WHERE binding_id=${room.id}`
    );
    expect(deliveries).toHaveLength(2);
    expect(deliveries).toEqual(
      expect.arrayContaining([
        { event_id: root, message: "@Zoen original request" },
        { event_id: authored, message: "@Zoen confirm" },
      ])
    );
  }
);

test(
  "native edit metadata contains final mentions and only new notifications without another agent turn",
  { timeout: 60000 },
  async () => {
    await using fixture = await workspaceFixture();
    const username = `editmention_${randomUUID().replaceAll("-", "").slice(0, 12)}`;
    await saveDirectoryProfile(fixture.guest, {
      username,
      discoverable: false,
    });
    const room = await createMatrixRoom(fixture.actor, {
      operationId: randomUUID(),
      name: "Synthetic mention edit revisions",
    });
    const author = await joinMatrixRoom(fixture.actor, room.id);
    const viewer = await joinMatrixRoom(fixture.guest, room.id);
    const config = await matrixConfiguration();
    const original = await sendMatrixMessage(fixture.actor, {
      id: room.id,
      operationId: randomUUID(),
      text: "@Zoen original request",
    });
    const input = {
      id: room.id,
      messageId: original.event_id,
      expectedRevision: original.event_id,
      operationId: randomUUID(),
      text: `@Zoen and @${username}`,
    };
    const edits: string[] = [];
    const native = async (id: string) =>
      MatrixEventSchema.parse(
        await matrixRequest(
          "GET",
          `rooms/${encodeURIComponent(room.roomId)}/event/${encodeURIComponent(id)}`,
          undefined,
          author.matrixId
        )
      );
    const first = await editMatrixMessage(fixture.actor, input);
    const firstId = z.string().parse(first.message.editId);
    edits.push(firstId);
    expect((await native(firstId)).content["m.mentions"]).toEqual({
      user_ids: [viewer.matrixId],
    });
    expect(
      (await native(firstId)).content["m.new_content"]?.["m.mentions"]
    ).toEqual({ user_ids: [config.botId, viewer.matrixId].toSorted() });
    expect(await editMatrixMessage(fixture.actor, input)).toEqual(first);
    const removed = await editMatrixMessage(fixture.actor, {
      ...input,
      expectedRevision: firstId,
      operationId: randomUUID(),
      text: `Only @${username}`,
    });
    const removedId = z.string().parse(removed.message.editId);
    edits.push(removedId);
    expect((await native(removedId)).content["m.mentions"]).toEqual({
      user_ids: [],
    });
    expect(
      (await native(removedId)).content["m.new_content"]?.["m.mentions"]
    ).toEqual({ user_ids: [viewer.matrixId] });
    const restored = await editMatrixMessage(fixture.actor, {
      ...input,
      expectedRevision: removedId,
      operationId: randomUUID(),
    });
    const restoredId = z.string().parse(restored.message.editId);
    edits.push(restoredId);
    expect((await native(restoredId)).content["m.mentions"]).toEqual({
      user_ids: [config.botId],
    });
    expect(
      (await native(restoredId)).content["m.new_content"]?.["m.mentions"]
    ).toEqual({ user_ids: [config.botId, viewer.matrixId].toSorted() });
    await vi.waitFor(
      async () => {
        const received = await query(
          sql`SELECT id FROM matrix_received_events WHERE id IN (${sql.join(
            [original.event_id, ...edits].map((id) => sql`${id}`),
            sql`, `
          )})`
        );
        expect(received).toHaveLength(edits.length + 1);
      },
      { timeout: 15000, interval: 100 }
    );
    expect(
      await query(
        sql`SELECT event_id FROM matrix_deliveries WHERE binding_id=${room.id}`
      )
    ).toEqual([{ event_id: original.event_id }]);
  }
);
