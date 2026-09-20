import { isValid } from "@shared/validation";
import { z } from "zod";
import { defineEval } from "eve/evals";
import { equals, includes } from "eve/evals/expect";

import { sendMessageOutputSchema } from "../../shared/chat/message-delivery";

const fixtureSchema = z.object({
  variants: z.array(
    z.object({
      language: z.string(),
      canary: z.string(),
      skill: z.string(),
      source: z.string(),
      destination: z.string(),
    })
  ),
  privateCanary: z.string(),
});
const fileSchema = z.object({
  revision: z.string(),
  content: z.string(),
});
const prompts = [
  (skill: string) =>
    `Follow the published ${skill} procedure in this workspace. Verify the saved result and tell me its exact release code and saved Git revision. Do not send external messages.`,
  (skill: string) =>
    `Siga a skill publicada ${skill} neste espaço. Confira o arquivo salvo e me diga o código exato da versão e a revisão salva no Git. Não envie mensagens externas.`,
  (skill: string) =>
    `Sigue el procedimiento publicado ${skill} en este espacio. Verifica el archivo guardado e indica su código exacto y la revisión guardada en Git. No envíes mensajes externos.`,
];

export default prompts.map((prompt, index) =>
  defineEval({
    description: `Discover a versioned skill, persist its result and verify it (variant ${String(index + 1)})`,
    tags: ["launch", "tools", "git", "live-model", "synthetic-data"],
    timeoutMs: 180_000,
    async test(t) {
      const metadata = await t.target.fetch("/_eval/fixture");
      const fixture = fixtureSchema.parse(await metadata.json());
      const variant = fixture.variants[index];
      if (!variant) throw new Error("The isolated launch fixture is required.");
      const turn = await t.send(prompt(variant.skill));
      turn.succeeded();
      // Definitive preflight denials are safe to correct. An execution failure
      // with an uncertain write outcome remains a release-blocking error.
      const attempts = turn.toolCalls.filter(
        (call) => call.status === "failed"
      ).length;
      t.check(attempts, equals(0))
        .soft()
        .label("scenario without failed tool attempts");
      turn
        .calledTool("workspace-save", {
          status: "failed",
          output: (output) =>
            !isValid(
              z.object({ code: z.literal("TOOL_EXECUTION_DENIED") }),
              output
            ),
          count: 0,
        })
        .label("no uncertain write failure");
      turn.maxToolCalls(24);
      const saved = await t.target.fetch(
        `/_eval/file?path=${encodeURIComponent(variant.destination)}`
      );
      await t.require(saved.ok, equals(true));
      const file = fileSchema.parse(await saved.json());
      const delivered =
        turn.toolCalls
          .flatMap((call) => {
            if (call.name !== "send_message" || call.status !== "completed")
              return [];
            const message = sendMessageOutputSchema.safeParse(call.output);
            return message.success && message.data.kind === "message"
              ? [message.data.text]
              : [];
          })
          .join("\n") || turn.message;
      t.check(file.content, includes(variant.canary));
      t.check(delivered, includes(variant.canary));
      t.check(delivered, includes(file.revision));
      turn.calledTool("workspace_skills_load", {
        count: (count) => count >= 1,
        status: "completed",
        output: (output) =>
          isValid(
            z.object({
              execution: z.literal("instructions"),
              path: z.literal(variant.skill),
              revision: z.string().regex(/^[a-f0-9]{40}$/),
              instructions: z
                .string()
                .includes(variant.source)
                .includes(variant.destination),
            }),
            output
          ),
      });
      t.check(
        turn.toolCalls.filter(
          (call) =>
            call.status === "completed" && call.name === "workspace-save"
        ).length,
        equals(1)
      ).label("one durable save");
      t.check(
        JSON.stringify(turn.events).includes(fixture.privateCanary),
        equals(false)
      ).label("personal data isolated");
    },
  })
);
