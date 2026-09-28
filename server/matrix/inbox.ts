import { query, transaction } from "@db/queries";
import { sql } from "drizzle-orm";
import { z } from "zod";
import { roomSchema } from "@zoen/companion-ui/rooms";
import type { WorkspaceActorSchema } from "../workspaces/access";
import {
  requireWorkspaceAccess,
  WorkspaceAccessDenied,
} from "../workspaces/access";
import {
  matrixConfiguration,
  matrixRequest,
  MatrixEventSchema,
  MatrixError,
} from "./client";
import { ensureMatrixIdentity } from "./identities";
import { currentReplacement, readMatrixText } from "./messages";
import { mapAsync } from "../operations/async";

/** SQL ownership boundary for the unified inbox; never paginate this fragment alone. */
export async function authorizedInboxRooms(
  actor: z.infer<typeof WorkspaceActorSchema>,
  scope: "workspace" | "account" = "workspace"
) {
  await requireWorkspaceAccess(actor);
  if (!actor.authSessionId) throw new WorkspaceAccessDenied();
  const config = await matrixConfiguration();
  return sql`
    SELECT r.*, COALESCE(a.latest_at, 0)::double precision AS "activityAt", a.latest_event_id AS "latestEventId", COALESCE(a.latest_edited, false) AS "latestEdited", a.reconciled_at IS NOT NULL AS ready
    FROM (
      SELECT b.workspace_id AS "workspaceId", b.id::text, b.conversation_id AS "roomId", b.epoch::text, b.label, 'group'::text AS kind,
        NULL::text AS username, NULL::text AS "avatarUri"
      FROM workspace_group_bindings b
      JOIN workspace_memberships wm ON wm.workspace_id = b.workspace_id AND wm.user_id = ${actor.userId}
      JOIN workspaces w ON w.id = b.workspace_id
      JOIN organization_memberships om ON om.organization_id = w.organization_id AND om.user_id = ${actor.userId}
      WHERE ${scope === "workspace" ? sql`b.workspace_id = ${actor.workspaceId}` : sql`TRUE`} AND b.channel = 'matrix' AND b.installation_id = ${config.serverName} AND b.revoked_at IS NULL
      UNION ALL
      SELECT d.workspace_id AS "workspaceId", d.id::text, d.room_id AS "roomId", d.id::text AS epoch, u.name AS label, 'direct'::text AS kind,
        n.username, u.image AS "avatarUri"
      FROM matrix_direct_rooms d JOIN workspaces w ON w.id = d.workspace_id
      JOIN workspace_memberships first_member ON first_member.workspace_id = d.workspace_id AND first_member.user_id = d.first_user_id
      JOIN workspace_memberships second_member ON second_member.workspace_id = d.workspace_id AND second_member.user_id = d.second_user_id
      JOIN organization_memberships first_org ON first_org.organization_id = w.organization_id AND first_org.user_id = d.first_user_id
      JOIN organization_memberships second_org ON second_org.organization_id = w.organization_id AND second_org.user_id = d.second_user_id
      JOIN public.user u ON ('better-auth:' || u.id) = CASE WHEN d.first_user_id = ${actor.userId} THEN d.second_user_id ELSE d.first_user_id END
      LEFT JOIN user_directory n ON n.user_id = u.id
      WHERE ${scope === "workspace" ? sql`d.workspace_id = ${actor.workspaceId}` : sql`TRUE`} AND d.server_name = ${config.serverName} AND ${actor.userId} IN (d.first_user_id, d.second_user_id)
    ) r LEFT JOIN matrix_room_activity a ON a.server_name = ${config.serverName} AND a.room_id = r."roomId"
  `;
}

const summary = z.object({
  preview: z.string().nullable(),
  unread: z.null(),
  summaryState: z.enum(["ready", "pending", "unavailable"]),
});
const summaryRoom = roomSchema.extend({
  ready: z.boolean(),
  latestEventId: z.string().nullable(),
  latestEdited: z.boolean(),
});

/** Exact projected events only: at most 30 requests, concurrency four, never a history scan. */
export async function readMatrixInboxSummaries(
  actor: z.infer<typeof WorkspaceActorSchema>,
  ids: string[]
) {
  const selected = [...new Set(z.array(z.uuid()).max(30).parse(ids))];
  if (!selected.length) return new Map<string, z.infer<typeof summary>>();
  return transaction(async () => {
    const authorized = await authorizedInboxRooms(actor);
    const selection = sql`SELECT * FROM (${authorized}) rooms WHERE id IN (${sql.join(
      selected.map((id) => sql`${id}`),
      sql`, `
    )})`;
    const rooms = z.array(summaryRoom).parse(await query(selection));
    if (rooms.length !== selected.length) throw new WorkspaceAccessDenied();
    const viewer = await ensureMatrixIdentity(actor);
    const summaries = await mapAsync(
      rooms,
      (room) => readProjectedSummary(room, viewer),
      4
    );
    // Recheck both counterpart memberships after the network operation.
    await requireWorkspaceAccess(actor);
    if ((await query(selection)).length !== selected.length)
      throw new WorkspaceAccessDenied();
    return new Map(rooms.map((room, index) => [room.id, summaries[index]]));
  });
}

async function readProjectedSummary(
  room: z.infer<typeof summaryRoom>,
  viewer: string
) {
  if (!room.ready || !room.latestEventId)
    return summary.parse({
      preview: null,
      unread: null,
      summaryState: "pending",
    });
  try {
    const event = MatrixEventSchema.parse(
      await matrixRequest(
        "GET",
        `rooms/${encodeURIComponent(room.roomId)}/event/${encodeURIComponent(room.latestEventId)}`,
        undefined,
        viewer
      )
    );
    if (event.event_id !== room.latestEventId || event.room_id !== room.roomId)
      throw new WorkspaceAccessDenied();
    return summary.parse({
      preview: messagePreview(event, room.latestEdited),
      unread: null,
      summaryState: "ready",
    });
  } catch (error) {
    if (!(error instanceof MatrixError)) throw error;
    return summary.parse({
      preview: null,
      unread: null,
      summaryState: "unavailable",
    });
  }
}

function messagePreview(
  event: z.infer<typeof MatrixEventSchema>,
  edited: boolean
) {
  if (event.unsigned?.redacted_because) return "Mensagem removida";
  const replacement = currentReplacement(event);
  if (replacement?.content["m.new_content"])
    return readMatrixText(replacement.content["m.new_content"])
      .text.replace(/\s+/gu, " ")
      .slice(0, 180);
  if (edited) return "Mensagem editada";
  switch (event.content.msgtype) {
    case "m.image":
      return "Foto";
    case "m.video":
      return "Vídeo";
    case "m.audio":
      return "Áudio";
    default:
      return readMatrixText(event.content)
        .text.replace(/\s+/gu, " ")
        .slice(0, 180);
  }
}
