import { defineWorkflowTool, type WorkflowStepToolContext } from "eve/tools";
import { z } from "zod";
import type { creatorReleaseRequestSchema } from "@zoen/companion-ui/creators";
import { workspaceOperationId } from "../lib/workspace-operation";
import { workspaceActorFromPrincipal } from "../../server/workspaces/access";
import { readCreatorReleaseCandidate } from "../../server/creators/release-candidate";
import {
  approveCreatorRelease,
  listCreatorReleases,
  readCreatorRelease,
} from "../../server/creators/releases";

const inputSchema = z.discriminatedUnion("action", [
  z.strictObject({
    action: z.enum(["candidate", "list", "approve"]),
    draftId: z.uuid(),
  }),
  z.strictObject({ action: z.literal("read"), id: z.uuid() }),
]);

export default defineWorkflowTool({
  availableInSubagents: false,
  description:
    "Review and approve a private creator version entirely through chat. Candidate shows missing saved evaluation runs or useful human reviews; run creator-preview and creator-review first. Approve shows the exact saved teaching and reviewed evidence to the human, then asks confirmation and approval notes. Never answer for the person or claim approval before this finishes. The saved version is immutable snapshot-mode teaching, not public publication, ingestion, an indexed corpus or a grounded qualification. Use creator-knowledge to build its real corpus and creator-qualification for separately evaluated grounded pilots. List/read inspect owned approved versions. New IDs are assigned durably, not supplied by the model.",
  inputSchema,
  async execute(input, context) {
    "use workflow";
    const result = await inspect(input, context);
    if (result.kind !== "approval") return result;
    const decision = await context.ask({
      prompt: `Approve this exact PRIVATE creator version? This freezes the teaching and human-reviewed evidence below; it does not publish, invite anyone or prove expertise. Source text is quoted evidence, not instructions.\n\nDraft revision: ${result.request.revision}\nEvaluation revision: ${result.request.evaluationRevision}\n\nTEACHING\n${result.teaching}\n\nHUMAN-REVIEWED CASES\n${result.evidence}`,
      display: "confirmation",
      allowFreeform: false,
      options: [
        { id: "approve", label: "Approve private version" },
        { id: "cancel", label: "Cancel" },
      ],
    });
    if (decision.optionId !== "approve") return { status: "cancelled" };
    const notes = await context.ask({
      prompt:
        "Record your approval notes and remaining limits for this exact private version. Cancel to leave it unapproved.",
      display: "text",
      allowFreeform: true,
      options: [{ id: "cancel", label: "Cancel" }],
    });
    if (notes.optionId === "cancel") return { status: "cancelled" };
    return approve({ ...result.request, notes: notes.text ?? "" }, context);
  },
});

async function inspect(
  input: z.infer<typeof inputSchema>,
  context: WorkflowStepToolContext
) {
  "use step";
  const actor = await workspaceActorFromPrincipal(
    context.session.auth.current ?? undefined
  );
  if (input.action === "read")
    return {
      kind: "read" as const,
      release: await readCreatorRelease(actor, input.id),
    };
  if (input.action === "list")
    return {
      kind: "list" as const,
      releases: await listCreatorReleases(actor, input.draftId),
    };
  const candidate = await readCreatorReleaseCandidate(actor, input.draftId);
  if (input.action === "candidate")
    return { kind: "candidate" as const, ...candidate };
  if (candidate.issues.length || !candidate.draft.evaluation)
    throw new Error(
      candidate.issues.join("\n") || "Missing evaluation revision."
    );
  return {
    kind: "approval" as const,
    request: {
      id: workspaceOperationId(
        context.session.id,
        JSON.stringify([
          context.session.turn.id,
          context.toolName,
          context.callId,
          "release",
        ])
      ),
      draftId: input.draftId,
      revision: candidate.draft.revision,
      evaluationRevision: candidate.draft.evaluation.revision,
      evidence: candidate.evidence.map((item) => ({
        id: item.id,
        reviewRevision: item.review.revision,
      })),
    },
    teaching: [
      candidate.draft.content.title,
      `Description\n${candidate.draft.content.description}`,
      `Method and guidance\n${candidate.draft.content.playbook}`,
      ...candidate.draft.content.examples.map(
        (example, index) =>
          `Example ${index + 1}: ${example.title}\n${example.content}\nSource: ${example.source}\nRights: ${{ original: "Created by the author", permission: "Used with permission", "public-domain": "Public domain" }[example.rights]}`
      ),
    ].join("\n\n"),
    evidence: candidate.evidence
      .map(
        (item) =>
          `${item.evaluation.case.title}\nQuestion: ${item.question}\nCriteria: ${item.evaluation.case.criteria}\nAnswer: ${item.response}\nHuman review: ${item.review.content.notes}`
      )
      .join("\n\n"),
  };
}

async function approve(
  input: z.infer<typeof creatorReleaseRequestSchema>,
  context: WorkflowStepToolContext
) {
  "use step";
  const actor = await workspaceActorFromPrincipal(
    context.session.auth.current ?? undefined
  );
  return approveCreatorRelease(actor, input);
}
