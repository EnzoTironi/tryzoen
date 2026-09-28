import { randomUUID } from "node:crypto";
import { query, transaction } from "@db/queries";
import { sql } from "drizzle-orm";
import { creatorEvaluationSaveSchema } from "@zoen/companion-ui/creators";
import type { z } from "zod";
import type { WorkspaceActorSchema } from "../workspaces/access";
import { CreatorDraftConflict, readCreatorDraft } from "./drafts";

export function saveCreatorEvaluation(
  actor: z.infer<typeof WorkspaceActorSchema>,
  raw: z.infer<typeof creatorEvaluationSaveSchema>
) {
  const input = creatorEvaluationSaveSchema.parse(raw);
  return transaction(async () => {
    // Share the draft-write lock: an archive cannot race with a case-set edit.
    await query(
      sql`SELECT pg_advisory_xact_lock(hashtextextended(${JSON.stringify(["creator-drafts", actor.workspaceId, actor.userId])}, 0))`
    );
    const draft = await readCreatorDraft(actor, input.draftId);
    if (draft.archivedAt) throw new CreatorDraftConflict();
    if (
      draft.evaluation &&
      JSON.stringify(draft.evaluation.cases) === JSON.stringify(input.cases)
    )
      return draft;
    if ((draft.evaluation?.revision ?? null) !== input.expectedRevision)
      throw new CreatorDraftConflict();
    await query(sql`UPDATE creator_drafts SET evaluation_cases = ${JSON.stringify(input.cases)}::jsonb,
      evaluation_revision = ${randomUUID()}, evaluation_updated_at = clock_timestamp()
      WHERE id = ${input.draftId} AND workspace_id = ${actor.workspaceId} AND user_id = ${actor.userId}`);
    return readCreatorDraft(actor, input.draftId);
  });
}
