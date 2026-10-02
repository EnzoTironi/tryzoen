import { defineAgent, defineDynamic } from "eve";
import { mockModel } from "eve/evals";
import { query } from "@db/queries";
import { sql } from "drizzle-orm";

export default defineAgent({
  experimental: { workflow: { world: "@workflow/world-postgres" } },
  model: defineDynamic({
    events: {
      "step.started": async (_event, context) => {
        const taskId = context.session.auth.current?.attributes.protocolTaskId;
        const workspaceId =
          context.session.auth.current?.attributes.workspaceId;
        if (typeof taskId === "string" && typeof workspaceId === "string") {
          const paused =
            await query(sql`SELECT t.session_id FROM agent_protocol_tasks t
        WHERE t.id = ${taskId} AND t.prompt = 'pause-before-action'
          AND EXISTS (SELECT 1 FROM native_delivery_receipts r WHERE r.workspace_id = ${workspaceId} AND r.input_id LIKE 'a2a-input:%' AND r.session_id = t.session_id)`);
          if (paused.length) {
            const first =
              await query(sql`INSERT INTO native_delivery_receipts(workspace_id, input_id, session_id, digest)
          SELECT ${workspaceId}, ${`fixture-pause:${taskId}`}, session_id, ${"0".repeat(64)} FROM agent_protocol_tasks WHERE id = ${taskId}
          ON CONFLICT DO NOTHING RETURNING input_id`);
            // Fixture-only interruption after SQL acknowledgement, before continuation action.
            if (first.length)
              await new Promise<never>(() => {
                /* Hold the fixture until its process is stopped. */
              });
          }
        }
        return {
          modelContextWindowTokens: 128000,
          model: mockModel(({ toolResults, userMessages }) => {
            if (userMessages.includes("human-approval"))
              return { toolCalls: [{ name: "human-action", input: {} }] };
            if (!toolResults.some((result) => result.name === "ask_question"))
              return {
                text: "Question preamble.",
                toolCalls: [
                  {
                    name: "ask_question",
                    input: {
                      prompt: "Which release day?",
                      options: [{ id: "friday", label: "Friday" }],
                      allowFreeform: false,
                    },
                  },
                ],
              };
            if (!toolResults.some((result) => result.name === "after-question"))
              return { toolCalls: [{ name: "after-question", input: {} }] };
            return JSON.stringify({ toolResults });
          }),
        };
      },
    },
  }),
});
