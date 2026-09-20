import { z } from "zod";
import { createOpenRouter } from "@openrouter/ai-sdk-provider";
import { env } from "@shared/environment/env";
import { chatgpt } from "eve/models/openai";
import type { AgentModelOptionsDefinition } from "eve";
import { withModelDeadline } from "./model-deadline";
import { codexModelSchema } from "@shared/environment/model-provider";

function codexSelection(model: z.output<typeof codexModelSchema>) {
  const modelOptions: AgentModelOptionsDefinition = {
    providerOptions: { openai: { reasoningSummary: null } },
  };
  return {
    model: withModelDeadline(chatgpt(model)),
    modelContextWindowTokens:
      model === "gpt-5.3-codex-spark" ? 128_000 : 272_000,
    modelOptions,
  };
}

export const installationModel = async () => {
  const provider = env.COMPANION_MODEL_PROVIDER ?? "gateway";
  if (provider === "gateway") return null;
  if (provider === "codex-local") {
    const model = env.COMPANION_CODEX_MODEL ?? "gpt-5.3-codex-spark";
    return codexSelection(model);
  }

  const key = env.OPENROUTER_API_KEY;
  if (!key) throw new Error("OPENROUTER_API_KEY is required for OpenRouter");
  const openrouter = createOpenRouter({
    apiKey: key.reveal(),
    compatibility: "strict",
    extraBody: {
      provider: {
        allow_fallbacks: false,
        max_price: { prompt: 0, completion: 0, request: 0 },
      },
    },
  });
  return {
    model: withModelDeadline(openrouter("nvidia/nemotron-3.5-lightning:free")),
    modelContextWindowTokens: 1_000_000,
  };
};

export const browserInstallationModel = async () => {
  const provider = env.COMPANION_BROWSER_MODEL_PROVIDER ?? "gateway";
  const model = (
    provider === "codex-local"
      ? codexModelSchema
      : z.enum(["meta/muse-spark-1.3", "openai/gpt-5-mini"])
  ).parse(
    env.COMPANION_BROWSER_MODEL ??
      (provider === "codex-local"
        ? "gpt-5.3-codex-spark"
        : "meta/muse-spark-1.3")
  );
  if (provider === "codex-local")
    return codexSelection(await codexModelSchema.parseAsync(model));
  if (provider === "gateway")
    return { model: withModelDeadline(model), modelOptions: undefined };

  const key = env.OPENROUTER_API_KEY;
  if (!key) throw new Error("OPENROUTER_API_KEY is required for OpenRouter");
  const openrouter = createOpenRouter({
    apiKey: key.reveal(),
    compatibility: "strict",
    extraBody: { provider: { allow_fallbacks: false } },
  });
  const modelOptions: AgentModelOptionsDefinition = {
    providerOptions: { openrouter: { max_tokens: 4_096 } },
  };
  return {
    model: withModelDeadline(openrouter(model)),
    modelContextWindowTokens:
      model === "meta/muse-spark-1.3" ? 1_048_576 : 400_000,
    modelOptions,
  };
};
