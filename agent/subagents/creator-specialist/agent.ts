import { defineAgent, defineDynamic } from "eve";
import {
  workspaceActorFromPrincipal,
  requireWorkspaceAccess,
  WorkspaceAccessDenied,
} from "../../../server/workspaces/access";
import { workspaceModel } from "../../lib/workspace-model";
import { installationModel } from "../../lib/installation-model";
import { getGatewayModel } from "@db/services/settings";
import { withModelDeadline } from "../../lib/model-deadline";

export default defineAgent({
  description:
    "Run one private creator playbook preview from an immutable, authorized snapshot. No tools, memory, connections or skills.",
  tool: false,
  defaultTools: false,
  model: defineDynamic({
    events: {
      "step.started": async (_event, context) => {
        const actor = await workspaceActorFromPrincipal(
          context.session.auth.current ??
            context.session.auth.initiator ??
            undefined
        );
        await requireWorkspaceAccess(actor);
        if (
          !actor.authSessionId ||
          actor.groupBindingId ||
          actor.protocolTaskId
        )
          throw new WorkspaceAccessDenied();
        return (
          (await workspaceModel(actor)) ??
          (await installationModel()) ??
          withModelDeadline(await getGatewayModel(actor))
        );
      },
    },
  }),
  reasoning: "low",
  limits: {
    maxInputTokensPerSession: 24000,
    maxOutputTokensPerSession: 4000,
    maxTokenCostUsdPerSession: 0.5,
    sessionTimeoutMs: 120000,
  },
});
