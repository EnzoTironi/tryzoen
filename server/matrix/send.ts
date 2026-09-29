import { z } from "zod";
import { transaction as withDatabaseTransaction } from "@db/queries";
import type {
  roomSendSchema,
  roomSendResultSchema,
} from "@zoen/companion-ui/rooms";
import {
  requireWorkspaceAccess,
  WorkspaceAccessDenied,
  type WorkspaceActorSchema,
} from "../workspaces/access";
import { joinMatrixRoom, requireMatrixRoom } from "./rooms";
import { matrixConfiguration, matrixRequest } from "./client";
import { projectMatrixActivity } from "./activity";
import { uploadMatrixMedia } from "./media/upload";
import { readMatrixText, readRoomMessage } from "./messages";
import { setThreadSubscription } from "./thread-subscriptions";

export const sendMatrixMessage = async function (
  actor: z.output<typeof WorkspaceActorSchema>,
  input: z.output<typeof roomSendSchema>
): Promise<z.infer<typeof roomSendResultSchema>> {
  const published = await withDatabaseTransaction(async () => {
    const room = await joinMatrixRoom(actor, input.id);
    await requireWorkspaceAccess(actor);
    if (input.rootId) {
      const parent = await readRoomMessage(room, input.rootId, true);
      if (parent.content["m.relates_to"]?.rel_type === "m.thread")
        throw new WorkspaceAccessDenied();
    }
    const reply = input.replyTo
      ? await readRoomMessage(room, input.replyTo)
      : undefined;
    const replyThread = reply?.content["m.relates_to"];
    if (reply && reply.event_id !== input.rootId) {
      const threadId =
        replyThread?.rel_type === "m.thread" ? replyThread.event_id : undefined;
      if (threadId !== input.rootId) throw new WorkspaceAccessDenied();
    }
    const replyTarget = reply?.event_id ?? input.rootId;
    const relation = {
      ...(input.rootId
        ? {
            rel_type: "m.thread",
            event_id: input.rootId,
            is_falling_back: !reply,
          }
        : {}),
      ...(replyTarget ? { "m.in_reply_to": { event_id: replyTarget } } : {}),
    };
    const body = reply
      ? `> <${reply.sender}> ${readMatrixText(reply.content).text.slice(0, 4000).replaceAll("\n", "\n> ")}\n\n${input.text}`
      : input.text;
    const sent = [];
    if (input.text)
      sent.push(
        await matrixRequest(
          "PUT",
          `rooms/${encodeURIComponent(room.roomId)}/send/m.room.message/${input.operationId}`,
          {
            msgtype: "m.text",
            "org.zoen.transaction_id": input.operationId,
            body,
            ...(input.rootId || reply ? { "m.relates_to": relation } : {}),
          },
          room.matrixId
        )
      );
    for (const [index, file] of (input.files ?? []).entries()) {
      await requireMatrixRoom(actor, input.id);
      const media = await uploadMatrixMedia(file, room.matrixId);
      const category = file.mediaType.split("/")[0] ?? "application";
      sent.push(
        await matrixRequest(
          "PUT",
          `rooms/${encodeURIComponent(room.roomId)}/send/m.room.message/${input.operationId}.file.${index}`,
          {
            ...media,
            "org.zoen.transaction_id": `${input.operationId}.file.${index}`,
            msgtype: ["image", "audio", "video"].includes(category)
              ? `m.${category}`
              : "m.file",
            body: file.filename ?? "Attachment",
            filename: file.filename ?? "Attachment",
            ...(input.rootId || reply ? { "m.relates_to": relation } : {}),
          },
          room.matrixId
        )
      );
    }
    return { room, sent };
  });
  // Commit membership mutations before taking activity locks also used by callbacks.
  const receipt = await projectPublishedMessages(
    published.room,
    published.sent
  );
  if (!input.rootId) return receipt;
  const subscription = await setThreadSubscription(
    actor,
    {
      id: input.id,
      rootId: input.rootId,
      following: true,
    },
    receipt.event_id
  );
  return { ...receipt, subscription };
};

async function projectPublishedMessages(
  room: Awaited<ReturnType<typeof joinMatrixRoom>>,
  sent: unknown[]
) {
  const receipt = z.object({ event_id: z.string() });
  const published = z.tuple([receipt]).rest(receipt).parse(sent);
  const config = await matrixConfiguration();
  for (const item of published) {
    const event = await readRoomMessage(room, item.event_id, true);
    if (event.room_id !== room.roomId || event.sender !== room.matrixId)
      throw new WorkspaceAccessDenied();
    await projectMatrixActivity(config.serverName, event);
  }
  return published[0];
}
