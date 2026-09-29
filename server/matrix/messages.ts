import type { z } from "zod";
import type { roomMemberSchema } from "@zoen/companion-ui/rooms";
import { MatrixEventSchema, matrixRequest } from "./client";
import type { joinMatrixRoom } from "./rooms";
import { WorkspaceAccessDenied } from "../workspaces/access";

/** Fetch only a real message visible to the already-authorized room member. */
export async function readRoomMessage(
  room: Awaited<ReturnType<typeof joinMatrixRoom>>,
  id: string,
  allowRedacted = false
) {
  const message = MatrixEventSchema.parse(
    await matrixRequest(
      "GET",
      `rooms/${encodeURIComponent(room.roomId)}/event/${encodeURIComponent(id)}`,
      undefined,
      room.matrixId
    )
  );
  if (
    message.event_id !== id ||
    message.type !== "m.room.message" ||
    (!allowRedacted && !!message.unsigned?.redacted_because) ||
    (!message.content.body &&
      !(allowRedacted && message.unsigned?.redacted_because)) ||
    message.content["m.relates_to"]?.rel_type === "m.replace"
  )
    throw new WorkspaceAccessDenied();
  return message;
}

export function readMatrixText(
  content: z.infer<typeof MatrixEventSchema>["content"]
) {
  const body = content.body ?? "Mensagem removida";
  const replyId = content["m.relates_to"]?.["m.in_reply_to"]?.event_id;
  const quote = replyId
    ? /^> <([^>]+)> ([\s\S]*?)\n\n([\s\S]*)$/u.exec(body)
    : null;
  return {
    text: quote?.[3] ?? body,
    reply:
      quote?.[1] && quote[2] !== undefined && replyId
        ? {
            id: replyId,
            sender: quote[1],
            text: quote[2].replaceAll("\n> ", "\n"),
          }
        : null,
  };
}

export function projectMatrixMessage(
  event: z.infer<typeof MatrixEventSchema>,
  people: z.infer<typeof roomMemberSchema>[],
  viewerId: string,
  botId: string
) {
  const originalReply = readMatrixText(event.content).reply;
  const replacement = currentReplacement(event);
  const relation = event.content["m.relates_to"];
  const redacted = !!event.unsigned?.redacted_because;
  const { text } = readMatrixText(
    redacted ? {} : (replacement?.content["m.new_content"] ?? event.content)
  );
  const reply = redacted ? null : originalReply;
  return {
    ...(redacted ? { redacted: true } : {}),
    ...(!redacted && event.content["org.zoen.forwarded"]
      ? { forwarded: true }
      : {}),
    ...(replacement
      ? { editId: replacement.event_id, editedAt: replacement.origin_server_ts }
      : {}),
    ...(!redacted &&
    event.content.url &&
    /^m\.(file|image|video|audio)$/u.test(event.content.msgtype ?? "")
      ? {
          media: {
            filename: event.content.filename ?? text,
            mediaType:
              event.content.info?.mimetype ?? "application/octet-stream",
            size: event.content.info?.size,
          },
        }
      : {}),
    senderId: event.sender,
    reply: reply
      ? {
          ...reply,
          sender:
            people.find((person) => person.id === reply.sender)?.name ??
            reply.sender,
        }
      : null,
    id: event.event_id,
    text,
    sender:
      event.sender === botId
        ? "Zoen"
        : (people.find((person) => person.id === event.sender)?.name ??
          event.sender),
    mine: event.sender === viewerId,
    bot: event.sender === botId,
    timestamp: event.origin_server_ts ?? 0,
    rootId:
      relation?.rel_type === "m.thread" ? (relation.event_id ?? null) : null,
    replies: event.unsigned?.["m.relations"]?.["m.thread"]?.count ?? 0,
  };
}

/** Use only the homeserver's latest valid bundle; never change the original identity/relations. */
export function currentReplacement(event: z.infer<typeof MatrixEventSchema>) {
  const edit = event.unsigned?.["m.relations"]?.["m.replace"];
  if (
    !edit ||
    event.unsigned?.redacted_because ||
    edit.unsigned?.redacted_because ||
    event.state_key !== undefined ||
    edit.state_key !== undefined ||
    edit.sender !== event.sender ||
    edit.type !== event.type ||
    (edit.room_id && edit.room_id !== event.room_id) ||
    event.content["m.relates_to"]?.rel_type === "m.replace" ||
    edit.content["m.relates_to"]?.rel_type !== "m.replace" ||
    edit.content["m.relates_to"].event_id !== event.event_id ||
    event.content.msgtype !== "m.text" ||
    edit.content["m.new_content"]?.msgtype !== "m.text" ||
    typeof edit.content["m.new_content"].body !== "string"
  )
    return undefined;
  return edit;
}
