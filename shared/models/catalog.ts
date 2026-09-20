import { z } from "zod";

export const ModelProviderSchema = z.enum(["chatgpt", "grok"]);
export const WorkspaceModelSchema = z.enum([
  "gpt-5.6-luna",
  "gpt-5.3-codex-spark",
  "grok-4.6",
]);
export const modelCatalog = {
  "gpt-5.6-luna": {
    provider: "chatgpt",
    label: "Luna · Light",
    context: 272_000,
    vision: true,
  },
  "gpt-5.3-codex-spark": {
    provider: "chatgpt",
    label: "Codex Spark",
    context: 128_000,
    vision: false,
  },
  "grok-4.6": {
    provider: "grok",
    label: "Grok 4.6 · Low",
    context: 500_000,
    vision: true,
  },
} as const;
export const defaultWorkspaceModel = {
  chatgpt: "gpt-5.6-luna",
  grok: "grok-4.6",
} as const;

export const ModelChallengeSchema = z.object({
  id: z.uuid(),
});

const modelConnectionMessages = {
  changed:
    "The model connection changed. Select the account for this workspace again.",
  rate_limited:
    "The connected model account reached its usage limit. Try again later.",
  denied: "The model account did not authorize this connection.",
  expired: "The model authorization expired. Start a new connection.",
  reconnect: "Reconnect the model account in Connections to continue.",
  invalid_response:
    "The model provider returned an invalid authorization response.",
  unavailable:
    "The model provider is temporarily unavailable. Try again later.",
};

export class ModelConnectionError extends Error {
  readonly _tag = "ModelConnectionError";
  declare readonly reason:
    | "unavailable"
    | "expired"
    | "denied"
    | "changed"
    | "invalid_response"
    | "reconnect"
    | "rate_limited";
  declare readonly status?: number | undefined;
  constructor(input: {
    readonly reason:
      | "unavailable"
      | "expired"
      | "denied"
      | "changed"
      | "invalid_response"
      | "reconnect"
      | "rate_limited";
    readonly status?: number | undefined;
  }) {
    super("ModelConnectionError");
    this.name = "ModelConnectionError";
    Object.assign(this, input);
  }
  override get message() {
    return modelConnectionMessages[this.reason];
  }
}
