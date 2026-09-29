import { query, transaction } from "@db/queries";
import { sql } from "drizzle-orm";
import type { z } from "zod";
import {
  creatorReleaseCandidateSchema,
  creatorReleaseEvidenceSchema,
  creatorPreviewListSchema,
} from "@zoen/companion-ui/creators";
import type { WorkspaceActorSchema } from "../workspaces/access";
import { readCreatorDraft } from "./drafts";
import { creatorPreviewProjection } from "./preview-record";

export function readCreatorReleaseCandidate(
  actor: z.infer<typeof WorkspaceActorSchema>,
  draftId: string
) {
  return transaction(async () => {
    const draft = await readCreatorDraft(actor, draftId);
    const issues: string[] = [];
    if (draft.archivedAt)
      issues.push("Restore this draft before approving a version.");
    if (!draft.content.playbook.trim())
      issues.push("Write the playbook before approving a version.");
    const cases = draft.evaluation?.cases ?? [];
    if (!cases.length)
      issues.push(
        "Add evaluation cases, run them, and review their responses first."
      );
    const previews = creatorPreviewListSchema.parse(
      await query(sql`
      SELECT DISTINCT ON (evaluation->'case'->>'id') ${creatorPreviewProjection}
      FROM creator_previews WHERE workspace_id = ${actor.workspaceId} AND user_id = ${actor.userId}
      AND draft_id = ${draftId} AND revision = ${draft.revision}
      AND kind = 'answer' AND pilot_id IS NULL
      AND evaluation->>'revision' = ${draft.evaluation?.revision ?? null}
      ORDER BY evaluation->'case'->>'id', created_at DESC, id DESC LIMIT 20`)
    );
    const evidence: z.infer<typeof creatorReleaseEvidenceSchema>[] = [];
    for (const item of cases) {
      const latest = previews.find(
        (preview) => preview.evaluation?.case.id === item.id
      );
      const reviewed = creatorReleaseEvidenceSchema.safeParse(latest);
      if (
        latest?.answerMode !== "snapshot" ||
        !reviewed.success ||
        JSON.stringify(reviewed.data.evaluation.case) !== JSON.stringify(item)
      ) {
        issues.push(
          `${item.title}: the latest run needs a completed answer, a “Useful for this case” review, and recorded model and timing.`
        );
        continue;
      }
      evidence.push(reviewed.data);
    }
    return creatorReleaseCandidateSchema.parse({ draft, evidence, issues });
  });
}
