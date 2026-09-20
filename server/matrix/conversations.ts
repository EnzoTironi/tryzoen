import { query, transaction as withDatabaseTransaction } from "@db/queries";
import { sql } from "drizzle-orm";
import { withTimeout, mapAsync } from "../operations/async";
import { z } from "zod";
import { createHash } from "node:crypto";

import { openNetworkBot } from "../workspaces/network";
import {
  requireWorkspaceAccess,
  WorkspaceAccessDenied,
  type WorkspaceActorSchema,
} from "../workspaces/access";
import {
  matrixConfiguration,
  matrixRequest,
  MatrixEventSchema,
  MatrixError,
} from "./client";
import { ensureMatrixBot, ensureMatrixIdentity } from "./identities";

export const MatrixConversationInput = z.object({
  id: z.uuid(),
});
export const MatrixConversationSend = z.object({
  ...MatrixConversationInput.shape,
  operationId: z.uuid(),
  text: z
    .string()
    .min(1)
    .refine((value) => value === value.trim(), "Expected trimmed text")
    .max(8000),
});
const conversationSchema = z.object({
  id: z.string(),
  workspaceId: z.string(),
  requesterId: z.string(),
  grantId: z.string(),
  roomId: z.string(),
  senderId: z.string(),
  botId: z.string(),
  username: z.string(),
  name: z.string(),
  description: z.string(),
  destWorkspaceId: z.string(),
  issuedBy: z.string(),
  networkKind: z.enum(["personal", "company"]),
});

/** The internal transport still checks the current source membership, network and destination grant. */
export const matrixConversationAuthority = async function (id: string) {
  const config = await matrixConfiguration();
  const rows =
    await query(sql`SELECT c.id, c.workspace_id AS "workspaceId", c.requester_id AS "requesterId",
    c.grant_id AS "grantId", c.room_id AS "roomId", c.sender_id AS "senderId", c.bot_id AS "botId",
    b.username, b.name, b.description, b.workspace_id AS "destWorkspaceId", g.issued_by AS "issuedBy", g.network_kind AS "networkKind"
    FROM matrix_agent_conversations c JOIN workspace_agent_grants g ON g.id = c.grant_id
    JOIN workspace_bots b ON b.id = g.bot_id
    WHERE c.id = ${id} AND c.closed_at IS NULL AND c.server_name = ${config.serverName}
      AND g.requester_user_id = c.requester_id AND g.source_workspace_id = c.workspace_id`);
  if (!rows[0]) throw new WorkspaceAccessDenied();
  const conversation = await conversationSchema.parseAsync(rows[0]);
  const destActor = {
    userId: conversation.issuedBy,
    workspaceId: conversation.destWorkspaceId,
    agentGrantId: conversation.grantId,
  };
  await requireWorkspaceAccess(destActor);
  const active = await query(
    sql`SELECT id FROM matrix_agent_conversations WHERE id = ${id} AND closed_at IS NULL FOR SHARE`
  );
  if (!active.length) throw new WorkspaceAccessDenied();
  return { ...conversation, destActor };
};

const userConversation = async function (
  actor: z.output<typeof WorkspaceActorSchema>,
  id: string
) {
  if (!actor.authSessionId) throw new WorkspaceAccessDenied();
  await requireWorkspaceAccess(actor);
  const conversation = await matrixConversationAuthority(id);
  if (
    conversation.requesterId !== actor.userId ||
    conversation.workspaceId !== actor.workspaceId
  )
    throw new WorkspaceAccessDenied();
  return conversation;
};

export const openMatrixConversation = async function (
  actor: z.output<typeof WorkspaceActorSchema>,
  username: string,
  asAgent = false
) {
  return await withTimeout(async () => {
    return await withDatabaseTransaction(async () => {
      const target = await openNetworkBot(actor, username, asAgent);
      const id = target.destActor.agentGrantId;
      await query(
        sql`SELECT pg_advisory_xact_lock(hashtextextended(${id}, 18))`
      );
      const existing = await query(
        sql`SELECT id FROM matrix_agent_conversations WHERE grant_id = ${id}`
      );
      if (existing.length) return await userConversation(actor, id);
      const config = await matrixConfiguration();
      const botId = await ensureMatrixBot(target.dest.id, target.dest.name);
      const senderId = target.source
        ? await ensureMatrixBot(target.source.id, target.source.name)
        : await ensureMatrixIdentity(actor);
      const alias = `_zoen_room_network_${id}`;
      const room = await z.object({ room_id: z.string() }).parseAsync(
        await Promise.try(async () =>
          matrixRequest(
            "POST",
            "createRoom",
            {
              room_alias_name: alias,
              name: target.dest.name,
              preset: "private_chat",
              visibility: "private",
              creation_content: { "m.federate": false },
              initial_state: [
                {
                  type: "m.room.history_visibility",
                  state_key: "",
                  content: { history_visibility: "joined" },
                },
              ],
              power_level_content_override: {
                users_default: 0,
                invite: 100,
                kick: 100,
                ban: 100,
                state_default: 100,
              },
            },
            botId
          )
        ).catch((error: unknown) => {
          if (error instanceof MatrixError)
            return error.reason === "conflict"
              ? matrixRequest(
                  "GET",
                  `directory/room/${encodeURIComponent(`#${alias}:${config.serverName}`)}`
                )
              : Promise.reject(error);
          throw error;
        })
      );
      const joined = await z
        .object({
          joined: z.record(z.string(), z.unknown()),
        })
        .parseAsync(
          await matrixRequest(
            "GET",
            `rooms/${encodeURIComponent(room.room_id)}/joined_members`,
            undefined,
            botId
          )
        );
      if (!(senderId in joined.joined)) {
        await matrixRequest(
          "POST",
          `rooms/${encodeURIComponent(room.room_id)}/invite`,
          { user_id: senderId },
          botId
        );
        await matrixRequest(
          "POST",
          `join/${encodeURIComponent(room.room_id)}`,
          {},
          senderId
        );
      }
      await requireWorkspaceAccess(actor);
      await requireWorkspaceAccess(target.destActor);
      await query(sql`INSERT INTO matrix_agent_conversations(id, workspace_id, requester_id, grant_id, room_id, server_name, sender_id, bot_id)
      VALUES (${id}, ${actor.workspaceId}, ${actor.userId}, ${id}, ${room.room_id}, ${config.serverName}, ${senderId}, ${botId})`);
      return await userConversation(actor, id);
    });
  }, 60000);
};

