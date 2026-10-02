import { GitRevisionSchema } from "@zoen/companion-ui/workspace-files";
import { withSignal } from "../../operations/async";
import { z } from "zod";

import { defineDynamic, defineTool } from "eve/tools";
import { always } from "eve/tools/approval";
import { OntologyActionSchema } from "@zoen/companion-ui/ontology";
import { authorizeApprovalResponse } from "../../../agent/lib/approval-response";
import { workspaceOperationId } from "../../../agent/lib/workspace-operation";
import {
  WorkspaceAccessDenied,
  workspaceActorFromPrincipal,
} from "../../workspaces/access";
import { readWorkspaceCapabilities } from "../../workspaces/capabilities";
import { applyOntologyAction } from "../../workspaces/ontology";

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
            "Propose a declared action to a structured entity. First read workspace_ontology_read with {} to discover current actions and their revision. Do not pass a revision, asOf or validOn from a knowledge read: those read-only projections hide actions. If a historical read returned no actions, read the current graph before concluding that an action is unavailable. Invoke with the entity, action, value, sources, validTime, revision and approvalMessage; Eve presents the exact native approval before mutation. sources are authorized knowledge file citations with path, Git revision and exact excerpt. Pass [] for a manually entered value; do not inherit citations for a previous value. validTime is null when world-valid dates are unknown, otherwise {from:<ISO date or null>,until:<exclusive ISO date or null>} and requires cited evidence. Publication timestamps are not world-valid dates. Do not request approval by sending a chat message. Only workspace admins can execute actions. A stale revision must be re-read and approved again.",
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
