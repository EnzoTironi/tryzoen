import { defineWorkflowTool, type WorkflowStepToolContext } from "eve/tools";
import { z } from "zod";
import { workspaceActorFromPrincipal } from "../../server/workspaces/access";
import {
  claimCreatorPreview,
  finishCreatorPreview,
} from "../../server/creators/previews";

export default defineWorkflowTool({
  availableInSubagents: false,
  description:
    "Execute a private preview request already created by the user in Creator studio. Supply only its preview UUID. The saved playbook, examples and question are loaded by the workflow and sent to an isolated specialist with no tools or personal memory. Do not substitute a normal chat answer or claim a preview succeeded without this tool. Results appear in Creator studio; this does not publish or evaluate a release.",
  inputSchema: z.strictObject({ id: z.uuid() }),
  async execute({ id }, context) {
    "use workflow";
    const snapshot = await claim(id, context);
    let response: string | null;
    try {
      const result = await context.agent("creator-specialist", {
        message: JSON.stringify(snapshot),
        outputSchema: {
          type: "object",
          properties: { response: { type: "string" } },
          required: ["response"],
          additionalProperties: false,
        },
      });
      response = result.response;
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
  response: string | null,
  context: WorkflowStepToolContext
) {
  "use step";
  const actor = await workspaceActorFromPrincipal(
    context.session.auth.current ?? context.session.auth.initiator ?? undefined
  );
  const answer = z.string().trim().min(1).max(32000).safeParse(response);
  return finishCreatorPreview(
    actor,
    id,
    `${context.session.id}:${context.callId}`,
    answer.success ? answer.data : null
  );
}
