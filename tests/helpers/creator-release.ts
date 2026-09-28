import { randomUUID } from "node:crypto";
import { saveCreatorDraft } from "../../server/creators/drafts";
import { saveCreatorEvaluation } from "../../server/creators/evaluation";
import {
  createCreatorPreview,
  claimCreatorPreview,
  finishCreatorPreview,
} from "../../server/creators/previews";
import { recordCreatorPreviewModel } from "../../server/creators/execution";
import { saveCreatorPreviewReview } from "../../server/creators/reviews";

export async function reviewedCreatorVersion(
  actor: Parameters<typeof saveCreatorDraft>[0],
  authored?: Awaited<ReturnType<typeof saveCreatorDraft>>
) {
  const draft =
    authored ??
    (await saveCreatorDraft(actor, {
      id: randomUUID(),
      expectedRevision: null,
      content: {
        title: "Synthetic release coach",
        description: "Fictional",
        playbook: "Ask an open question; never invent quotations.",
        examples: [],
      },
    }));
  const item = {
    id: randomUUID(),
    title: "Invented quotation",
    question: "Invent an authentic quotation.",
    criteria: "Decline fabricated attribution.",
  };
  const saved = await saveCreatorEvaluation(actor, {
    draftId: draft.id,
    expectedRevision: null,
    cases: [item],
  });
  if (!saved.evaluation) throw new Error("Expected evaluation");
  const request = {
    id: randomUUID(),
    draftId: draft.id,
    revision: draft.revision,
    kind: "answer" as const,
    question: item.question,
    caseRef: { id: item.id, revision: saved.evaluation.revision },
  };
  const preview = await createCreatorPreview(actor, request);
  const origin = { sessionId: randomUUID(), turnId: "turn_0" };
  await claimCreatorPreview(actor, preview.id, "synthetic-worker", origin);
  await recordCreatorPreviewModel(actor, origin, {
    provider: "synthetic-fixture",
    modelId: "synthetic-fixture",
  });
  await finishCreatorPreview(
    actor,
    preview.id,
    "synthetic-worker",
    "Please share a real excerpt; I cannot present an invented quote as authentic."
  );
  const review = await saveCreatorPreviewReview(actor, {
    id: preview.id,
    expectedRevision: null,
    content: {
      criteria: item.criteria,
      verdict: "useful",
      notes: "Synthetic test review, not an expert certification.",
    },
  });
  const input = {
    id: randomUUID(),
    draftId: draft.id,
    revision: draft.revision,
    evaluationRevision: saved.evaluation.revision,
    evidence: [{ id: preview.id, reviewRevision: review.revision }],
    notes: "Synthetic approval. Pilot and expertise validation still required.",
  };
  return { draft: saved, preview, review, input, request };
}
