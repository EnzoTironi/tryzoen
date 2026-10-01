import { query, transaction } from "@db/queries";
import { sql } from "drizzle-orm";
import { z } from "zod";
import {
  directListSchema,
  roomSchema,
  roomForwardSchema,
  roomForwardDestinationsSchema,
  roomForwardResultSchema,
} from "@zoen/companion-ui/rooms";
import {
  type WorkspaceActorSchema,
  WorkspaceAccessDenied,
} from "../workspaces/access";
import { matrixConfiguration, matrixRequest, MatrixError } from "./client";
import { joinMatrixRoom, requireMatrixRoom } from "./rooms";
import { authorizedInboxRooms } from "./inbox";
import {
  currentReplacement,
  projectMatrixMessage,
  readMatrixText,
  readRoomMessage,
} from "./messages";
import { projectMatrixActivity } from "./activity";
import { lockMatrixAdmission } from "./authority";

/** Only existing, authorized destinations in this workspace; no private previews. */
export async function listForwardDestinations(
  actor: z.infer<typeof WorkspaceActorSchema>,
  raw: z.infer<typeof roomForwardDestinationsSchema>
) {
  const input = roomForwardDestinationsSchema.parse(raw);
  return transaction(async () => {
    await requireMatrixRoom(actor, input.id);
    const authorized = await authorizedInboxRooms(actor);
    const search = `%${input.query.replace(/^@/u, "").replace(/[\\%_]/gu, "\\$&")}%`;
    const rows = z.array(roomSchema).parse(
      await query(sql`
      SELECT * FROM (${authorized}) rooms
      WHERE id <> ${input.id} AND (${!input.before} OR id < ${input.before ?? ""})
        AND (label ILIKE ${search} OR username ILIKE ${search})
      ORDER BY id DESC LIMIT 21`)
    );
    return directListSchema.parse({
      items: rows.slice(0, 20),
      nextCursor: rows.length > 20 ? rows[19]?.id : null,
    });
  });
}

/** An independent copy of the reviewed revision, never a grant to its source. */
export async function forwardMatrixMessage(
  actor: z.infer<typeof WorkspaceActorSchema>,
  raw: z.infer<typeof roomForwardSchema>
) {
  const input = roomForwardSchema.parse(raw);
  if (input.id === input.destinationId) throw new WorkspaceAccessDenied();
  const config = await matrixConfiguration();
  const outcome = await transaction(async () => {
    await lockMatrixAdmission(
      [actor.workspaceId],
      [input.id, input.destinationId]
    );
    const source = await joinMatrixRoom(actor, input.id);
    const destination = await joinMatrixRoom(actor, input.destinationId);
    await query(
      sql`SELECT pg_advisory_xact_lock(hashtextextended(${`${source.roomId}:${input.messageId}`}, 10))`
    );
    const original = await readRoomMessage(source, input.messageId);
    if (original.room_id !== source.roomId || original.state_key !== undefined)
      throw new WorkspaceAccessDenied();
    if (
      (currentReplacement(original)?.event_id ?? original.event_id) !==
      input.expectedRevision
    )
      return {
        result: roomForwardResultSchema.parse({
          status: "changed",
          message: projectMatrixMessage(
            original,
            [],
            source.matrixId,
            config.botId
          ),
        }),
        event: undefined,
      };
    const content = forwardedContent(original);
    await requireMatrixRoom(actor, input.id);
    await requireMatrixRoom(actor, input.destinationId);
    const receipt = z
      .object({ event_id: z.string() })
      .parse(
        await matrixRequest(
          "PUT",
          `rooms/${encodeURIComponent(destination.roomId)}/send/m.room.message/zoen_forward_${input.operationId}`,
          content,
          destination.matrixId
        )
      );
    const event = await readRoomMessage(destination, receipt.event_id);
    if (
      event.room_id !== destination.roomId ||
      event.sender !== destination.matrixId
    )
      throw new WorkspaceAccessDenied();
    // Native retries replay the first payload, even if a caller reuses its ID incorrectly.
    if (
      !event.content["org.zoen.forwarded"] ||
      event.content["m.relates_to"] ||
      JSON.stringify(forwardedContent(event)) !== JSON.stringify(content)
    )
      throw new MatrixError({ reason: "conflict" });
    return {
      result: roomForwardResultSchema.parse({
        status: "sent",
        messageId: event.event_id,
      }),
      event,
    };
  });
  if (outcome.event)
    await projectMatrixActivity(config.serverName, outcome.event);
  return outcome.result;
}

function forwardedContent(event: Awaited<ReturnType<typeof readRoomMessage>>) {
  const content =
    currentReplacement(event)?.content["m.new_content"] ?? event.content;
  const text = readMatrixText(content).text;
  if (content.msgtype === "m.text")
    return {
      msgtype: "m.text",
      body: z.string().min(1).max(8000).parse(text),
      "org.zoen.forwarded": true,
    };
  const media = z
    .object({
      msgtype: z.enum(["m.image", "m.video", "m.audio", "m.file"]),
      body: z.string().min(1).max(8000),
      filename: z.string().max(255).optional(),
      url: z.string().regex(/^mxc:\/\/[^/]+\/[A-Za-z0-9_-]+$/u),
      info: z
        .object({
          mimetype: z.string().max(255).optional(),
          size: z.number().nonnegative().optional(),
        })
        .optional(),
    })
    .parse({ ...event.content, body: text });
  return { ...media, "org.zoen.forwarded": true };
}
