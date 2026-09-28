import type { MessageStreamEvent } from "eve/client";
import type { EveMessage, EveMessagePart } from "eve/react";
import { reactionTextFor, reactToMessageToolResultSchema } from "./reaction";
import { sendMessageToolResultSchema } from "./message-delivery";

/** The tool receipt is the delivered message. Model completion markers are internal. */
export function visibleConversationMessages(
  messages: readonly EveMessage[],
  events: readonly MessageStreamEvent[]
): EveMessage[] {
  const deliveries = sentMessages(events);
  return messages.flatMap((message) => {
    if (message.role === "user") return [message];
    const sent = deliveries.get(message.id) ?? [];
    const parts = message.parts.filter((part) => {
      if (part.type === "text")
        return (
          sent.length === 0 &&
          !/^DELIVERY_COMPLETE[.!]?$/iu.test(part.text.trim())
        );
      if (part.type === "dynamic-tool")
        return Boolean(part.toolMetadata?.eve?.inputRequest);
      return part.type === "authorization" || part.type === "file";
    });
    const visible: EveMessage[] = sent.map((delivery) =>
      Object.assign({}, message, { id: delivery.id, parts: delivery.parts })
    );
    if (parts.length > 0) visible.push({ ...message, parts });
    return visible;
  });
}

export function sentMessages(events: readonly MessageStreamEvent[]) {
  const delivered = new Set<string>();
  const messagesByTurn = new Map<
    string,
    { id: string; parts: EveMessagePart[]; timestamp: string }[]
  >();

  for (const event of events) {
    if (event.type !== "action.result") continue;
    const delivery = completedSendMessageOutput(event);
    const reaction = completedReactionOutput(event);
    const completed = delivery ?? reaction;
    if (!completed) continue;
    const deliveryId = delivery?.output.deliveryId ?? completed.callId;
    if (delivery?.output.deliveryId) {
      if (delivered.has(delivery.output.deliveryId)) continue;
      delivered.add(delivery.output.deliveryId);
    }

    const turnMessageId = `${event.data.turnId}:assistant`;
    const parts: EveMessagePart[] = [];
    if (reaction) {
      parts.push({
        state: "done",
        stepIndex: event.data.stepIndex,
        text: reactionTextFor(reaction.output.type),
        type: "text",
      });
    } else if (delivery) {
      const { output } = delivery;
      // Delivered text is plain and reaches the user verbatim. The chat view
      // renders text parts as Markdown, so keep every line break as a hard break.
      const text =
        output.kind === "link"
          ? output.url
          : output.text?.replaceAll("\n", "  \n");
      if (text) {
        parts.push({
          state: "done",
          stepIndex: event.data.stepIndex,
          text,
          type: "text",
        });
      }
      const attachments = output.kind === "message" ? output.attachments : [];
      for (const attachment of attachments ?? []) {
        parts.push({
          filename: attachment.name,
          mediaType: attachment.mimeType ?? defaultMediaType[attachment.kind],
          stepIndex: event.data.stepIndex,
          type: "file",
          url: attachment.url,
        });
      }
    }
    const messages = messagesByTurn.get(turnMessageId) ?? [];
    messages.push({
      id: `${turnMessageId}:${deliveryId}`,
      parts,
      timestamp: event.meta.at,
    });
    messagesByTurn.set(turnMessageId, messages);
  }

  return messagesByTurn;
}

function completedReactionOutput(event: MessageStreamEvent) {
  if (event.type !== "action.result" || event.data.status !== "completed") {
    return undefined;
  }

  const result = reactToMessageToolResultSchema.safeParse(event.data.result);
  return result.success && result.data.output.operation === "add"
    ? { callId: event.data.result.callId, output: result.data.output }
    : undefined;
}

function completedSendMessageOutput(event: MessageStreamEvent) {
  if (event.type !== "action.result" || event.data.status !== "completed") {
    return undefined;
  }

  const result = sendMessageToolResultSchema.safeParse(event.data.result);
  return result.success
    ? { callId: event.data.result.callId, output: result.data.output }
    : undefined;
}

const defaultMediaType = {
  audio: "audio/*",
  file: "application/octet-stream",
  image: "image/*",
  video: "video/*",
} as const;
