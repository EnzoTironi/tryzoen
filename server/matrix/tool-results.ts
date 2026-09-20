import { createHash } from "node:crypto";
import { sql } from "drizzle-orm";
import type { ChannelEvents } from "eve/channels";
import { z } from "zod";
import { query } from "@db/queries";
import { sendMessageToolResultSchema } from "@shared/chat/message-delivery";
import {
  reactToMessageToolResultSchema,
  reactionTextFor,
} from "@shared/chat/reaction";
import { matrixDeliveryActor } from "./authority";
import { matrixRequest, MatrixError } from "./client";
import { WorkspaceAccessDenied } from "../workspaces/access";

const messageResult = sendMessageToolResultSchema.extend({
  callId: z.string().min(1),
});
const reactionResult = reactToMessageToolResultSchema.extend({
  callId: z.string().min(1),
});

/** Deliver native outputs through the current room, without completing a turn's authority. */
export async function publishMatrixToolResult(
  event: Parameters<NonNullable<ChannelEvents<unknown>["action.result"]>>[0],
  context: Parameters<NonNullable<ChannelEvents<unknown>["action.result"]>>[2]
): Promise<"message" | "reaction" | false> {
  if (event.status !== "completed") return false;
  const message = messageResult.safeParse(event.result);
  const reaction = reactionResult.safeParse(event.result);
  if (!message.success && !reaction.success) return false;

  const principal = context.session.auth.current;
  const eventId = z.string().min(1).parse(principal?.attributes.matrixEventId);
  const actor = await matrixDeliveryActor(eventId);
  if (
    principal?.authenticator !== "matrix" ||
    actor.userId !== principal.principalId ||
    actor.workspaceId !== principal.attributes.workspaceId
  )
    throw new WorkspaceAccessDenied();
  const [room] = await query<{ roomId: string }>(sql`
      SELECT b.conversation_id AS "roomId" FROM matrix_deliveries d
      JOIN workspace_group_bindings b ON b.id = d.binding_id
      WHERE d.event_id = ${eventId} AND (d.session_id IS NULL OR d.session_id = ${context.session.id})`);
  if (!room) throw new WorkspaceAccessDenied();

  if (message.success) {
    const output = message.data.output;
    if (output.replyTo && output.replyTo.kind !== "current")
      throw new MatrixError({ reason: "forbidden" });
    const body =
      output.kind === "link"
        ? output.url
        : [
            output.text,
            ...(output.attachments ?? []).map((attachment) => attachment.url),
          ]
            .filter(Boolean)
            .join("\n");
    await matrixDeliveryActor(eventId);
    await matrixRequest(
      "PUT",
      `rooms/${encodeURIComponent(room.roomId)}/send/m.room.message/${transactionId(eventId, context.session.id, message.data.callId)}`,
      {
        msgtype: "m.text",
        body,
        ...(output.replyTo
          ? { "m.relates_to": { "m.in_reply_to": { event_id: eventId } } }
          : {}),
      }
    );
  } else if (reaction.success) {
    if (reaction.data.output.operation !== "add")
      throw new MatrixError({ reason: "forbidden" });
    await matrixDeliveryActor(eventId);
    await matrixRequest(
      "PUT",
      `rooms/${encodeURIComponent(room.roomId)}/send/m.reaction/${transactionId(eventId, context.session.id, reaction.data.callId)}`,
      {
        "m.relates_to": {
          rel_type: "m.annotation",
          event_id: eventId,
          key: reactionTextFor(reaction.data.output.type),
        },
      }
    );
  }
  return message.success ? "message" : "reaction";
}

function transactionId(eventId: string, sessionId: string, callId: string) {
  return `zoen_tool_${createHash("sha256")
    .update(JSON.stringify([eventId, sessionId, callId]))
    .digest("hex")}`;
}
