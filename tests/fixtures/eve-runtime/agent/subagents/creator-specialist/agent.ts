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
        const model = mockModel(({ tools, messages, lastUserMessage }) => {
          if (lastUserMessage?.includes("synthetic-provider-failure"))
            throw new Error("Synthetic provider failure");
          return {
            toolCalls: [
              {
                name: "final_output",
                input: {
                  response: JSON.stringify({
                    tools: tools.map((tool) => tool.name),
                    messages,
                  }),
                },
              },
            ],
          };
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
