import { withSignal } from "../../server/operations/async";
import { jsonString, isValid } from "@shared/validation";
import { z } from "zod";
import { createOpenAI } from "@ai-sdk/openai";
import { APICallError, wrapLanguageModel } from "ai";
import type { AgentModelOptionsDefinition } from "eve";
import { modelCredentials } from "../../server/models/connections";
import type { WorkspaceActorSchema } from "../../server/workspaces/access";
import {
  ModelConnectionError,
  modelCatalog,
} from "../../shared/models/catalog";
import { withModelDeadline } from "./model-deadline";

const CodexBody = z.object({
  input: z.optional(z.array(z.record(z.string(), z.unknown()))),
});

export const workspaceModel = async function (
  actor: z.output<typeof WorkspaceActorSchema>,
  browser = false
) {
  const connection = await modelCredentials(actor);
  if (!connection) return null;
  const selected =
    browser && !modelCatalog[connection.model].vision
      ? "gpt-5.6-luna"
      : connection.model;
  const provider = createOpenAI({
    // Credentials are resolved and re-authorized for every request, never put in a global provider.
    apiKey: "workspace-scoped",
    baseURL:
      connection.provider === "grok"
        ? "https://api.x.ai/v1"
        : "https://api.openai.com/v1",
    fetch: async (_url, init) => {
      const current = await withSignal(init?.signal ?? undefined, async () =>
        modelCredentials(actor, connection.revision)
      );
      if (!current) throw new ModelConnectionError({ reason: "changed" });
      const headers = new Headers(init?.headers);
      headers.set("authorization", `Bearer ${current.tokens.accessToken}`);
      let body = init?.body;
      if (connection.provider === "chatgpt") {
        headers.set("originator", "zoen");
        if (current.tokens.accountId)
          headers.set("ChatGPT-Account-Id", current.tokens.accountId);
        if (isValid(z.string(), body)) {
          const parsed = jsonString(z.record(z.string(), z.unknown())).parse(
            body
          );
          const input = CodexBody.parse(parsed).input;
          const requestBody = { ...parsed };
          // Codex subscription transport does not accept the public API's safety_identifier field.
          delete requestBody.safety_identifier;
          if (input)
            requestBody.input = input.map(({ id: _id, ...item }) => item);
          body = JSON.stringify(requestBody);
        }
      }
      const url =
        connection.provider === "chatgpt"
          ? "https://chatgpt.com/backend-api/codex/responses"
          : "https://api.x.ai/v1/responses";
      let response = await fetch(url, {
        ...init,
        headers,
        body,
        redirect: "error",
      });
      if (response.status === 401) {
        await response.body?.cancel();
        const refreshed = await withSignal(
          init?.signal ?? undefined,
          async () =>
            modelCredentials(
              actor,
              connection.revision,
              current.tokens.accessToken
            )
        );
        if (!refreshed) throw new ModelConnectionError({ reason: "changed" });
        headers.set("authorization", `Bearer ${refreshed.tokens.accessToken}`);
        if (connection.provider === "chatgpt" && refreshed.tokens.accountId)
          headers.set("ChatGPT-Account-Id", refreshed.tokens.accountId);
        response = await fetch(url, {
          ...init,
          headers,
          body,
          redirect: "error",
        });
      }
      if (!response.ok) {
        await response.body?.cancel();
        const failure = new ModelConnectionError({
          status: response.status,
          reason: [401, 403].includes(response.status)
            ? "reconnect"
            : response.status === 429
              ? "rate_limited"
              : "unavailable",
        });
        // Keep SDK retry semantics for transient failures, without copying prompts or credentials into errors.
        throw new APICallError({
          message: failure.message,
          url,
          statusCode: response.status,
          requestBodyValues: { model: selected },
        });
      }
      return response;
    },
  });
  const model = wrapLanguageModel({
    model: provider.responses(selected),
    middleware: {
      transformParams: async ({ params }) => {
        if (connection.provider !== "chatgpt") return params;
        const instructions = params.prompt
          .filter((message) => message.role === "system")
          .map((message) => message.content)
          .join("\n\n");
        return {
          ...params,
          maxOutputTokens: undefined,
          prompt: params.prompt.filter((message) => message.role !== "system"),
          providerOptions: {
            ...params.providerOptions,
            openai: {
              ...params.providerOptions?.openai,
              instructions,
              store: false,
              reasoningSummary: null,
            },
          },
        };
      },
    },
  });
  const modelOptions: AgentModelOptionsDefinition = {
    providerOptions: { openai: { store: false, reasoningSummary: null } },
  };
  return {
    model: withModelDeadline(model),
    modelContextWindowTokens: modelCatalog[selected].context,
    modelOptions,
  };
};
