import { projectMatrixActivity } from "./activity";
import { query, transaction as withDatabaseTransaction } from "@db/queries";
import { sql } from "drizzle-orm";
import { operationSignal, withTimeout } from "../operations/async";
import { jsonString } from "@shared/validation";
import { z } from "zod";
import { createHash, randomUUID, timingSafeEqual } from "node:crypto";
import { matrixConfiguration, MatrixError, MatrixEventSchema } from "./client";
import { ingestWhatsAppMatrixEvent } from "../workspaces/whatsapp";
import { acceptMatrixNetworkEvent } from "./network-delivery";
const transactionSchema = z.object({
  events: z.array(MatrixEventSchema).max(1000),
});
export const authorizeMatrixHomeserver = async function (request: Request) {
  const config = await matrixConfiguration();
  const supplied = Buffer.from(request.headers.get("authorization") ?? "");
  const expected = Buffer.from(`Bearer ${config.homeserverToken.reveal()}`);
  if (
    supplied.length !== expected.length ||
    !timingSafeEqual(supplied, expected)
  )
    throw new MatrixError({
      reason: "forbidden",
    });
  return undefined;
};
export const acceptMatrixTransaction = async function (
  request: Request,
  transactionId: string
) {
  await authorizeMatrixHomeserver(request);
  const raw = await withTimeout(async () => {
    try {
      return await (async (signal) => {
        const reader = request.body?.getReader();
        if (!reader) throw new Error("Missing events");
        const chunks: Uint8Array[] = [];
        let size = 0;
        const abort = () => {
          void reader.cancel();
        };
        signal.addEventListener("abort", abort, {
          once: true,
        });
        try {
          for (;;) {
            // The bounded stream must be read sequentially.

            const { value, done } = await reader.read();
            if (done) break;
            size += value.byteLength;
            if (size > 2_000_000) throw new Error("Too many events");
            chunks.push(value);
          }
          return Buffer.concat(chunks).toString("utf8");
        } finally {
          signal.removeEventListener("abort", abort);
          await reader.cancel();
        }
      })(operationSignal());
    } catch {
      throw new MatrixError({
        reason: "unavailable",
      });
    }
  }, 5000);
  const transaction = await jsonString(transactionSchema).parseAsync(raw);
  // Homeserver retries refresh transport-only metadata such as unsigned.age.
  // Fence the validated semantic events, not the raw JSON serialization.
  const hash = createHash("sha256")
    .update(
      JSON.stringify({ events: transaction.events.map(transactionFingerprint) })
    )
    .digest("hex");
  const config = await matrixConfiguration();
  return await withDatabaseTransaction(async () => {
    await query(
      sql`SELECT pg_advisory_xact_lock(hashtextextended(${config.serverName}, 6))`
    );
    const previous = await query<{
      hash: string;
    }>(sql`SELECT hash FROM matrix_transactions WHERE id = ${transactionId}`);
    if (previous[0]) {
      if (previous[0].hash !== hash)
        throw new MatrixError({
          reason: "conflict",
        });
      for (const event of transaction.events)
        await projectMatrixActivity(config.serverName, event);
      return [];
    }
    const accepted: string[] = [];
    for (const event of transaction.events) {
      await projectMatrixActivity(config.serverName, event);
      const received = await query(
        sql`INSERT INTO matrix_received_events(id) VALUES (${event.event_id}) ON CONFLICT DO NOTHING RETURNING id`
      );
      if (!received.length || !event.room_id) continue;
      // Replacements update existing history; they must not start another agent turn.
      if (event.content["m.relates_to"]?.rel_type === "m.replace") continue;
      const bindings = await query<{
        id: string;
        epoch: string;
      }>(sql`SELECT id, epoch FROM workspace_group_bindings
        WHERE channel = 'matrix' AND installation_id = ${config.serverName} AND conversation_id = ${event.room_id} AND revoked_at IS NULL FOR UPDATE`);
      const binding = bindings[0];
      if (!binding) {
        if (await ingestWhatsAppMatrixEvent(event)) {
          accepted.push(event.event_id);
          continue;
        }
        if (await acceptMatrixNetworkEvent(event))
          accepted.push(event.event_id);
        continue;
      }
      if (event.type === "m.room.member") {
        await projectGroupMembership(binding.id, event);
        continue;
      }
      if (
        event.type !== "m.room.message" ||
        event.content.msgtype !== "m.text" ||
        event.sender === config.botId ||
        !event.content.body?.trim()
      )
        continue;
      const users = await query<{
        userId: string;
      }>(sql`SELECT m.user_id AS "userId" FROM matrix_room_members m
        JOIN matrix_identities i ON i.user_id = m.user_id
        JOIN workspace_group_bindings b ON b.id = m.binding_id
        JOIN workspace_memberships w ON w.workspace_id = b.workspace_id AND w.user_id = m.user_id
        JOIN workspaces s ON s.id = w.workspace_id
        JOIN organization_memberships o ON o.organization_id = s.organization_id AND o.user_id = m.user_id
        WHERE m.binding_id = ${binding.id} AND i.matrix_id = ${event.sender}`);
      if (!users[0]) continue;
      // In groups only an explicit Zoen mention activates the agent.
      if (!/(^|\s)@?zoen\b/i.test(event.content.body)) continue;
      if (event.content.body.length > 8000) continue;
      await query(sql`INSERT INTO matrix_deliveries(event_id, binding_id, epoch, user_id, message)
        VALUES (${event.event_id}, ${binding.id}, ${binding.epoch}, ${users[0].userId}, ${event.content.body}) ON CONFLICT DO NOTHING`);
      accepted.push(event.event_id);
    }
    await query(
      sql`INSERT INTO matrix_transactions(id, hash) VALUES (${transactionId}, ${hash})`
    );
    return accepted;
  });
};

async function projectGroupMembership(
  bindingId: string,
  event: z.infer<typeof MatrixEventSchema>
) {
  // Invite callbacks can follow a synchronous join; they don't change audience.
  const membership = event.content.membership;
  if (membership !== "join" && membership !== "leave" && membership !== "ban")
    return;
  if (membership === "join") {
    // joinMatrixRoom fenced this audience before committing the membership.
    // Its asynchronous callback must not invalidate newly issued cursors.
    const known = await query(sql`SELECT 1 FROM matrix_room_members m
      JOIN matrix_identities i ON i.user_id=m.user_id
      WHERE m.binding_id=${bindingId} AND i.matrix_id=${event.state_key ?? ""}`);
    if (known.length) return;
  }
  await query(
    sql`UPDATE workspace_group_bindings SET epoch = ${randomUUID()} WHERE id = ${bindingId}`
  );
  if (membership !== "join")
    await query(sql`DELETE FROM matrix_room_members WHERE binding_id = ${bindingId}
      AND user_id IN (SELECT user_id FROM matrix_identities WHERE matrix_id = ${event.state_key ?? ""})`);
}

/** Keep accepted transaction fingerprints stable as display-only aggregation schemas evolve. */
function transactionFingerprint(event: z.infer<typeof MatrixEventSchema>) {
  return {
    ...event,
    content: {
      ...event.content,
      "m.new_content": undefined,
      "org.zoen.edit_operation": undefined,
    },
    ...(event.unsigned
      ? {
          unsigned: {
            ...event.unsigned,
            ...(event.unsigned["m.relations"]
              ? {
                  "m.relations": {
                    ...event.unsigned["m.relations"],
                    "m.replace": undefined,
                  },
                }
              : {}),
          },
        }
      : {}),
  };
}
