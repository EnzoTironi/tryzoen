import { defineWorkflowTool, type WorkflowStepToolContext } from "eve/tools";
import { z } from "zod";
import { workspaceActorFromPrincipal } from "../../server/workspaces/access";
import { workspaceOperationId } from "../lib/workspace-operation";
import {
  readCreatorQualificationCandidate,
  readCreatorQualification,
  listCreatorQualifications,
  approveCreatorQualification,
} from "../../server/creators/qualifications";
import type { creatorQualificationRequestSchema } from "@zoen/companion-ui/creators";
const inputSchema = z.discriminatedUnion("action", [
  z.strictObject({
    action: z.enum(["candidate", "list", "approve"]),
    releaseId: z.uuid(),
  }),
  z.strictObject({ action: z.literal("read"), id: z.uuid() }),
]);
export default defineWorkflowTool({
  availableInSubagents: false,
  description:
    "Qualify an already approved private creator release for grounded pilots. Candidate reports missing predeclared cases, actual grounded responses or human reviews. At least one supported and one insufficient-evidence case must match expectations and both need useful human reviews. Declare expectedGrounding in creator-library evaluation before running; use creator-review for human assessment. Approve displays the exact evidence to the person and asks their confirmation and notes; the model must never answer those questions. This creates a new immutable private qualification, not publication or a change to existing snapshot pilots. List/read return qualifications. No caller-supplied new UUID is needed.",
  inputSchema,
  async execute(input, context) {
    "use workflow";
    const result = await inspect(input, context);
    if (input.action !== "approve" || result.kind !== "approval") return result;
    const decision = await context.ask({
      prompt: `Approve a new PRIVATE grounded qualification for ${result.title}? Existing releases and pilots stay in their recorded mode. This is not proof of expertise or public publication.\n\nCorpus SHA256: ${result.request.manifestDigest}\n\nHuman-reviewed evaluation evidence:\n${result.summary}`,
      display: "confirmation",
      allowFreeform: false,
      options: [
        { id: "approve", label: "Approve private grounded version" },
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
      qualification: await readCreatorQualification(actor, input.id),
    };
  if (input.action === "list")
    return {
      kind: "list" as const,
      qualifications: await listCreatorQualifications(actor, input.releaseId),
    };
  const candidate = await readCreatorQualificationCandidate(
    actor,
    input.releaseId
  );
  if (input.action === "candidate")
    return { kind: "candidate" as const, ...candidate };
  if (candidate.issues.length || !candidate.evaluationRevision)
    throw new Error(
      candidate.issues.join("\n") || "Missing evaluation revision."
    );
  return {
    kind: "approval" as const,
    title: candidate.title,
    request: {
      id: workspaceOperationId(
        context.session.id,
        JSON.stringify([
          context.session.turn.id,
          context.toolName,
          context.callId,
          "qualification",
        ])
      ),
      releaseId: input.releaseId,
      manifestDigest: candidate.manifestDigest,
      evaluationRevision: candidate.evaluationRevision,
      evidence: candidate.evidence.map((item) => ({
        id: item.id,
        reviewRevision: item.review.revision,
      })),
    },
    summary: candidate.evidence
      .map(
        (item) =>
          `${item.evaluation.case.title}\nQuestion: ${item.question}\nExpected: ${item.evaluation.case.expectedGrounding}\nActual: ${item.groundedAnswer.status}\nAnswer: ${item.response}\nHuman review: ${item.review.content.notes}`
      )
      .join("\n\n"),
  };
}
async function approve(
  input: z.infer<typeof creatorQualificationRequestSchema>,
  context: WorkflowStepToolContext
) {
  "use step";
  const actor = await workspaceActorFromPrincipal(
    context.session.auth.current ?? undefined
  );
  return approveCreatorQualification(actor, input);
}
