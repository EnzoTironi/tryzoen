import { defineAgent, defineDynamic } from "eve";
import { mockModel } from "eve/evals";
import { recordCreatorPreviewModel } from "../../../../../../server/creators/execution";
import { workspaceActorFromPrincipal } from "../../../../../../server/workspaces/access";
import { previewOrigin } from "../../../../../../agent/subagents/creator-specialist/lib/preview";
import agent from "../../../../../../agent/subagents/creator-specialist/agent";

export default defineAgent({
  description: agent.description,
  tool: agent.tool,
  defaultTools: agent.defaultTools,
  limits: agent.limits,
  model: defineDynamic({
    events: {
      "step.started": async (_event, context) => {
        const model = mockModel(({ tools, messages, userMessages }) => {
          // Eve may append an empty-answer retry; keep the original scenario.
          const scenario = userMessages.join("\n");
          if (scenario.includes("synthetic-provider-failure"))
            throw new Error("Synthetic provider failure");
          if (scenario.includes("synthetic-blank-answer")) return "   ";
          if (scenario.includes("synthetic-oversized-answer"))
            return "x".repeat(32001);
          return JSON.stringify({
            tools: tools.map((tool) => tool.name),
            messages,
          });
        });
        const actor = await workspaceActorFromPrincipal(
          context.session.auth.current ?? undefined
        );
        const origin = previewOrigin.get();
        if (!origin) throw new Error("Expected private preview lineage");
        if (typeof model === "string")
          throw new Error("Expected an instantiated test model");
        await recordCreatorPreviewModel(actor, origin, {
          provider: model.provider,
          modelId: model.modelId,
        });
        return { modelContextWindowTokens: 128000, model };
      },
    },
  }),
});
