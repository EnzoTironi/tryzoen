import { query, transaction, SqlError } from "@db/queries";
import { sql } from "drizzle-orm";
import type { z } from "zod";
import {
  roomReportSchema,
  roomReportResultSchema,
} from "@zoen/companion-ui/rooms";
import {
  WorkspaceAccessDenied,
  type WorkspaceActorSchema,
} from "../workspaces/access";
import { matrixConfiguration, matrixRequest, MatrixError } from "./client";
import { joinMatrixRoom, requireMatrixRoom } from "./rooms";
import { currentReplacement, readRoomMessage } from "./messages";

/** Native reports have no transaction ID. Commit admission before contacting the provider. */
export async function reportMatrixMessage(
  actor: z.infer<typeof WorkspaceActorSchema>,
  raw: z.infer<typeof roomReportSchema>
) {
  const input = roomReportSchema.parse(raw);
  if (!actor.authSessionId || actor.groupBindingId || actor.protocolTaskId)
    throw new WorkspaceAccessDenied();
  const claim = await claimMessageReport(actor, input);
  if ("status" in claim) return roomReportResultSchema.parse(claim);
  try {
    return await transaction(async () => {
      await requireMatrixRoom(actor, input.id);
      // App edits use the same lock. An external Matrix client has no compare-and-set contract.
      await query(
        sql`SELECT pg_advisory_xact_lock(hashtextextended(${`${claim.roomId}:${input.messageId}`}, 10))`
      );
      const message = await readRoomMessage(claim, input.messageId);
      if (
        (currentReplacement(message)?.event_id ?? message.event_id) !==
        input.expectedRevision
      )
        return roomReportResultSchema.parse({ status: "changed" });
      await matrixRequest(
        "POST",
        `rooms/${encodeURIComponent(claim.roomId)}/report/${encodeURIComponent(input.expectedRevision)}`,
        { reason: input.reason },
        claim.matrixId,
        { maxResponseBytes: 4096 }
      );
      await query(sql`UPDATE matrix_message_reports SET status = 'submitted'
        WHERE user_id = ${actor.userId} AND server_name = ${claim.serverName} AND event_id = ${input.expectedRevision}`);
      return roomReportResultSchema.parse({ status: "submitted" });
    });
  } catch (error) {
    if (!(error instanceof MatrixError || error instanceof SqlError))
      throw error;
    // A lost response (including a process crash) must never repeat the report automatically.
    return roomReportResultSchema.parse({ status: "uncertain" });
  }
}

async function claimMessageReport(
  actor: z.infer<typeof WorkspaceActorSchema>,
  input: z.infer<typeof roomReportSchema>
) {
  return transaction(async () => {
    const room = await joinMatrixRoom(actor, input.id);
    const { serverName } = await matrixConfiguration();
    await query(
      sql`SELECT pg_advisory_xact_lock(hashtextextended(${`matrix-reports:${actor.userId}`}, 0))`
    );
    const message = await readRoomMessage(room, input.messageId);
    if (message.sender === room.matrixId) throw new WorkspaceAccessDenied();
    if (
      (currentReplacement(message)?.event_id ?? message.event_id) !==
      input.expectedRevision
    )
      return { status: "changed" };
    const prior = await query(sql`SELECT status FROM matrix_message_reports
      WHERE user_id = ${actor.userId} AND server_name = ${serverName} AND event_id = ${input.expectedRevision}`);
    if (prior[0]) return roomReportResultSchema.parse(prior[0]);
    // A bounded index read and user lock enforce the quota across rooms, sessions and workers.
    const recent =
      await query(sql`SELECT 1 FROM matrix_message_reports WHERE user_id = ${actor.userId}
      AND created_at > now() - interval '24 hours' LIMIT 10`);
    if (recent.length >= 10) return { status: "limited" };
    await requireMatrixRoom(actor, input.id);
    await query(sql`INSERT INTO matrix_message_reports (user_id, server_name, room_id, event_id, status)
      VALUES (${actor.userId}, ${serverName}, ${room.roomId}, ${input.expectedRevision}, 'uncertain')`);
    return { ...room, serverName };
  });
}
