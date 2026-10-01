import { db } from "@db";
import { query, transaction } from "@db/queries";
import { sql } from "drizzle-orm";
import { randomUUID } from "node:crypto";
import { afterAll, beforeAll, expect, test } from "vitest";
import { z } from "zod";
import { buildEveFixture, clearFixtureWorkflows, runtime } from "./eve-fixture";
import { matrixCallbackPort, matrixReceiver } from "./matrix-fixture";
import { requireRuntimeDatabase } from "./database";
import { workspaceFixture } from "./workspace-fixture";
import {
  closeMatrixRoom,
  createMatrixRoom,
  readMatrixMessages,
} from "../../server/matrix/rooms";
import { sendMatrixMessage } from "../../server/matrix/send";
import { lockMatrixAdmission } from "../../server/matrix/authority";

// Actual application SQL, compiled Eve cross-channel delivery and local Synapse.
// The existing fixture model supplies deterministic text; no Matrix, SQL, channel
// or transaction boundary is mocked. This requires the allocated runtime services.
beforeAll(buildEveFixture, 65_000);
afterAll(clearFixtureWorkflows);

test("pending recovery commits SQL phases before native handoff under its inherited deadline", async () => {
  await requireRuntimeDatabase();
  await using workspace = await workspaceFixture();
  const { actor, guest } = workspace;
  const resources = new AsyncDisposableStack();
  try {
    // Persist a native mention while the application dispatcher is absent. Its
    // callback is acknowledged by the real SQL receiver, so Synapse will not
    // accidentally rescue recovery with another callback after restart.
    const receiver = await matrixReceiver();
    resources.defer(receiver.close);
    const room = await createMatrixRoom(actor, {
      operationId: randomUUID(),
      name: "Synthetic inherited-deadline recovery",
    });
    resources.defer(async () => {
      await closeMatrixRoom(actor, room.id);
    });
    await readMatrixMessages(guest, room.id);
    const sent = await sendMatrixMessage(guest, {
      id: room.id,
      operationId: randomUUID(),
      text: "@Zoen recover this accepted synthetic request.",
    });
    await expect
      .poll(
        async () =>
          (
            await query<{ state: string }>(
              sql`SELECT state FROM matrix_deliveries WHERE event_id = ${sent.event_id}`
            )
          )[0]?.state,
        { timeout: 20_000, interval: 100 }
      )
      .toBe("pending");
    await receiver.close();
    const server = await runtime(matrixCallbackPort, "0.0.0.0");
    resources.defer(server.stop);

    // Hold only the existing transport handoff lock. Matrix authority/prompt
    // phases must commit independently before that native handoff can proceed.
    const holder = await db.$client.connect();
    let completed:
      | { ok: true; response: unknown }
      | { ok: false; error: unknown }
      | undefined;
    let recovery: Promise<NonNullable<typeof completed>> | undefined;
    try {
      await holder.query("BEGIN");
      await holder.query("SET LOCAL statement_timeout = '5s'");
      await holder.query(
        "SELECT pg_advisory_xact_lock(hashtextextended($1,4218))",
        [`${actor.workspaceId}:matrix:${sent.event_id}`]
      );
      const [lock] = (
        await holder.query<{ classid: number; objid: number }>(
          "SELECT classid,objid FROM pg_locks WHERE pid=pg_backend_pid() AND locktype='advisory' AND granted"
        )
      ).rows;
      if (!lock) throw new Error("Missing synthetic native-handoff lock");
      recovery = server
        .request("/probe/matrix/recover", {
          eventId: sent.event_id,
        })
        .then(
          (response) => {
            completed = { ok: true, response };
            return completed;
          },
          (error: unknown) => {
            completed = { ok: false, error };
            return completed;
          }
        );
      await expect
        .poll(
          async () => {
            if (completed && !completed.ok) throw completed.error;
            return (
              await holder.query<{ waiting: string }>(
                "SELECT COUNT(*)::text AS waiting FROM pg_locks WHERE locktype='advisory' AND classid=$1::oid AND objid=$2::oid AND NOT granted AND database=(SELECT oid FROM pg_database WHERE datname=current_database())",
                [lock.classid, lock.objid]
              )
            ).rows[0]?.waiting;
          },
          { timeout: 10_000, interval: 100 }
        )
        .toBe("1");
      const [prepared] = await query<{ prompt: string | null }>(
        sql`SELECT prompt FROM matrix_deliveries WHERE event_id = ${sent.event_id}`
      );
      expect(prepared?.prompt).toContain(
        "recover this accepted synthetic request"
      );
      // A second real connection can acquire the conflicting organization and
      // room authority fences while the native handoff is still waiting.
      await transaction(
        async () => {
          await query(sql`SET LOCAL lock_timeout = '500ms'`);
          await lockMatrixAdmission([actor.workspaceId], [room.id], "update");
        },
        { outermost: true }
      );
      expect(completed).toBeUndefined();
      await holder.query("COMMIT");
      const result = await recovery;
      if (!result.ok) throw result.error;
      const { sessionId } = z
        .object({ sessionId: z.string() })
        .parse(result.response);
      await server.settled(sessionId);
      await expect
        .poll(
          async () =>
            (
              await query<{ state: string }>(
                sql`SELECT state FROM matrix_deliveries WHERE event_id = ${sent.event_id}`
              )
            )[0]?.state,
          { timeout: 20_000, interval: 100 }
        )
        .toBe("completed");
      expect(
        await query<{ sessionId: string }>(
          sql`SELECT session_id AS "sessionId" FROM native_delivery_receipts
          WHERE workspace_id = ${actor.workspaceId} AND input_id = ${sent.event_id}`
        )
      ).toEqual([{ sessionId }]);
    } finally {
      await holder.query("ROLLBACK").catch(() => undefined);
      holder.release();
      if (recovery) await recovery;
    }
  } finally {
    await resources.disposeAsync();
  }
}, 90_000);
