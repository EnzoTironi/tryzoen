import { readNativeGroupMembership } from "./membership";
import { lockMatrixAdmission } from "./authority";
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
import { readMatrixText } from "./messages";
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
    const rooms = [
      ...new Set(
        transaction.events.flatMap((event) =>
          event.room_id ? [event.room_id] : []
        )
      ),
    ].toSorted();
    const locate = async () => {
      if (!rooms.length) return { groups: [], network: [] };
      const groups = await query<{
        id: string;
        workspaceId: string;
        roomId: string;
      }>(sql`SELECT id, workspace_id AS "workspaceId", conversation_id AS "roomId"
        FROM workspace_group_bindings
        WHERE channel = 'matrix' AND installation_id = ${config.serverName}
          AND conversation_id = ANY(${sql.param(rooms)}::text[]) AND revoked_at IS NULL
        ORDER BY id`);
      const network = await query<{
        id: string;
        workspaceId: string;
        destWorkspaceId: string;
        grantId: string;
        destBotId: string;
        roomId: string;
      }>(sql`SELECT c.id, c.workspace_id AS "workspaceId", b.workspace_id AS "destWorkspaceId",
          c.grant_id AS "grantId", b.id AS "destBotId", c.room_id AS "roomId"
        FROM matrix_agent_conversations c
        JOIN workspace_agent_grants g ON g.id = c.grant_id
        JOIN workspace_bots b ON b.id = g.bot_id
        WHERE c.server_name = ${config.serverName} AND c.room_id = ANY(${sql.param(rooms)}::text[])
          AND c.closed_at IS NULL ORDER BY c.id`);
      return {
        groups: groups.toSorted((left, right) =>
          left.id.localeCompare(right.id)
        ),
        network: network.toSorted((left, right) =>
          left.id.localeCompare(right.id)
        ),
      };
    };
    // These raw mappings select fences only; they never grant membership or access.
    const located = await locate();
    await lockMatrixAdmission(
      located.network.flatMap((conversation) => [
        conversation.workspaceId,
        conversation.destWorkspaceId,
      ]),
      located.groups.map((binding) => binding.id)
    );
    if (JSON.stringify(located) !== JSON.stringify(await locate()))
      throw new MatrixError({ reason: "unavailable" });
    // The whole batch's organization and room fences precede the server receipt lock.
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
      // A copied mention is shared content, not a fresh request to the agent.
      if (event.content["org.zoen.forwarded"]) continue;
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
        WHERE m.binding_id = ${binding.id} AND m.state = 'joined' AND i.matrix_id = ${event.sender}`);
      if (!users[0]) continue;
      // Native mention metadata is the only group invocation authority.
      if (!event.content["m.mentions"]?.user_ids?.includes(config.botId))
        continue;
      const message = readMatrixText(event.content).text;
      if (!message.trim() || message.length > 8000) continue;
      await query(sql`INSERT INTO matrix_deliveries(event_id, binding_id, epoch, user_id, message)
        VALUES (${event.event_id}, ${binding.id}, ${binding.epoch}, ${users[0].userId}, ${message}) ON CONFLICT DO NOTHING`);
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
  if (!event.state_key || !event.room_id) return;
  const current = await readNativeGroupMembership(
    event.room_id,
    event.state_key
  );
  // Read current native state: delayed leave callbacks must not undo a later re-add.
  if (current === "join") {
    const known =
      await query(sql`SELECT 1 FROM matrix_room_members m JOIN matrix_identities i ON i.user_id = m.user_id
      WHERE m.binding_id = ${bindingId} AND i.matrix_id = ${event.state_key} AND m.state = 'joined'`);
    if (known.length) return;
    await query(
      sql`UPDATE workspace_group_bindings SET epoch = ${randomUUID()} WHERE id = ${bindingId}`
    );
    await query(sql`UPDATE matrix_room_members SET native_pending = true, native_retry_at = now()
      WHERE binding_id = ${bindingId} AND state <> 'joined'
        AND user_id IN (SELECT user_id FROM matrix_identities WHERE matrix_id = ${event.state_key})`);
    return;
  }
  if (current !== "leave" && current !== "ban") return;
  const changed = await query(sql`UPDATE matrix_room_members SET state = CASE
      WHEN state = 'removed' OR ${current} = 'ban' THEN 'removed' ELSE 'left' END,
      native_pending = false
    WHERE binding_id = ${bindingId} AND (state = 'joined' OR native_pending)
      AND user_id IN (SELECT user_id FROM matrix_identities WHERE matrix_id = ${event.state_key}) RETURNING binding_id`);
  if (changed.length)
    await query(
      sql`UPDATE workspace_group_bindings SET epoch = ${randomUUID()} WHERE id = ${bindingId}`
    );
}

/** Keep accepted transaction fingerprints stable as display-only aggregation schemas evolve. */
function transactionFingerprint(event: z.infer<typeof MatrixEventSchema>) {
  return {
    ...event,
    content: {
      ...event.content,
      "m.new_content": undefined,
      "org.zoen.edit_operation": undefined,
      "org.zoen.forwarded":
        event.content["org.zoen.forwarded"] === true ? true : undefined,
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
