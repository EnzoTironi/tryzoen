import { defineTool } from "eve/tools";
import { always } from "eve/tools/approval";
import { z } from "zod";
import { authorizeApprovalResponse } from "../../../../../agent/lib/approval-response";
import { workspaceActorFromPrincipal } from "../../../../../server/workspaces/access";
import { WorkspaceRepository } from "../../../../../server/workspaces/repository";
import { workspaceOperationId } from "../../../../../agent/lib/workspace-operation";

export default defineTool({
  description:
    "Synthetic group action which persists only after the requester consents.",
  inputSchema: z.strictObject({ text: z.string() }),
  approval: { request: always(), response: authorizeApprovalResponse },
  async execute(input, context) {
    const actor = await workspaceActorFromPrincipal(
      context.session.auth.current ?? undefined
    );
    const current = await WorkspaceRepository.read(actor);
    return WorkspaceRepository.write(actor, {
      path: "knowledge/approved-group-action.md",
      content: input.text,
      expectedRevision: current.revision,
      operationId: workspaceOperationId(context.session.id, context.callId),
    });
  },
});
