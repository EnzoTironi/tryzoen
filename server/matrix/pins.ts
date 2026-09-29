import { createHash } from "node:crypto";
import { sql } from "drizzle-orm";
import { z } from "zod";
import { query, transaction } from "@db/queries";
import {
  roomPinsReadSchema,
  roomPinsSchema,
  roomPinWriteSchema,
} from "@zoen/companion-ui/rooms";
import {
  requireWorkspaceAccess,
  WorkspaceAccessDenied,
  type WorkspaceActorSchema,
} from "../workspaces/access";
import { joinMatrixRoom, requireMatrixRoom } from "./rooms";
import { MatrixError, matrixConfiguration, matrixRequest } from "./client";
import { readRoomMembers } from "./members";
import { readRoomMessage, projectMatrixMessage } from "./messages";

async function nativePins(room: Awaited<ReturnType<typeof joinMatrixRoom>>) {
  try {
    return z
      .object({ pinned: roomPinsSchema.shape.messageIds })
      .parse(
        await matrixRequest(
          "GET",
          `rooms/${encodeURIComponent(room.roomId)}/state/m.room.pinned_events`,
          undefined,
          room.matrixId,
          { maxResponseBytes: 32768 }
        )
      ).pinned;
  } catch (error) {
    if (error instanceof MatrixError && error.reason === "not-found") return [];
    throw error;
  }
}

async function pinAuthority(
  actor: z.infer<typeof WorkspaceActorSchema>,
  room: Awaited<ReturnType<typeof joinMatrixRoom>>
) {
  const access = await requireWorkspaceAccess(actor);
  if (room.kind === "group") return access.role !== "member";
  // DMs retain the homeserver's native power-level policy, including room-v12 creators.
  const base = `rooms/${encodeURIComponent(room.roomId)}/state/`;
  const levels = z
    .object({
      users: z.record(z.string(), z.number()).default({}),
      users_default: z.number().default(0),
      events: z.record(z.string(), z.number()).default({}),
      state_default: z.number().default(50),
    })
    .parse(
      await matrixRequest(
        "GET",
        base + "m.room.power_levels",
        undefined,
        room.matrixId
      )
    );
  if (
    (levels.users[room.matrixId] ?? levels.users_default) >=
    (levels.events["m.room.pinned_events"] ?? levels.state_default)
  )
    return true;
  const states = z
    .array(
      z.object({
        type: z.string(),
        sender: z.string(),
        content: z.object({
          additional_creators: z.array(z.string()).optional(),
          room_version: z.string().optional(),
        }),
      })
    )
    .max(100)
    .parse(
      await matrixRequest(
        "GET",
        `rooms/${encodeURIComponent(room.roomId)}/state`,
        undefined,
        room.matrixId,
        { maxResponseBytes: 262144 }
      )
    );
  const creation = states.find((event) => event.type === "m.room.create");
  return (
    Number(creation?.content.room_version) >= 12 &&
    (creation?.sender === room.matrixId ||
      !!creation?.content.additional_creators?.includes(room.matrixId))
  );
}

/** Pins are shared native room state. Content is fetched only when the list is opened. */
export async function readMatrixPins(
  actor: z.infer<typeof WorkspaceActorSchema>,
  raw: z.infer<typeof roomPinsReadSchema>
) {
  const input = roomPinsReadSchema.parse(raw);
  return transaction(async () => {
    const room = await joinMatrixRoom(actor, input.id);
    const messageIds = await nativePins(room);
    const mayManage = await pinAuthority(actor, room);
    const messages: z.infer<typeof roomPinsSchema>["messages"] = [];
    if (input.includeMessages && messageIds.length) {
      const people = await readRoomMembers(actor, input.id, room.kind);
      const { botId } = await matrixConfiguration();
      for (let start = 0; start < messageIds.length; start += 4) {
        const page = await Promise.all(
          messageIds.slice(start, start + 4).map(async (id) => {
            try {
              return projectMatrixMessage(
                await readRoomMessage(room, id, true),
                people,
                room.matrixId,
                botId
              );
            } catch (error) {
              if (error instanceof MatrixError && error.reason === "not-found")
                return null;
              throw error;
            }
          })
        );
        messages.push(...page.filter((item) => item !== null));
      }
    }
    await requireMatrixRoom(actor, input.id);
    return roomPinsSchema.parse({
      messageIds,
      revision: createHash("sha256")
        .update(JSON.stringify(messageIds))
        .digest("hex"),
      mayManage,
      messages,
    });
  });
}

/** Serialize product edits and compare the reviewed native list before replacing it. */
export async function setMatrixPin(
  actor: z.infer<typeof WorkspaceActorSchema>,
  raw: z.infer<typeof roomPinWriteSchema>
) {
  const input = roomPinWriteSchema.parse(raw);
  return transaction(async () => {
    await query(
      sql`SELECT pg_advisory_xact_lock(hashtextextended(${`matrix-pins:${input.id}`}, 0))`
    );
    const room = await joinMatrixRoom(actor, input.id);
    const previous = await readMatrixPins(actor, { id: input.id });
    if (!previous.mayManage) throw new WorkspaceAccessDenied();
    if (previous.messageIds.includes(input.messageId) === input.pinned)
      return { status: "saved" as const, pins: previous };
    if (previous.revision !== input.expectedRevision)
      return { status: "conflict" as const, pins: previous };
    if (input.pinned) await readRoomMessage(room, input.messageId);
    const next = input.pinned
      ? [input.messageId, ...previous.messageIds]
      : previous.messageIds.filter((id) => id !== input.messageId);
    roomPinsSchema.shape.messageIds.parse(next);
    await requireMatrixRoom(actor, input.id, room.kind === "group");
    await matrixRequest(
      "PUT",
      `rooms/${encodeURIComponent(room.roomId)}/state/m.room.pinned_events`,
      { pinned: next },
      room.kind === "direct" ? room.matrixId : undefined
    );
    const saved = await readMatrixPins(actor, { id: input.id });
    return {
      status:
        saved.messageIds.includes(input.messageId) === input.pinned
          ? ("saved" as const)
          : ("conflict" as const),
      pins: saved,
    };
  });
}
