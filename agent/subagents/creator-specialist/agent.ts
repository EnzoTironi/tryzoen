import { defineAgent, defineDynamic } from "eve";
import {
  workspaceActorFromPrincipal,
  requireWorkspaceAccess,
  WorkspaceAccessDenied,
} from "../../../server/workspaces/access";
import { workspaceModel } from "../../lib/workspace-model";
import { installationModel } from "../../lib/installation-model";
import { getGatewayModel } from "@db/services/settings";
import { recordCreatorPreviewModel } from "../../../server/creators/execution";
import { withModelDeadline } from "../../lib/model-deadline";
import { previewOrigin } from "./lib/preview";

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
        const origin = previewOrigin.get();
        if (
          !actor.authSessionId ||
          actor.groupBindingId ||
          actor.protocolTaskId ||
          !origin
        )
          throw new WorkspaceAccessDenied();
        const selection = (await workspaceModel(actor)) ??
          (await installationModel()) ?? {
            model: withModelDeadline(await getGatewayModel(actor)),
          };
        await recordCreatorPreviewModel(actor, origin, {
          provider: selection.model.provider,
          modelId: selection.model.modelId,
        });
        return selection;
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
