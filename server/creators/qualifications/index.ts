import { readCreatorQualification } from "./records";
export { readCreatorQualification, listCreatorQualifications } from "./records";
import { query, transaction } from "@db/queries";
import { sql } from "drizzle-orm";
import {
  creatorQualificationRequestSchema,
  creatorQualificationEvidenceSchema,
  creatorPreviewListSchema,
} from "@zoen/companion-ui/creators";
import type { z } from "zod";
import { readCreatorRelease } from "../releases";
import { readCreatorDraft } from "../drafts";
import { creatorPreviewProjection } from "../preview-record";
import { authorizedCreatorCorpus } from "../corpus/access";
import { verifyCreatorGrounding, validateGroundedAnswer } from "../grounding";
import {
  WorkspaceAccessDenied,
  type WorkspaceActorSchema,
} from "../../workspaces/access";
export function readCreatorQualificationCandidate(
  actor: z.infer<typeof WorkspaceActorSchema>,
  releaseId: string
) {
  return transaction(async () => {
    const release = await readCreatorRelease(actor, releaseId);
    const draft = await readCreatorDraft(actor, release.draftId);
    const corpus = await authorizedCreatorCorpus(actor, {
      kind: "creator",
      releaseId,
    });
    const issues: string[] = [];
    if (!corpus.initialized)
      issues.push("Index this approved release before qualifying it.");
    if (draft.archivedAt || draft.revision !== release.revision)
      issues.push("Qualify the current, unarchived approved draft revision.");
    const cases = draft.evaluation?.cases ?? [];
    if (
      !cases.some((item) => item.expectedGrounding === "supported") ||
      !cases.some((item) => item.expectedGrounding === "insufficient-evidence")
    )
      issues.push(
        "Declare at least one supported case and one insufficient-evidence case before running both."
      );
    const previews = creatorPreviewListSchema.parse(
      await query(
        sql`SELECT DISTINCT ON (evaluation->'case'->>'id') ${creatorPreviewProjection} FROM creator_previews WHERE workspace_id=${actor.workspaceId} AND user_id=${actor.userId} AND draft_id=${draft.id} AND revision=${release.revision} AND kind='grounded-answer' AND pilot_id IS NULL AND grounding->>'releaseId'=${releaseId} AND evaluation->>'revision'=${draft.evaluation?.revision ?? null} ORDER BY evaluation->'case'->>'id',created_at DESC,id DESC LIMIT 20`
      )
    );
    const evidence: z.infer<typeof creatorQualificationEvidenceSchema>[] = [];
    for (const item of cases) {
      const parsed = creatorQualificationEvidenceSchema.safeParse(
        previews.find((preview) => preview.evaluation?.case.id === item.id)
      );
      if (
        !parsed.success ||
        JSON.stringify(parsed.data.evaluation.case) !== JSON.stringify(item) ||
        parsed.data.grounding.manifestDigest !== corpus.digest ||
        parsed.data.groundedAnswer.status !== item.expectedGrounding
      ) {
        issues.push(
          `${item.title}: latest grounded run must match its predeclared expected outcome and have a useful human review, model and timing.`
        );
        continue;
      }
      validateGroundedAnswer(parsed.data.groundedAnswer, parsed.data.grounding);
      evidence.push(parsed.data);
    }
    return {
      releaseId,
      draftId: draft.id,
      title: release.content.title,
      manifestDigest: corpus.digest,
      evaluationRevision: draft.evaluation?.revision ?? null,
      evidence,
      issues,
    };
  });
}
export function approveCreatorQualification(
  actor: z.infer<typeof WorkspaceActorSchema>,
  raw: z.infer<typeof creatorQualificationRequestSchema>
) {
  const input = creatorQualificationRequestSchema.parse(raw);
  return transaction(async () => {
    for (const domain of ["creator-drafts", "creator-previews"])
      await query(
        sql`SELECT pg_advisory_xact_lock(hashtextextended(${JSON.stringify([domain, actor.workspaceId, actor.userId])},0))`
      );
    await readCreatorRelease(actor, input.releaseId);
    const [existing] = await query(
      sql`SELECT id FROM creator_qualifications WHERE id=${input.id}`
    );
    if (existing) {
      const saved = await readCreatorQualification(actor, input.id);
      const receipt = {
        id: saved.id,
        releaseId: saved.releaseId,
        manifestDigest: saved.manifestDigest,
        evaluationRevision: saved.evaluationRevision,
        evidence: saved.evidence.map((item) => ({
          id: item.id,
          reviewRevision: item.review.revision,
        })),
        notes: saved.notes,
      };
      if (JSON.stringify(receipt) !== JSON.stringify(input))
        throw new Error(
          "This qualification was already approved with different evidence."
        );
      return saved;
    }
    const candidate = await readCreatorQualificationCandidate(
      actor,
      input.releaseId
    );
    if (candidate.issues.length) throw new Error(candidate.issues.join("\n"));
    if (
      candidate.manifestDigest !== input.manifestDigest ||
      candidate.evaluationRevision !== input.evaluationRevision ||
      JSON.stringify(
        candidate.evidence.map((item) => ({
          id: item.id,
          reviewRevision: item.review.revision,
        }))
      ) !== JSON.stringify(input.evidence)
    )
      throw new Error(
        "Qualification evidence changed. Review the current candidate again."
      );
    for (const item of candidate.evidence)
      await verifyCreatorGrounding(actor, item.grounding);
    const [capacity] = await query<{ count: number }>(
      sql`SELECT count(*)::int AS count FROM creator_qualifications WHERE release_id=${input.releaseId}`
    );
    if (!capacity || capacity.count >= 50)
      throw new Error("Up to 50 private qualifications per source release.");
    const [inserted] = await query(
      sql`INSERT INTO creator_qualifications(id,release_id,manifest_digest,evaluation_revision,evidence,notes) VALUES(${input.id},${input.releaseId},${input.manifestDigest},${input.evaluationRevision},${JSON.stringify(candidate.evidence)}::jsonb,${input.notes}) ON CONFLICT(id) DO NOTHING RETURNING id`
    );
    if (!inserted) throw new WorkspaceAccessDenied();
    return readCreatorQualification(actor, input.id);
  });
}
