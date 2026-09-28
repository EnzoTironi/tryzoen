import { query, transaction } from "@db/queries";
import { sql } from "drizzle-orm";
import { z } from "zod";
import { creatorPreviewModelSchema } from "@zoen/companion-ui/creators";
import {
  WorkspaceAccessDenied,
  type WorkspaceActorSchema,
} from "../workspaces/access";
import { readCreatorDraft } from "./drafts";

export const creatorPreviewOriginSchema = z.strictObject({
  sessionId: z.string().min(1).max(200),
  turnId: z.string().min(1).max(200),
});

/** Record the selected SDK model before the private child can call its provider. */
export function recordCreatorPreviewModel(
  actor: z.infer<typeof WorkspaceActorSchema>,
  source: z.infer<typeof creatorPreviewOriginSchema>,
  raw: z.infer<typeof creatorPreviewModelSchema>
) {
  const model = creatorPreviewModelSchema.parse(raw);
  const origin = creatorPreviewOriginSchema.parse(source);
  return transaction(async () => {
    const rows =
      await query(sql`SELECT id, draft_id AS "draftId" FROM creator_previews
      WHERE workspace_id = ${actor.workspaceId} AND user_id = ${actor.userId}
      AND source_session_id = ${origin.sessionId} AND source_turn_id = ${origin.turnId} AND status = 'running' AND expires_at > now() LIMIT 2`);
    if (rows.length !== 1) throw new WorkspaceAccessDenied();
    const { id, draftId } = z
      .object({ id: z.uuid(), draftId: z.uuid() })
      .parse(rows[0]);
    await readCreatorDraft(actor, draftId);
    const models = JSON.stringify([model]);
    const updated =
      await query(sql`UPDATE creator_previews SET models = CASE WHEN models @> ${models}::jsonb
      THEN models ELSE models || ${models}::jsonb END
      WHERE id = ${id} AND source_session_id = ${origin.sessionId} AND source_turn_id = ${origin.turnId} AND status = 'running' AND expires_at > now()
      AND (models @> ${models}::jsonb OR jsonb_array_length(models) < 8) RETURNING id`);
    if (!updated.length)
      throw new Error(
        "This preview is no longer available for model execution."
      );
  });
}
