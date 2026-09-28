import { query, transaction } from "@db/queries";
import { sql } from "drizzle-orm";
import { randomUUID } from "node:crypto";
import type { z } from "zod";
import {
  creatorDraftListSchema,
  creatorDraftSaveSchema,
  creatorDraftSchema,
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
async function requireCreator(actor: z.infer<typeof WorkspaceActorSchema>) {
  await requireWorkspaceAccess(actor);
  if (!actor.authSessionId || actor.groupBindingId || actor.protocolTaskId)
    throw new WorkspaceAccessDenied();
}

export function listCreatorDrafts(actor: z.infer<typeof WorkspaceActorSchema>) {
  return transaction(async () => {
    await requireCreator(actor);
    const rows =
      await query(sql`SELECT id, revision, content->>'title' AS title,
      content->>'description' AS description, jsonb_array_length(content->'examples') AS examples,
      to_char(updated_at AT TIME ZONE 'UTC', 'YYYY-MM-DD"T"HH24:MI:SS.MS"Z"') AS "updatedAt"
      FROM creator_drafts WHERE workspace_id = ${actor.workspaceId} AND user_id = ${actor.userId}
      ORDER BY updated_at DESC, id DESC LIMIT 20`);
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
    // Acquire before membership share locks: upgrading those locks would
    // deadlock concurrent saves for the same person.
    await query(
      sql`SELECT pg_advisory_xact_lock(hashtextextended(${JSON.stringify(["creator-drafts", actor.workspaceId, actor.userId])}, 0))`
    );
    await requireCreator(actor);
    const rows = await query<{ revision: string; same: boolean }>(sql`
      SELECT revision, content = ${JSON.stringify(input.content)}::jsonb AS same FROM creator_drafts
      WHERE id = ${input.id} AND workspace_id = ${actor.workspaceId} AND user_id = ${actor.userId} FOR UPDATE`);
    if (rows[0]) {
      // A response-loss retry is safe only while the exact current content still matches.
      if (rows[0].same) return readCreatorDraft(actor, input.id);
      if (rows[0].revision !== input.expectedRevision)
        throw new CreatorDraftConflict();
      await query(sql`UPDATE creator_drafts SET content = ${JSON.stringify(input.content)}::jsonb,
        revision = ${randomUUID()}, updated_at = clock_timestamp() WHERE id = ${input.id}
        AND workspace_id = ${actor.workspaceId} AND user_id = ${actor.userId}`);
    } else {
      if (input.expectedRevision !== null) throw new WorkspaceAccessDenied();
      const [{ count } = { count: 20 }] = await query<{ count: number }>(sql`
        SELECT count(*)::int AS count FROM creator_drafts
        WHERE workspace_id = ${actor.workspaceId} AND user_id = ${actor.userId}`);
      if (count >= 20)
        throw new Error(
          "You can keep up to 20 creator drafts in this workspace."
        );
      const inserted =
        await query(sql`INSERT INTO creator_drafts (id, workspace_id, user_id, content)
        VALUES (${input.id}, ${actor.workspaceId}, ${actor.userId}, ${JSON.stringify(input.content)}::jsonb)
        ON CONFLICT (id) DO NOTHING RETURNING id`);
      if (!inserted.length) throw new WorkspaceAccessDenied();
    }
    return readCreatorDraft(actor, input.id);
  });
}