export const listMatrixConversations = async function (
  actor: z.output<typeof WorkspaceActorSchema>
) {
  return await withDatabaseTransaction(async () => {
    if (!actor.authSessionId) throw new WorkspaceAccessDenied();
    await requireWorkspaceAccess(actor);
    const rows = await query<{
      id: string;
    }>(sql`SELECT id FROM matrix_agent_conversations
      WHERE workspace_id = ${actor.workspaceId} AND requester_id = ${actor.userId} AND closed_at IS NULL ORDER BY created_at DESC LIMIT 40`);
    {
      const items = await mapAsync(
        rows,
        async ({ id }) => {
          try {
            const c = await userConversation(actor, id);
            return {
              id: c.id,
              username: c.username,
              name: c.name,
              network: c.networkKind,
            };
          } catch (error) {
            if (error instanceof WorkspaceAccessDenied) return null;
            throw error;
          }
        },
        1
      );
      return items.filter((item) => item !== null);
    }
  });
};

export const readMatrixConversation = async function (
  actor: z.output<typeof WorkspaceActorSchema>,
  id: string
) {
  return await withDatabaseTransaction(async () => {
    const c = await userConversation(actor, id);
    const result = await z
      .object({ chunk: z.array(MatrixEventSchema) })
      .parseAsync(
        await matrixRequest(
          "GET",
          `rooms/${encodeURIComponent(c.roomId)}/messages?dir=b&limit=50`,
          undefined,
          c.senderId
        )
      );
    await userConversation(actor, id);
    return {
      id: c.id,
      name: c.name,
      username: c.username,
      network: c.networkKind,
      messages: result.chunk
        .filter(
          (event) =>
            event.type === "m.room.message" &&
            event.content.msgtype === "m.text" &&
            (event.sender === c.senderId || event.sender === c.botId)
        )
        .toReversed()
        .map((event) => ({
          id: event.event_id,
          text: event.content.body ?? "",
          fromBot: event.sender === c.botId,
          at: event.origin_server_ts,
        })),
    };
  });
};

export const sendMatrixConversation = async function (
  actor: z.output<typeof WorkspaceActorSchema>,
  raw: z.output<typeof MatrixConversationSend>
) {
  const input = await MatrixConversationSend.parseAsync(raw);

  const hash = createHash("sha256").update(input.text).digest("hex");
  await withDatabaseTransaction(async () => {
    await userConversation(actor, input.id);
    await query(sql`INSERT INTO matrix_agent_sends(conversation_id, operation_id, request_hash)
      VALUES (${input.id}, ${input.operationId}, ${hash}) ON CONFLICT DO NOTHING`);
    const rows = await query<{
      request_hash: string;
    }>(
      sql`SELECT request_hash FROM matrix_agent_sends WHERE conversation_id = ${input.id} AND operation_id = ${input.operationId}`
    );
    if (rows[0]?.request_hash !== hash)
      throw new MatrixError({ reason: "conflict" });
    return undefined;
  });
  return await withDatabaseTransaction(async () => {
    const c = await userConversation(actor, input.id);
    // Synapse owns deduplication for this identity/room/transaction. Only its
    // authenticated appservice event creates the A2A task, never this UI request.
    const result = await z
      .object({ event_id: z.string() })
      .parseAsync(
        await matrixRequest(
          "PUT",
          `rooms/${encodeURIComponent(c.roomId)}/send/m.room.message/zoen_${input.operationId}`,
          { msgtype: "m.text", body: input.text },
          c.senderId
        )
      );
    await query(
      sql`UPDATE matrix_agent_sends SET event_id = ${result.event_id} WHERE conversation_id = ${input.id} AND operation_id = ${input.operationId}`
    );
    return result;
  });
};

export const closeMatrixConversation = async function (
  actor: z.output<typeof WorkspaceActorSchema>,
  id: string
) {
  await withDatabaseTransaction(async () => {
    await query(sql`SELECT pg_advisory_xact_lock(hashtextextended(${id}, 18))`);
    if (!actor.authSessionId) throw new WorkspaceAccessDenied();
    await requireWorkspaceAccess(actor);
    const closed = await query(sql`SELECT id FROM matrix_agent_conversations
          WHERE id = ${id} AND requester_id = ${actor.userId} AND workspace_id = ${actor.workspaceId} AND closed_at IS NOT NULL`);
    if (closed.length) return undefined;
    const c = await userConversation(actor, id);
    await query(
      sql`UPDATE workspace_agent_grants SET revoked_at = now() WHERE id = ${c.grantId}`
    );
    await query(
      sql`UPDATE matrix_agent_conversations SET closed_at = now() WHERE id = ${id} AND closed_at IS NULL`
    );
    await query(sql`UPDATE agent_protocol_tasks SET state = 'TASK_STATE_CANCELED', output = NULL, updated_at = now()
      WHERE grant_id = ${c.grantId} AND state IN ('TASK_STATE_SUBMITTED', 'TASK_STATE_WORKING', 'TASK_STATE_INPUT_REQUIRED')`);
    return undefined;
  });
};
