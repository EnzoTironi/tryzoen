import { defineWorkflowTool, type WorkflowStepToolContext } from "eve/tools";
import type { z } from "zod";
import { workspaceActorFromPrincipal } from "../../server/workspaces/access";
import {
  CreatorDraftConflict,
  readCreatorDraft,
} from "../../server/creators/drafts";
import {
  creatorEvaluationRemoveSchema,
  removeCreatorEvaluationCase,
} from "../../server/creators/evaluation";

export default defineWorkflowTool({
  availableInSubagents: false,
  description:
    "Remove one predeclared creator evaluation case only after the person confirms the exact case in this chat. Read creator-library first for the draft ID, case ID and current evaluation revision. Adding or editing a case belongs to creator-library evaluation and preserves all other cases. The human alone answers the confirmation. Historical responses and reviews keep their original snapshots.",
  inputSchema: creatorEvaluationRemoveSchema,
  async execute(input, context) {
    "use workflow";
    const item = await inspect(input, context);
    if (!item) return { status: "already-removed" };
    const decision = await context.ask({
      prompt: `Remove this evaluation case?\n\n${item.title}\n\nQuestion: ${item.question}\n\nCriteria: ${item.criteria}\n\nHistorical responses and reviews will retain their original case.`,
      display: "confirmation",
      allowFreeform: false,
      options: [
        { id: "remove", label: "Remove evaluation case" },
        { id: "cancel", label: "Keep case" },
      ],
    });
    if (decision.optionId !== "remove") return { status: "cancelled" };
    await remove(input, context);
    return { status: "removed" };
  },
});

async function inspect(
  input: z.infer<typeof creatorEvaluationRemoveSchema>,
  context: WorkflowStepToolContext
) {
  "use step";
  const actor = await workspaceActorFromPrincipal(
    context.session.auth.current ?? undefined
  );
  const draft = await readCreatorDraft(actor, input.draftId);
  if (draft.archivedAt) throw new CreatorDraftConflict();
  const item = draft.evaluation?.cases.find(
    (candidate) => candidate.id === input.caseId
  );
  if (item && draft.evaluation?.revision !== input.expectedRevision)
    throw new CreatorDraftConflict();
  return item ?? null;
}

async function remove(
  input: z.infer<typeof creatorEvaluationRemoveSchema>,
  context: WorkflowStepToolContext
) {
  "use step";
  const actor = await workspaceActorFromPrincipal(
    context.session.auth.current ?? undefined
  );
  return removeCreatorEvaluationCase(actor, input);
}
