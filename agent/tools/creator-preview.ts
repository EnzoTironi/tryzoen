import { defineWorkflowTool, type WorkflowStepToolContext } from "eve/tools";
import { z } from "zod";
import { creatorGroundedAnswerSchema } from "@zoen/companion-ui/creators";
import { workspaceActorFromPrincipal } from "../../server/workspaces/access";
import {
  claimCreatorPreview,
  finishCreatorPreview,
} from "../../server/creators/previews";

export default defineWorkflowTool({
  availableInSubagents: false,
  description:
    "Execute a private preview or playbook-proposal request created through creator-library or Creator studio. Supply only its request UUID. The workflow loads its task kind and exact authorized sources and sends them to an isolated specialist with no tools or personal memory. Do not substitute a normal chat answer or claim success without this tool. Read the actual result with creator-library and use creator-review to ask the person to review a completed evaluation in this conversation. This does not change the playbook, publish or approve a release.",
  inputSchema: z.strictObject({ id: z.uuid() }),
  async execute({ id }, context) {
    "use workflow";
    const snapshot = await claim(id, context);
    let response: string | z.infer<typeof creatorGroundedAnswerSchema> | null;
    try {
      if (snapshot.kind === "grounded-answer") {
        const result = await context.agent("creator-specialist", {
          message: JSON.stringify(snapshot),
          outputSchema: z
            .record(z.string(), z.json())
            .parse(z.toJSONSchema(creatorGroundedAnswerSchema)),
        });
        response = creatorGroundedAnswerSchema.parse(result);
      } else {
        const result = await context.agent("creator-specialist", {
          message: JSON.stringify(snapshot),
        });
        response = typeof result === "string" ? result : null;
      }
    } catch {
      // Persist a clear failure without copying provider errors or private context.
      response = null;
    }
    return finish(id, response, context);
  },
});

async function claim(id: string, context: WorkflowStepToolContext) {
  "use step";
  const actor = await workspaceActorFromPrincipal(
    context.session.auth.current ?? context.session.auth.initiator ?? undefined
  );
  return claimCreatorPreview(
    actor,
    id,
    `${context.session.id}:${context.callId}`,
    { sessionId: context.session.id, turnId: context.session.turn.id }
  );
}

async function finish(
  id: string,
  response: string | z.infer<typeof creatorGroundedAnswerSchema> | null,
  context: WorkflowStepToolContext
) {
  "use step";
  const actor = await workspaceActorFromPrincipal(
    context.session.auth.current ?? context.session.auth.initiator ?? undefined
  );
  const answer = z
    .union([z.string().trim().min(1).max(32000), creatorGroundedAnswerSchema])
    .safeParse(response);
  return finishCreatorPreview(
    actor,
    id,
    `${context.session.id}:${context.callId}`,
    answer.success ? answer.data : null
  );
}
