import { createHash } from "node:crypto";
import { z } from "zod";
import { sql } from "drizzle-orm";
import { query, transaction } from "@db/queries";
import {
  roomReactionsReadSchema,
  roomReactorsReadSchema,
  roomReactorsPageSchema,
  roomReactionWriteSchema,
} from "@zoen/companion-ui/rooms";
import type { WorkspaceActorSchema } from "../workspaces/access";
import { readRoomMembers } from "./members";
import { matrixConfiguration } from "./client";
import { readRoomMessage } from "./messages";
import { joinMatrixRoom, requireMatrixRoom } from "./rooms";
import { matrixRequest, MatrixEventSchema, MatrixError } from "./client";

const relationPage = z.object({
  chunk: z.array(MatrixEventSchema).max(100),
  next_batch: z.string().optional(),
});

async function reactionEvents(
  room: Awaited<ReturnType<typeof joinMatrixRoom>>,
  messageId: string,
  limit = 1
) {
  const events: z.infer<typeof MatrixEventSchema>[] = [];
  let cursor: string | undefined;
  for (let page = 0; page < limit; page++) {
    const result = relationPage.parse(
      await matrixRequest(
        "GET",
        `rooms/${encodeURIComponent(room.roomId)}/relations/${encodeURIComponent(messageId)}/m.annotation/m.reaction?limit=100${cursor ? `&from=${encodeURIComponent(cursor)}` : ""}`,
        undefined,
        room.matrixId,
        { version: "v1" }
      )
    );
    events.push(
      ...result.chunk.filter(
        (event) =>
          event.type === "m.reaction" &&
          event.content["m.relates_to"]?.event_id === messageId &&
          event.content["m.relates_to"].rel_type === "m.annotation"
      )
    );
    cursor = result.next_batch;
    if (!cursor) break;
  }
  return { events, complete: !cursor };
}

function summarizeReactions(
  messageId: string,
  viewer: string,
  result: Awaited<ReturnType<typeof reactionEvents>>
) {
  const counts = new Map<string, Set<string>>();
  let mine: string | null = null;
  let mineEventId: string | null = null;
  for (const event of result.events) {
    const emoji = event.content["m.relates_to"]?.key;
    if (!emoji || emoji.length > 32) continue;
    const senders = counts.get(emoji) ?? new Set<string>();
    senders.add(event.sender);
    counts.set(emoji, senders);
    if (event.sender === viewer && !mine) {
      mine = emoji;
      mineEventId = event.event_id;
    }
  }
  return {
    messageId,
    mine,
    mineEventId,
    complete: result.complete,
    reactions: [...counts].map(([emoji, senders]) => ({
      emoji,
      count: senders.size,
    })),
  };
}

/** Visible messages only. Bound both work and concurrency; Matrix is authoritative. */
export async function readMatrixReactions(
  actor: z.output<typeof WorkspaceActorSchema>,
  raw: z.output<typeof roomReactionsReadSchema>
) {
  const input = roomReactionsReadSchema.parse(raw);
  return transaction(async () => {
    const room = await joinMatrixRoom(actor, input.id);
    const ids = [...new Set(input.messageIds)];
    const result: ReturnType<typeof summarizeReactions>[] = [];
    for (let start = 0; start < ids.length; start += 3) {
      result.push(
        ...(await Promise.all(
          ids
            .slice(start, start + 3)
            .map(async (id) =>
              summarizeReactions(
                id,
                room.matrixId,
                await reactionEvents(room, id)
              )
            )
        ))
      );
    }
    await requireMatrixRoom(actor, input.id);
    return result;
  });
}

/** A change removes only this sender's native reactions; retries keep transaction IDs. */
export async function setMatrixReaction(
  actor: z.output<typeof WorkspaceActorSchema>,
  raw: z.output<typeof roomReactionWriteSchema>
) {
  const input = roomReactionWriteSchema.parse(raw);
  return transaction(async () => {
    const room = await joinMatrixRoom(actor, input.id);
    await query(
      sql`SELECT pg_advisory_xact_lock(hashtextextended(${`${room.roomId}:${room.matrixId}:${input.messageId}`}, 17))`
    );
    const base = `rooms/${encodeURIComponent(room.roomId)}`;
    await readRoomMessage(room, input.messageId);
    const current = await reactionEvents(room, input.messageId, 10);
    if (!current.complete) throw new MatrixError({ reason: "conflict" });
    const own = current.events.filter(
      (event) => event.sender === room.matrixId
    );
    await requireMatrixRoom(actor, input.id);
    for (const event of own.filter(
      (candidate) => candidate.event_id === input.previousEventId
    )) {
      if (event.content["m.relates_to"]?.key === input.emoji) continue;
      const txn = createHash("sha256")
        .update(`${input.operationId}:${event.event_id}`)
        .digest("hex");
      await matrixRequest(
        "PUT",
        `${base}/redact/${encodeURIComponent(event.event_id)}/${txn}`,
        {},
        room.matrixId
      );
    }
    if (
      input.emoji &&
      !own.some((event) => event.content["m.relates_to"]?.key === input.emoji)
    ) {
      await matrixRequest(
        "PUT",
        `${base}/send/m.reaction/${input.operationId}`,
        {
          "m.relates_to": {
            rel_type: "m.annotation",
            event_id: input.messageId,
            key: input.emoji,
          },
        },
        room.matrixId
      );
    }
    return summarizeReactions(
      input.messageId,
      room.matrixId,
      await reactionEvents(room, input.messageId)
    );
  });
}

/** Resolve one authorized native relation page on demand, not for every timeline row. */
export async function readMatrixReactors(
  actor: z.infer<typeof WorkspaceActorSchema>,
  raw: z.infer<typeof roomReactorsReadSchema>
) {
  const input = roomReactorsReadSchema.parse(raw);
  return transaction(async () => {
    const room = await joinMatrixRoom(actor, input.id);
    await readRoomMessage(room, input.messageId);
    const page = relationPage.parse(
      await matrixRequest(
        "GET",
        `rooms/${encodeURIComponent(room.roomId)}/relations/${encodeURIComponent(input.messageId)}/m.annotation/m.reaction?limit=100${input.cursor ? `&from=${encodeURIComponent(input.cursor)}` : ""}`,
        undefined,
        room.matrixId,
        { version: "v1" }
      )
    );
    const people = await readRoomMembers(actor, input.id, room.kind);
    const { botId } = await matrixConfiguration();
    const entries = new Map<
      string,
      z.infer<typeof roomReactorsPageSchema>["items"][number]
    >();
    for (const event of page.chunk) {
      const relation = event.content["m.relates_to"];
      if (
        event.type !== "m.reaction" ||
        event.unsigned?.redacted_because ||
        relation?.rel_type !== "m.annotation" ||
        relation.event_id !== input.messageId ||
        !relation.key ||
        relation.key.length > 32
      )
        continue;
      const person = people.find(
        (candidate) => candidate.id === event.sender
      ) ?? {
        id: event.sender,
        name: event.sender === botId ? "Zoen" : "Participante",
        bot: event.sender === botId,
        mine: event.sender === room.matrixId,
      };
      entries.set(JSON.stringify([relation.key, person.id]), {
        eventId: event.event_id,
        emoji: relation.key,
        person,
      });
    }
    await requireMatrixRoom(actor, input.id);
    return roomReactorsPageSchema.parse({
      items: [...entries.values()],
      nextCursor: page.next_batch ?? null,
    });
  });
}
