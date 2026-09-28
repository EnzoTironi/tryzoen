import { defineAgent, defineDynamic } from "eve";
import { mockModel } from "eve/evals";
import agent from "../../../../../../agent/subagents/creator-specialist/agent";

export default defineAgent({
  description: agent.description,
  tool: agent.tool,
  defaultTools: agent.defaultTools,
  limits: agent.limits,
  model: defineDynamic({
    events: {
      "step.started": () => ({
        modelContextWindowTokens: 128000,
        model: mockModel(({ tools, messages, lastUserMessage }) => {
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
        }),
      }),
    },
  }),
});
