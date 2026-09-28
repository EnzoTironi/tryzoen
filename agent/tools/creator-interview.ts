import { defineWorkflowTool, type WorkflowStepToolContext } from "eve/tools";
import { z } from "zod";
import { creatorDraftSaveSchema } from "@zoen/companion-ui/creators";
import { workspaceActorFromPrincipal } from "../../server/workspaces/access";
import {
  CreatorDraftConflict,
  readCreatorDraft,
  saveCreatorDraft,
} from "../../server/creators/drafts";

export default defineWorkflowTool({
  availableInSubagents: false,
  description:
    "Offer a guided starting interview for an existing private creator draft. Read or save its title/description with creator-library first; pass its exact current revision. The person answers optional questions about audience, approach and limits, then reviews the exact private playbook addition before saving. They can skip or cancel. This is optional starting material, not a mandatory questionnaire, a complete specialist, source ingestion, evaluation or publication. Continue adaptive follow-ups in normal conversation afterward. Never answer these human questions yourself.",
  inputSchema: creatorDraftSaveSchema
    .pick({ id: true, expectedRevision: true })
    .extend({ expectedRevision: z.uuid() }),
  async execute(input, context) {
    "use workflow";
    const draft = await read(input.id, input.expectedRevision, context);
    const additions: string[] = [];
    for (const question of [
      {
        title: "Audience and purpose",
        prompt: `Who should ${draft.content.title} help, and what should it help them accomplish? Share only what you want included in its private draft guidance.`,
      },
      {
        title: "Approach and voice",
        prompt:
          "How would you approach a typical request? Describe your method and the voice you want the bot to use, with a brief example if useful.",
      },
      {
        title: "Limits and escalation",
        prompt:
          "What should the bot avoid, and when should it ask a person for help or say it does not know?",
      },
    ]) {
      const answer = await context.ask({
        prompt: `${question.prompt}\n\nYou can skip this question. Keep each answer within 4,000 characters.`,
        display: "text",
        allowFreeform: true,
        options: [
          { id: "skip", label: "Skip this question" },
          { id: "cancel", label: "Cancel interview" },
        ],
      });
      if (answer.optionId === "cancel") return { status: "cancelled" };
      if (answer.optionId === "skip") continue;
      const text = z.string().trim().min(1).max(4000).parse(answer.text);
      additions.push(`### ${question.title}\n\n${text}`);
    }
    if (!additions.length) return { status: "unchanged", id: draft.id };
    const proposed = creatorDraftSaveSchema.parse({
      id: draft.id,
      expectedRevision: draft.revision,
      content: {
        ...draft.content,
        playbook: `${draft.content.playbook}${draft.content.playbook ? "\n\n" : ""}## Creator interview\n\n${additions.join("\n\n")}`,
      },
    });
    const decision = await context.ask({
      prompt: `Save this exact playbook for ${draft.content.title}? Your earlier guidance is preserved. This stays private and does not publish or approve the bot.\n\n${proposed.content.playbook}`,
      display: "confirmation",
      allowFreeform: false,
      options: [
        { id: "save", label: "Save private guidance" },
        { id: "cancel", label: "Cancel without changes" },
      ],
    });
    if (decision.optionId !== "save") return { status: "cancelled" };
    return save(proposed, context);
  },
});

async function read(
  id: string,
  revision: string,
  context: WorkflowStepToolContext
) {
  "use step";
  const actor = await workspaceActorFromPrincipal(
    context.session.auth.current ?? undefined
  );
  const draft = await readCreatorDraft(actor, id);
  if (draft.archivedAt || draft.revision !== revision)
    throw new CreatorDraftConflict();
  return draft;
}

async function save(
  input: z.infer<typeof creatorDraftSaveSchema>,
  context: WorkflowStepToolContext
) {
  "use step";
  const actor = await workspaceActorFromPrincipal(
    context.session.auth.current ?? undefined
  );
  const draft = await saveCreatorDraft(actor, input);
  return { status: "saved", id: draft.id, revision: draft.revision };
}
