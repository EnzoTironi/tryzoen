import { withSignal } from "../../operations/async";
import { z } from "zod";

import { defineDynamic, defineTool } from "eve/tools";
import { always } from "eve/tools/approval";
import { OntologyActionSchema } from "@shared/workspaces/ontology";
import { authorizeApprovalResponse } from "../../../agent/lib/approval-response";
import { workspaceOperationId } from "../../../agent/lib/workspace-operation";
import {
  WorkspaceAccessDenied,
  workspaceActorFromPrincipal,
} from "../../workspaces/access";
import { readWorkspaceCapabilities } from "../../workspaces/capabilities";
import { applyOntologyAction } from "../../workspaces/ontology";
import { GitRevisionSchema } from "../../workspaces/git";

export const ontologyActionInputSchema = z.object({
  ...OntologyActionSchema.shape,
  expectedRevision: GitRevisionSchema,
  approvalMessage: z.string().regex(/\S/u).min(1).max(16_384),
});

export default defineDynamic({
  events: {
    "turn.started": (_event, context) => {
      if (context.session.auth.current?.authenticator !== "authjs") return null;
      return {
        "ontology-action": defineTool({
          description:
            "Propose a declared action to a structured entity. First read workspace_ontology_read. Invoke this tool with the entity, action, proposed value, revision and approvalMessage; Eve presents the exact native approval before any mutation. Do not request approval by sending a chat message. Only workspace admins can execute actions. A stale revision must be re-read and approved again.",
          approval: { request: always(), response: authorizeApprovalResponse },
          inputSchema: ontologyActionInputSchema.strict(),
          execute: (input, execution) =>
            withSignal(execution.abortSignal, async () => {
              const actor = await workspaceActorFromPrincipal(
                execution.session.auth.current ?? undefined
              );
              if (
                !(await readWorkspaceCapabilities(actor)).enabled.includes(
                  "ontology"
                )
              )
                throw new WorkspaceAccessDenied();
              const result = await applyOntologyAction(actor, {
                ...input,
                operationId: workspaceOperationId(
                  execution.session.id,
                  execution.callId
                ),
              });
              return {
                status: "completed" as const,
                entityId: input.entityId,
                actionId: input.actionId,
                value: input.value,
                revision: result.revision,
              };
            }),
        }),
      };
    },
  },
});
