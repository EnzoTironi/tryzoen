import { query, transaction } from "@db/queries";
import { sql } from "drizzle-orm";
import { randomUUID } from "node:crypto";
import type { z } from "zod";
import {
  creatorDraftListSchema,
  creatorDraftSaveSchema,
  creatorDraftSchema,
  creatorDraftStateSchema,
} from "@zoen/companion-ui/creators";
import {
  requireWorkspaceAccess,
  WorkspaceAccessDenied,
  type WorkspaceActorSchema,
} from "../workspaces/access";

export class CreatorDraftConflict extends Error {
  constructor() {
    super(
      "This draft changed elsewhere. Reopen it before saving your changes."
    );
    this.name = "CreatorDraftConflict";
  }
}

/** Only an authenticated person can author or read a private creator draft. */
export async function requireCreator(
  actor: z.infer<typeof WorkspaceActorSchema>
) {
  await requireWorkspaceAccess(actor);
  if (!actor.authSessionId || actor.groupBindingId || actor.protocolTaskId)
    throw new WorkspaceAccessDenied();
}

async function lockCreatorDrafts(actor: z.infer<typeof WorkspaceActorSchema>) {
  // Acquire before membership share locks so concurrent writes cannot deadlock
  // when live authorization upgrades the membership lock.
  await query(
    sql`SELECT pg_advisory_xact_lock(hashtextextended(${JSON.stringify(["creator-drafts", actor.workspaceId, actor.userId])}, 0))`
  );
  await requireCreator(actor);
}

async function countCreatorDrafts(actor: z.infer<typeof WorkspaceActorSchema>) {
  const [counts] = await query<{ active: number; total: number }>(sql`
    SELECT count(*) FILTER (WHERE archived_at IS NULL)::int AS active, count(*)::int AS total
    FROM creator_drafts WHERE workspace_id = ${actor.workspaceId} AND user_id = ${actor.userId}`);
  if (!counts)
    throw new Error("Your draft capacity could not be checked. Try again.");
  return counts;
}

export function listCreatorDrafts(actor: z.infer<typeof WorkspaceActorSchema>) {
  return transaction(async () => {
    await requireCreator(actor);
    const rows =
      await query(sql`SELECT id, revision, content->>'title' AS title,
      content->>'description' AS description, jsonb_array_length(content->'examples') AS examples,
      to_char(archived_at AT TIME ZONE 'UTC', 'YYYY-MM-DD"T"HH24:MI:SS.MS"Z"') AS "archivedAt",
      to_char(updated_at AT TIME ZONE 'UTC', 'YYYY-MM-DD"T"HH24:MI:SS.MS"Z"') AS "updatedAt"
      FROM creator_drafts WHERE workspace_id = ${actor.workspaceId} AND user_id = ${actor.userId}
      ORDER BY updated_at DESC, id DESC LIMIT 100`);
    return creatorDraftListSchema.parse(rows);
  });
}

export function readCreatorDraft(
  actor: z.infer<typeof WorkspaceActorSchema>,
  id: string
) {
  return transaction(async () => {
    await requireCreator(actor);
    const rows = await query(sql`SELECT id, revision, content,
      CASE WHEN evaluation_cases IS NULL THEN NULL ELSE jsonb_build_object('revision', evaluation_revision,
        'cases', evaluation_cases, 'updatedAt', extract(epoch FROM evaluation_updated_at)::float8 * 1000) END AS evaluation,
      to_char(archived_at AT TIME ZONE 'UTC', 'YYYY-MM-DD"T"HH24:MI:SS.MS"Z"') AS "archivedAt",
      to_char(updated_at AT TIME ZONE 'UTC', 'YYYY-MM-DD"T"HH24:MI:SS.MS"Z"') AS "updatedAt"
      FROM creator_drafts WHERE id = ${id} AND workspace_id = ${actor.workspaceId} AND user_id = ${actor.userId}`);
    if (!rows[0]) throw new WorkspaceAccessDenied();
    return creatorDraftSchema.parse(rows[0]);
  });
}

export function saveCreatorDraft(
  actor: z.infer<typeof WorkspaceActorSchema>,
  raw: z.infer<typeof creatorDraftSaveSchema>
) {
  const input = creatorDraftSaveSchema.parse(raw);
  return transaction(async () => {
    await lockCreatorDrafts(actor);
    const rows = await query<{
      revision: string;
      same: boolean;
      archived: boolean;
    }>(sql`
      SELECT revision, archived_at IS NOT NULL AS archived, content = ${JSON.stringify(input.content)}::jsonb AS same FROM creator_drafts
      WHERE id = ${input.id} AND workspace_id = ${actor.workspaceId} AND user_id = ${actor.userId} FOR UPDATE`);
    if (!rows[0]) {
      if (input.expectedRevision !== null) throw new WorkspaceAccessDenied();
      const counts = await countCreatorDrafts(actor);
      if (counts.active >= 20)
        throw new Error(
          "You can keep up to 20 active drafts. Archive one before creating another."
        );
      if (counts.total >= 100)
        throw new Error(
          "You can keep up to 100 drafts, including archived drafts, in this workspace."
        );
      const inserted =
        await query(sql`INSERT INTO creator_drafts (id, workspace_id, user_id, content)
        VALUES (${input.id}, ${actor.workspaceId}, ${actor.userId}, ${JSON.stringify(input.content)}::jsonb)
        ON CONFLICT (id) DO NOTHING RETURNING id`);
      if (!inserted.length) throw new WorkspaceAccessDenied();
      return readCreatorDraft(actor, input.id);
    }
    if (rows[0].archived) throw new CreatorDraftConflict();
    // A response-loss retry is safe only while the exact current content still matches.
    if (rows[0].same) return readCreatorDraft(actor, input.id);
    if (rows[0].revision !== input.expectedRevision)
      throw new CreatorDraftConflict();
    await query(sql`UPDATE creator_drafts SET content = ${JSON.stringify(input.content)}::jsonb,
      revision = ${randomUUID()}, updated_at = clock_timestamp() WHERE id = ${input.id}
      AND workspace_id = ${actor.workspaceId} AND user_id = ${actor.userId}`);
    return readCreatorDraft(actor, input.id);
  });
}

export function setCreatorDraftArchived(
  actor: z.infer<typeof WorkspaceActorSchema>,
  raw: z.infer<typeof creatorDraftStateSchema>
) {
  const input = creatorDraftStateSchema.parse(raw);
  return transaction(async () => {
    await lockCreatorDrafts(actor);
    const current = await readCreatorDraft(actor, input.id);
    if (Boolean(current.archivedAt) === input.archived) return current;
    if (current.revision !== input.expectedRevision)
      throw new CreatorDraftConflict();
    if (!input.archived && (await countCreatorDrafts(actor)).active >= 20)
      throw new Error(
        "Archive an active draft before restoring this one. You can keep up to 20 active drafts."
      );
    await query(sql`UPDATE creator_drafts
      SET archived_at = CASE WHEN ${input.archived} THEN clock_timestamp() ELSE NULL END,
      revision = ${randomUUID()}, updated_at = clock_timestamp()
      WHERE id = ${input.id} AND workspace_id = ${actor.workspaceId} AND user_id = ${actor.userId}`);
    return readCreatorDraft(actor, input.id);
  });
}
