import { randomUUID } from "node:crypto";
import { query, transaction } from "@db/queries";
import { sql } from "drizzle-orm";
import { creatorEvaluationSaveSchema } from "@zoen/companion-ui/creators";
import type { z } from "zod";
import type { WorkspaceActorSchema } from "../workspaces/access";
import {
  CreatorDraftConflict,
  lockCreatorDrafts,
  readCreatorDraft,
} from "./drafts";

export const creatorEvaluationUpsertSchema = creatorEvaluationSaveSchema.refine(
  (input) => input.cases.length > 0,
  "Choose at least one case to add or edit."
);

export const creatorEvaluationRemoveSchema = creatorEvaluationSaveSchema
  .omit({ cases: true })
  .extend({ caseId: creatorEvaluationSaveSchema.shape.draftId });

/** Conversational edits name the cases they change; omission is never deletion. */
export function upsertCreatorEvaluation(
  actor: z.infer<typeof WorkspaceActorSchema>,
  raw: z.infer<typeof creatorEvaluationUpsertSchema>
) {
  const input = creatorEvaluationUpsertSchema.parse(raw);
  return transaction(async () => {
    await lockCreatorDrafts(actor);
    const draft = await readCreatorDraft(actor, input.draftId);
    const cases = new Map(
      draft.evaluation?.cases.map((item) => [item.id, item])
    );
    for (const item of input.cases) cases.set(item.id, item);
    return saveCreatorEvaluation(actor, {
      ...input,
      cases: [...cases.values()],
    });
  });
}

export function removeCreatorEvaluationCase(
  actor: z.infer<typeof WorkspaceActorSchema>,
  raw: z.infer<typeof creatorEvaluationRemoveSchema>
) {
  const input = creatorEvaluationRemoveSchema.parse(raw);
  return transaction(async () => {
    await lockCreatorDrafts(actor);
    const draft = await readCreatorDraft(actor, input.draftId);
    return saveCreatorEvaluation(actor, {
      draftId: input.draftId,
      expectedRevision: input.expectedRevision,
      cases: (draft.evaluation?.cases ?? []).filter(
        (item) => item.id !== input.caseId
      ),
    });
  });
}

export function saveCreatorEvaluation(
  actor: z.infer<typeof WorkspaceActorSchema>,
  raw: z.infer<typeof creatorEvaluationSaveSchema>
) {
  const input = creatorEvaluationSaveSchema.parse(raw);
  return transaction(async () => {
    // Share the draft-write lock: an archive cannot race with a case-set edit.
    await lockCreatorDrafts(actor);
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
