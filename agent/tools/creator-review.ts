import { defineWorkflowTool, type WorkflowStepToolContext } from "eve/tools";
import { z } from "zod";
import { creatorPreviewReviewSaveSchema } from "@zoen/companion-ui/creators";
import { exportCreatorPreview } from "../../server/creators/previews";
import { requireCreator } from "../../server/creators/drafts";
import { saveCreatorPreviewReview } from "../../server/creators/reviews";
import { workspaceActorFromPrincipal } from "../../server/workspaces/access";

export default defineWorkflowTool({
  availableInSubagents: false,
  description:
    "Ask the creator to review one completed evaluation in this conversation. Supply only its preview UUID. The workflow displays the actual saved question, response and predeclared criteria; only the human supplies the verdict and feedback. It saves their review with revision checks. Never invent a rating, answer the questions for them, or claim a release was approved. Use creator-library to save evaluation cases and create requests, then creator-preview to run them first.",
  inputSchema: z.strictObject({ id: z.uuid() }),
  async execute({ id }, context) {
    "use workflow";
    const preview = await read(id, context);
    const decision = await context.ask({
      prompt: `Review ${preview.title}\n\nQuestion\n${preview.question}\n\nCriteria saved before the test\n${preview.criteria}\n\nBot response\n${preview.response}`,
      display: "select",
      allowFreeform: false,
      options: [
        { id: "useful", label: "Useful for this case" },
        { id: "needs-revision", label: "Needs revision" },
        { id: "unsafe-or-unsupported", label: "Unsafe or unsupported" },
        { id: "cancel", label: "Cancel review" },
      ],
    });
    if (decision.optionId === "cancel") return { status: "cancelled" };
    const verdict =
      creatorPreviewReviewSaveSchema.shape.content.shape.verdict.parse(
        decision.optionId
      );
    const feedback = await context.ask({
      prompt:
        "What worked, or what should change? Your feedback is saved with this exact test result. Cancel to leave the review unchanged.",
      display: "text",
      allowFreeform: true,
      options: [{ id: "cancel", label: "Cancel review" }],
    });
    if (feedback.optionId === "cancel") return { status: "cancelled" };
    return save(
      {
        id,
        expectedRevision: preview.reviewRevision,
        content: {
          criteria: preview.criteria,
          verdict,
          notes: feedback.text ?? "",
        },
      },
      context
    );
  },
});

async function read(id: string, context: WorkflowStepToolContext) {
  "use step";
  const actor = await workspaceActorFromPrincipal(
    context.session.auth.current ?? undefined
  );
  await requireCreator(actor);
  const preview = await exportCreatorPreview(actor, id);
  if (
    preview.status !== "completed" ||
    !preview.response ||
    !preview.evaluation ||
    preview.pilotId
  )
    throw new Error(
      "Run a private evaluation case before requesting its review."
    );
  return {
    title: preview.title,
    question: preview.question,
    criteria: preview.evaluation.case.criteria,
    response: preview.response,
    reviewRevision: preview.review?.revision ?? null,
  };
}

async function save(
  input: z.infer<typeof creatorPreviewReviewSaveSchema>,
  context: WorkflowStepToolContext
) {
  "use step";
  const actor = await workspaceActorFromPrincipal(
    context.session.auth.current ?? undefined
  );
  await requireCreator(actor);
  return saveCreatorPreviewReview(actor, input);
}
