import { query, transaction } from "@db/queries";
import { sql } from "drizzle-orm";
import { z } from "zod";
import { roomEditSchema, roomEditResultSchema } from "@zoen/companion-ui/rooms";
import {
  WorkspaceAccessDenied,
  type WorkspaceActorSchema,
} from "../workspaces/access";
import {
  MatrixEventSchema,
  matrixConfiguration,
  matrixRequest,
} from "./client";
import { joinMatrixRoom, requireMatrixRoom } from "./rooms";
import {
  currentReplacement,
  projectMatrixMessage,
  readRoomMessage,
} from "./messages";
import { projectMatrixActivity } from "./activity";
import { resolveMatrixMentions } from "./mentions";

/** App writers compare revisions under one message lock; external Matrix writers have no CAS. */
export async function editMatrixMessage(
  actor: z.infer<typeof WorkspaceActorSchema>,
  raw: z.infer<typeof roomEditSchema>
) {
  const input = roomEditSchema.parse(raw);
  const config = await matrixConfiguration();
  const outcome = await transaction(async () => {
    const room = await joinMatrixRoom(actor, input.id);
    await query(
      sql`SELECT pg_advisory_xact_lock(hashtextextended(${`${room.roomId}:${input.messageId}`}, 10))`
    );
    const original = await readRoomMessage(room, input.messageId);
    if (
      original.sender !== room.matrixId ||
      original.room_id !== room.roomId ||
      original.content.msgtype !== "m.text" ||
      original.state_key !== undefined
    )
      throw new WorkspaceAccessDenied();
    const latest = currentReplacement(original);
    const project = (event: z.infer<typeof MatrixEventSchema>) =>
      projectMatrixMessage(event, [], room.matrixId, config.botId);
    if (
      latest?.content["org.zoen.edit_operation"] === input.operationId &&
      latest.content["m.new_content"]?.body === input.text
    )
      return {
        result: roomEditResultSchema.parse({
          status: "saved",
          message: project(original),
        }),
        edit: undefined,
      };
    if ((latest?.event_id ?? original.event_id) !== input.expectedRevision)
      return {
        result: roomEditResultSchema.parse({
          status: "conflict",
          message: project(original),
        }),
        edit: undefined,
      };
    await requireMatrixRoom(actor, input.id);
    const edit = await publishReplacement(
      actor,
      room,
      input,
      latest?.content["m.new_content"] ?? original.content
    );
    const current = await readRoomMessage(room, input.messageId, true);
    await requireMatrixRoom(actor, input.id);
    return {
      result: roomEditResultSchema.parse({
        status: edit ? "saved" : "conflict",
        message: project(current),
      }),
      edit,
    };
  });
  // Release membership locks before touching the activity index, just as ordinary sends do.
  if (outcome.edit)
    await projectMatrixActivity(config.serverName, outcome.edit);
  return outcome.result;
}

async function publishReplacement(
  actor: z.infer<typeof WorkspaceActorSchema>,
  room: Awaited<ReturnType<typeof joinMatrixRoom>>,
  input: z.infer<typeof roomEditSchema>,
  previous: z.infer<typeof MatrixEventSchema>["content"]
) {
  const mentions = await resolveMatrixMentions(actor, room, input.text);
  const existing = new Set(previous["m.mentions"]?.user_ids ?? []);
  const receipt = z.object({ event_id: z.string() }).parse(
    await matrixRequest(
      "PUT",
      `rooms/${encodeURIComponent(room.roomId)}/send/m.room.message/${input.operationId}`,
      {
        msgtype: "m.text",
        body: `* ${input.text}`,
        "m.mentions": {
          user_ids: mentions.user_ids.filter((id) => !existing.has(id)),
        },
        "m.new_content": {
          msgtype: "m.text",
          body: input.text,
          "m.mentions": mentions,
        },
        "m.relates_to": { rel_type: "m.replace", event_id: input.messageId },
        "org.zoen.edit_operation": input.operationId,
      },
      room.matrixId
    )
  );
  const edit = MatrixEventSchema.parse(
    await matrixRequest(
      "GET",
      `rooms/${encodeURIComponent(room.roomId)}/event/${encodeURIComponent(receipt.event_id)}`,
      undefined,
      room.matrixId
    )
  );
  if (
    edit.event_id !== receipt.event_id ||
    edit.room_id !== room.roomId ||
    edit.sender !== room.matrixId
  )
    throw new WorkspaceAccessDenied();
  // Native transaction IDs replay their first payload; never report a different intent as saved.
  if (
    edit.type !== "m.room.message" ||
    edit.unsigned?.redacted_because ||
    edit.content["m.relates_to"]?.rel_type !== "m.replace" ||
    edit.content["m.relates_to"].event_id !== input.messageId ||
    edit.content["m.new_content"]?.msgtype !== "m.text" ||
    edit.content["m.new_content"].body !== input.text ||
    edit.content["org.zoen.edit_operation"] !== input.operationId
  )
    return undefined;
  return edit;
}
