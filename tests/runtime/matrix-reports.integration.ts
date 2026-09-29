import { randomUUID } from "node:crypto";
import { Client } from "pg";
import { afterAll, beforeAll, expect, test, vi } from "vitest";
import { sql } from "drizzle-orm";
import { query } from "@db/queries";
import { workspaceFixture } from "./workspace-fixture";
import { createMatrixRoom, joinMatrixRoom } from "../../server/matrix/rooms";
import { sendMatrixMessage } from "../../server/matrix/send";
import { reportMatrixMessage } from "../../server/matrix/reports";
import { editMatrixMessage } from "../../server/matrix/edits";
import { WorkspaceAccessDenied } from "../../server/workspaces/access";
import * as native from "../../server/matrix/client";

// The ordinary app cannot read moderation records. This isolated test observes Synapse's queue.
const moderation = new Client({
  host: "127.0.0.1",
  port: 15432,
  user: "synapse_runtime",
  password: "synthetic-matrix",
  database: "synapse_runtime",
});
beforeAll(() => moderation.connect());
afterAll(() => moderation.end());

test(
  "reports the selected native revision once, enforces admission, and never replays uncertain delivery",
  { timeout: 60000 },
  async () => {
    await using fixture = await workspaceFixture();
    await using outsider = await workspaceFixture();
    const room = await createMatrixRoom(fixture.actor, {
      operationId: randomUUID(),
      name: "Synthetic moderation review",
    });
    const reader = await joinMatrixRoom(fixture.guest, room.id);
    const send = (text: string, rootId?: string) =>
      sendMatrixMessage(fixture.actor, {
        id: room.id,
        operationId: randomUUID(),
        text,
        rootId,
      });
    const first = await send("Synthetic report target");
    const input = {
      id: room.id,
      messageId: first.event_id,
      expectedRevision: first.event_id,
      reason: "Synthetic moderation proof — not a real complaint",
    };
    try {
      await expect(reportMatrixMessage(fixture.actor, input)).rejects.toThrow(
        WorkspaceAccessDenied
      );
      await expect(reportMatrixMessage(outsider.actor, input)).rejects.toThrow(
        WorkspaceAccessDenied
      );
      await expect(
        reportMatrixMessage(
          { ...fixture.guest, authSessionId: undefined },
          input
        )
      ).rejects.toThrow(WorkspaceAccessDenied);
      await expect(
        reportMatrixMessage(fixture.guest, {
          ...input,
          messageId: "$not-visible",
          expectedRevision: "$not-visible",
        })
      ).rejects.toThrow(native.MatrixError);
      const concurrent = await Promise.all([
        reportMatrixMessage(fixture.guest, input),
        reportMatrixMessage(fixture.guest, input),
      ]);
      expect(concurrent).toContainEqual({ status: "submitted" });
      expect(await reportMatrixMessage(fixture.guest, input)).toEqual({
        status: "submitted",
      });
      const received = await moderation.query(
        "SELECT event_id, room_id, reason FROM event_reports WHERE user_id = $1",
        [reader.matrixId]
      );
      expect(received.rows).toEqual([
        {
          event_id: first.event_id,
          room_id: room.roomId,
          reason: input.reason,
        },
      ]);

      const edit = await editMatrixMessage(fixture.actor, {
        id: room.id,
        operationId: randomUUID(),
        messageId: first.event_id,
        expectedRevision: first.event_id,
        text: "Updated selected evidence",
      });
      expect(edit.status).toBe("saved");
      expect(await reportMatrixMessage(fixture.guest, input)).toEqual({
        status: "changed",
      });
      const edited = {
        ...input,
        expectedRevision: edit.message.editId ?? first.event_id,
      };
      expect(await reportMatrixMessage(fixture.guest, edited)).toEqual({
        status: "submitted",
      });
      const reply = await send("Synthetic thread report", first.event_id);
      expect(
        await reportMatrixMessage(fixture.guest, {
          ...input,
          messageId: reply.event_id,
          expectedRevision: reply.event_id,
        })
      ).toEqual({ status: "submitted" });

      const uncertainMessage = await send("Synthetic lost confirmation");
      const uncertain = {
        ...input,
        messageId: uncertainMessage.event_id,
        expectedRevision: uncertainMessage.event_id,
      };
      const originalRequest = native.matrixRequest;
      const spy = vi
        .spyOn(native, "matrixRequest")
        .mockImplementation(async (...args) => {
          const result = await originalRequest(...args);
          if (args[0] === "POST" && args[1].includes("/report/"))
            throw new native.MatrixError({ reason: "unavailable" });
          return result;
        });
      expect(await reportMatrixMessage(fixture.guest, uncertain)).toEqual({
        status: "uncertain",
      });
      spy.mockRestore();
      expect(await reportMatrixMessage(fixture.guest, uncertain)).toEqual({
        status: "uncertain",
      });
      const exactlyOnce = await moderation.query(
        "SELECT event_id FROM event_reports WHERE user_id = $1 ORDER BY event_id",
        [reader.matrixId]
      );
      expect(exactlyOnce.rows).toHaveLength(4);
      expect(exactlyOnce.rows).toContainEqual({
        event_id: edited.expectedRevision,
      });
      expect(exactlyOnce.rows).toContainEqual({
        event_id: uncertainMessage.event_id,
      });

      await query(sql`INSERT INTO matrix_message_reports(user_id, server_name, room_id, event_id, status)
      SELECT ${fixture.guest.userId}, 'zoen-eve.test', ${room.roomId}, 'synthetic-quota-' || n, 'submitted' FROM generate_series(1, 6) n`);
      const overflow = await send("Should not reach moderation");
      expect(
        await reportMatrixMessage(fixture.guest, {
          ...input,
          messageId: overflow.event_id,
          expectedRevision: overflow.event_id,
        })
      ).toEqual({ status: "limited" });
      expect(await reportMatrixMessage(fixture.guest, edited)).toEqual({
        status: "submitted",
      });
      await query(
        sql`UPDATE matrix_room_members SET state = 'removed' WHERE binding_id = ${room.id} AND user_id = ${fixture.guest.userId}`
      );
      await expect(reportMatrixMessage(fixture.guest, edited)).rejects.toThrow(
        WorkspaceAccessDenied
      );
    } finally {
      await moderation.query("DELETE FROM event_reports WHERE user_id = $1", [
        reader.matrixId,
      ]);
      await query(
        sql`DELETE FROM matrix_message_reports WHERE user_id = ${fixture.guest.userId}`
      );
    }
  }
);
