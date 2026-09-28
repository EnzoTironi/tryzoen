import type { z } from "zod";
import {
  addReactionToMessageOutputSchema,
  reactionTextFor,
} from "@zoen/companion-ui/messages";
import type { roomMemberSchema } from "@zoen/companion-ui/rooms";
import type { MatrixEventSchema } from "./client";

export function projectMatrixMessage(
  event: z.infer<typeof MatrixEventSchema>,
  events: z.infer<typeof MatrixEventSchema>[],
  people: z.infer<typeof roomMemberSchema>[],
  viewerId: string,
  botId: string
) {
  const relation = event.content["m.relates_to"];
  return {
    id: event.event_id,
    text: event.content.body ?? "Mensagem removida",
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
    reactions: addReactionToMessageOutputSchema.shape.type.options
      .map((type) => ({
        type,
        count: new Set(
          events
            .filter((candidate) => {
              const reaction = candidate.content["m.relates_to"];
              return (
                candidate.type === "m.reaction" &&
                reaction?.rel_type === "m.annotation" &&
                reaction.event_id === event.event_id &&
                reaction.key === reactionTextFor(type)
              );
            })
            .map((candidate) => candidate.sender)
        ).size,
      }))
      .filter((reaction) => reaction.count > 0),
  };
}
