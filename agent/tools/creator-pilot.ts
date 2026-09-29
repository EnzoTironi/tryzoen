import { defineWorkflowTool, type WorkflowStepToolContext } from "eve/tools";
import { z } from "zod";
import {
  creatorPilotInviteSchema,
  creatorPilotActionSchema,
} from "@zoen/companion-ui/creators";
import { workspaceOperationId } from "../lib/workspace-operation";
import { workspaceActorFromPrincipal } from "../../server/workspaces/access";
import { readCreatorQualification } from "../../server/creators/qualifications";
import { readCreatorRelease } from "../../server/creators/releases";
import {
  listCreatorPilots,
  inviteCreatorPilot,
  actOnCreatorPilot,
} from "../../server/creators/pilots";
const inputSchema = z.discriminatedUnion("action", [
  z.strictObject({
    action: z.literal("invite"),
    qualificationId: z.uuid(),
    username: creatorPilotInviteSchema.shape.username,
  }),
  creatorPilotActionSchema,
]);
export default defineWorkflowTool({
  availableInSubagents: false,
  description:
    "Invite a named existing workspace member to a new private grounded creator qualification, or accept/decline/withdraw a pilot. This always asks the human before changing access; never invent their confirmation. Invitation shares the approved teaching, not participant chats or personal memory. Existing snapshot pilots are unchanged. Once accepted, use creator-library pilot to read the authorized mode and create a preview with that pilotId and kind grounded-answer, then creator-preview to execute; do not supply releaseId or evaluation cases for a participant question. No public marketplace publication or billing.",
  inputSchema,
  async execute(input, context) {
    "use workflow";
    const prepared = await prepare(input, context);
    const answer = await context.ask({
      prompt: prepared.prompt,
      display: "confirmation",
      allowFreeform: false,
      options: [
        { id: "confirm", label: prepared.label },
        { id: "cancel", label: "Cancel" },
      ],
    });
    if (answer.optionId !== "confirm") return { status: "cancelled" };
    return apply(prepared.request, context);
  },
});
async function prepare(
  input: z.infer<typeof inputSchema>,
  context: WorkflowStepToolContext
) {
  "use step";
  const actor = await workspaceActorFromPrincipal(
    context.session.auth.current ?? undefined
  );
  if (input.action === "invite") {
    const qualification = await readCreatorQualification(
      actor,
      input.qualificationId
    );
    const release = await readCreatorRelease(actor, qualification.releaseId);
    return {
      prompt: `Invite @${input.username} to ${release.content.title}, private grounded version ${qualification.id}? This shares the approved teaching and sources. Their private questions and answers are not shared with you. The person must accept.`,
      label: "Send private invitation",
      request: {
        action: "invite" as const,
        id: workspaceOperationId(
          context.session.id,
          JSON.stringify([
            context.session.turn.id,
            context.toolName,
            context.callId,
            "pilot",
          ])
        ),
        releaseId: release.id,
        qualificationId: qualification.id,
        username: input.username,
        shareTeaching: true as const,
      },
    };
  }
  const pilot = (await listCreatorPilots(actor)).find(
    (item) => item.id === input.id
  );
  if (!pilot) throw new Error("Private invitation not found.");
  return {
    prompt: `${input.action} the private ${pilot.answerMode} pilot for ${pilot.title}? Withdrawing stops future answers.`,
    label: input.action,
    request: input,
  };
}
async function apply(
  request:
    | ({ action: "invite" } & z.infer<typeof creatorPilotInviteSchema>)
    | z.infer<typeof creatorPilotActionSchema>,
  context: WorkflowStepToolContext
) {
  "use step";
  const actor = await workspaceActorFromPrincipal(
    context.session.auth.current ?? undefined
  );
  if (request.action !== "invite") return actOnCreatorPilot(actor, request);
  const { action: _action, ...invitation } = request;
  return inviteCreatorPilot(actor, invitation);
}
