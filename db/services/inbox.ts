import { sql } from "drizzle-orm";
import { z } from "zod";
import { query, transaction } from "@db/queries";
import { inboxPageSchema, inboxQuerySchema } from "@zoen/companion-ui/inbox";
import { chatPageSchema } from "@zoen/companion-ui/chats";
import {
  authorizedInboxRooms,
  readMatrixInboxSummaries,
} from "../../server/matrix/inbox";
import { MatrixError, matrixConfiguration } from "../../server/matrix/client";
import {
  requireWorkspaceAccess,
  WorkspaceAccessDenied,
  type WorkspaceActorSchema,
} from "../../server/workspaces/access";

const rowSchema = z.object({
  id: z.string(),
  kind: z.enum(["agent", "room"]),
  activityAt: z.coerce.number().int().nonnegative(),
  payload: z.unknown(),
});

/** Pagination happens across all authorized kinds before fetching any previews. */
export async function listConversationInbox(
  actor: z.infer<typeof WorkspaceActorSchema>,
  raw: z.input<typeof inboxQuerySchema>
) {
  const input = inboxQuerySchema.parse(raw);
  return transaction(async () => {
    const access = await requireWorkspaceAccess(actor);
    if (!actor.authSessionId) throw new WorkspaceAccessDenied();
    const configured = await matrixConfiguration()
      .then(() => true)
      .catch((error: unknown) => {
        if (error instanceof MatrixError) return false;
        throw error;
      });
    const rooms = configured
      ? await authorizedInboxRooms(actor)
      : sql`SELECT NULL::text AS id, NULL::text AS "roomId", NULL::text AS epoch, NULL::text AS label, NULL::text AS kind, NULL::text AS username, NULL::text AS "avatarUri", 0::bigint AS "activityAt", false AS ready WHERE false`;
    const entries = inboxEntries(actor, input, rooms);
    const rows = z.array(rowSchema).parse(
      await query(sql`${entries}
      SELECT id, kind, "activityAt", payload FROM entries
      WHERE (${input.filter} = 'all' OR category = ${input.filter})
        AND position(lower(${input.query}) IN lower(search)) > 0
        ${input.cursor ? sql`AND ("activityAt", kind, id) < (${input.cursor.activityAt}::bigint, ${input.cursor.kind}, ${input.cursor.id})` : sql``}
      ORDER BY "activityAt" DESC, kind DESC, id DESC LIMIT 31`)
    );
    const selected = rows.slice(0, 30);
    const summaries = configured
      ? await readMatrixInboxSummaries(
          actor,
          selected.filter((row) => row.kind === "room").map((row) => row.id)
        )
      : undefined;
    const pinned =
      !input.query && !input.archived && ["all", "bots"].includes(input.filter)
        ? z
            .array(rowSchema)
            .parse(
              await query(sql`${entries} SELECT id, kind, "activityAt", payload FROM entries
          WHERE kind = 'agent' AND (payload->>'pinned')::boolean ORDER BY "activityAt" DESC, id DESC LIMIT 6`)
            )
            .map((row) => chatPageSchema.shape.items.element.parse(row.payload))
        : [];
    const pending =
      configured && !input.archived && input.filter !== "bots"
        ? await query(
            sql`SELECT EXISTS(SELECT 1 FROM (${rooms}) authorized WHERE NOT ready) AS pending`
          )
        : [];
    await requireWorkspaceAccess(actor);
    const last = selected.at(-1);
    return inboxPageSchema.parse({
      items: selected.map((row) =>
        row.kind === "agent"
          ? { kind: row.kind, activityAt: row.activityAt, chat: row.payload }
          : Object.assign(
              {
                kind: row.kind,
                activityAt: row.activityAt,
                room: row.payload,
              },
              summaries?.get(row.id) ?? {
                preview: null,
                unread: null,
                summaryState: "unavailable",
              }
            )
      ),
      pinned,
      nextCursor:
        rows.length > 30 && last
          ? { activityAt: last.activityAt, kind: last.kind, id: last.id }
          : null,
      configured,
      mayManage: !!access.organizationId && access.role !== "member",
      syncPending: pending[0]?.pending === true,
    });
  });
}

function inboxEntries(
  actor: z.infer<typeof WorkspaceActorSchema>,
  input: z.infer<typeof inboxQuerySchema>,
  rooms: ReturnType<typeof sql>
) {
  return sql`
      WITH rooms AS (${rooms}), entries AS (
        SELECT c.session_id AS id, 'agent'::text AS kind, 'bots'::text AS category,
          floor(extract(epoch FROM c.updated_at) * 1000)::bigint AS "activityAt", c.title AS search,
          jsonb_build_object('sessionId', c.session_id, 'title', c.title,
            'updatedAt', to_char(c.updated_at AT TIME ZONE 'UTC', 'YYYY-MM-DD"T"HH24:MI:SS.MS"Z"'),
            'pinned', c.pinned, 'archived', c.archived) AS payload
        FROM chats c JOIN agent_sessions s ON s.session_id = c.session_id AND s.workspace_id = c.workspace_id
        WHERE c.workspace_id = ${actor.workspaceId} AND s.created_by_user_id = ${actor.userId}
          AND c.archived = ${input.archived}
        UNION ALL
        SELECT r.id, 'room', CASE WHEN r.kind = 'direct' THEN 'people' ELSE 'groups' END,
          r."activityAt", r.label || ' ' || coalesce(r.username, ''),
          jsonb_build_object('id',r.id,'roomId',r."roomId",'epoch',r.epoch,'label',r.label,'kind',r.kind,'username',r.username,'avatarUri',r."avatarUri")
        FROM rooms r WHERE NOT ${input.archived}
      )`;
}

/** Global head before pagination, without provider previews or a transaction across network work. */
export async function readInboxSyncHead(
  actor: z.infer<typeof WorkspaceActorSchema>,
  raw: z.input<typeof inboxQuerySchema>,
  focusedRoomId?: string
) {
  const input = inboxQuerySchema.parse(raw);
  const rooms = await authorizedInboxRooms(actor);
  const rows = z.array(rowSchema).parse(
    await query(sql`${inboxEntries(actor, input, rooms)}
    SELECT id,kind,"activityAt",payload FROM entries
    WHERE (${input.filter}='all' OR category=${input.filter}) AND position(lower(${input.query}) IN lower(search))>0
    ORDER BY "activityAt" DESC,kind DESC,id DESC LIMIT 30`)
  );
  const ids = rows.filter((row) => row.kind === "room").map((row) => row.id);
  if (focusedRoomId && !ids.includes(focusedRoomId)) ids.push(focusedRoomId);
  const scope = ids.length
    ? z
        .array(
          z.object({ id: z.uuid(), roomId: z.string(), epoch: z.string() })
        )
        .max(31)
        .parse(
          await query(
            sql`SELECT id,"roomId",epoch FROM (${rooms}) authorized WHERE id IN (${sql.join(
              ids.map((id) => sql`${id}`),
              sql`, `
            )}) ORDER BY id`
          )
        )
    : [];
  if (scope.length !== ids.length) throw new WorkspaceAccessDenied();
  return { rows, scope };
}
