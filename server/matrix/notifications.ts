import { z } from "zod";
import { sql } from "drizzle-orm";
import { query, transaction } from "@db/queries";
import {
  roomNotificationsReadSchema,
  roomNotificationsWriteSchema,
} from "@zoen/companion-ui/rooms";
import type { WorkspaceActorSchema } from "../workspaces/access";
import { ensureMatrixIdentity } from "./identities";
import { requireMatrixRoom } from "./rooms";
import { MatrixError, matrixRequest } from "./client";

const muteRuleSchema = z.object({
  enabled: z.boolean(),
  actions: z.array(z.json()).length(0),
  conditions: z.tuple([
    z.object({
      kind: z.literal("event_match"),
      key: z.literal("room_id"),
      pattern: z.string(),
    }),
  ]),
});

async function readMuteRule(path: string, roomId: string, matrixId: string) {
  try {
    const rule = muteRuleSchema.parse(
      await matrixRequest("GET", path, undefined, matrixId, {
        maxResponseBytes: 8192,
      })
    );
    if (rule.conditions[0].pattern !== roomId)
      throw new MatrixError({ reason: "conflict" });
    return rule;
  } catch (error) {
    if (error instanceof MatrixError && error.reason === "not-found")
      return null;
    throw error;
  }
}

/** One native override per person/conversation; no duplicate notification preference store. */
export function readRoomNotifications(
  actor: z.infer<typeof WorkspaceActorSchema>,
  raw: z.infer<typeof roomNotificationsReadSchema>
) {
  const { id } = roomNotificationsReadSchema.parse(raw);
  return transaction(async () => {
    const room = await requireMatrixRoom(actor, id);
    const matrixId = await ensureMatrixIdentity(actor);
    const rule = await readMuteRule(
      `pushrules/global/override/org.zoen.mute.${id}`,
      room.roomId,
      matrixId
    );
    await requireMatrixRoom(actor, id);
    return { muted: rule?.enabled ?? false };
  });
}

export function setRoomNotifications(
  actor: z.infer<typeof WorkspaceActorSchema>,
  raw: z.infer<typeof roomNotificationsWriteSchema>
) {
  const { id, muted } = roomNotificationsWriteSchema.parse(raw);
  return transaction(async () => {
    // Serialize this person's changes across Zoen tabs; the final successful choice wins.
    await query(
      sql`SELECT pg_advisory_xact_lock(hashtextextended(${`matrix-notifications:${actor.userId}:${id}`}, 0))`
    );
    const room = await requireMatrixRoom(actor, id);
    const matrixId = await ensureMatrixIdentity(actor);
    const path = `pushrules/global/override/org.zoen.mute.${id}`;
    const existing = await readMuteRule(path, room.roomId, matrixId);
    if (!existing && muted)
      await matrixRequest(
        "PUT",
        path,
        {
          actions: [],
          conditions: [
            { kind: "event_match", key: "room_id", pattern: room.roomId },
          ],
        },
        matrixId
      );
    else if (existing && existing.enabled !== muted)
      await matrixRequest(
        "PUT",
        `${path}/enabled`,
        { enabled: muted },
        matrixId
      );
    return readRoomNotifications(actor, { id });
  });
}
