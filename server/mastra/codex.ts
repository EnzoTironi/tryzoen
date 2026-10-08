import { spawn } from "node:child_process";
import { createInterface } from "node:readline";
import { createOpenAI } from "@ai-sdk/openai";
import { wrapLanguageModel } from "ai";
import { z } from "zod";
import { env } from "@shared/environment/env";

const authSchema = z.object({
  authMethod: z.literal("chatgpt"),
  authToken: z.string().min(1),
});
const rpcSchema = z.object({
  id: z.number(),
  result: z.unknown().optional(),
  error: z.unknown().optional(),
});

/** Codex owns auth.json and token refresh. Tokens never enter Mastra state or logs. */
async function codexCredential(refreshToken = false) {
  const child = spawn("codex", ["app-server", "--stdio"], {
    stdio: ["pipe", "pipe", "pipe"],
  });
  child.stderr.resume();
  const lines = createInterface({ input: child.stdout });
  try {
    const result = await new Promise<z.infer<typeof authSchema>>(
      (resolve, reject) => {
        const timeout = setTimeout(() => {
          reject(new Error("Codex authentication timed out."));
        }, 15000);
        const fail = () => {
          clearTimeout(timeout);
          reject(
            new Error("Codex authentication is unavailable. Run codex login.")
          );
        };
        child.once("error", fail);
        child.once("exit", fail);
        child.stdin.once("error", fail);
        lines.on("line", (line) => {
          let raw: unknown;
          try {
            raw = JSON.parse(line);
          } catch {
            return;
          }
          const response = rpcSchema.safeParse(raw);
          if (!response.success) return;
          if (response.data.error !== undefined) {
            fail();
            return;
          }
          if (response.data.id === 1) {
            child.stdin.write(
              JSON.stringify({ method: "initialized", params: {} }) + "\n"
            );
            child.stdin.write(
              JSON.stringify({
                id: 2,
                method: "getAuthStatus",
                params: { includeToken: true, refreshToken },
              }) + "\n"
            );
          } else if (response.data.id === 2) {
            clearTimeout(timeout);
            const parsed = authSchema.safeParse(response.data.result);
            if (parsed.success) resolve(parsed.data);
            else fail();
          }
        });
        child.stdin.write(
          JSON.stringify({
            id: 1,
            method: "initialize",
            params: {
              clientInfo: { name: "zoen-mastra-pilot", version: "1.0.0" },
              capabilities: null,
            },
          }) + "\n"
        );
      }
    );
    const claims = z
      .object({
        "https://api.openai.com/auth": z
          .object({ chatgpt_account_id: z.string() })
          .optional(),
      })
      .parse(
        JSON.parse(
          Buffer.from(
            result.authToken.split(".")[1] ?? "",
            "base64url"
          ).toString("utf8")
        )
      );
    return {
      token: result.authToken,
      accountId: claims["https://api.openai.com/auth"]?.chatgpt_account_id,
    };
  } finally {
    lines.close();
    child.kill();
  }
}

export function codexPilotModel() {
  const provider = createOpenAI({
    name: "codex",
    apiKey: "resolved-by-codex-app-server",
    baseURL: "https://chatgpt.com/backend-api/codex",
    fetch: async (url, init) => {
      const endpoint =
        typeof url === "string" ? url : url instanceof URL ? url.href : url.url;
      if (endpoint !== "https://chatgpt.com/backend-api/codex/responses")
        throw new Error("Unsupported Codex endpoint.");
      if (typeof init?.body !== "string")
        throw new Error("Unsupported Codex payload.");
      const payload = z
        .object({
          input: z.array(z.record(z.string(), z.unknown())).optional(),
        })
        .loose()
        .parse(JSON.parse(init.body));
      // Item ids from stored history are not valid with Codex's store:false API.
      payload.input = payload.input?.map(({ id: _id, ...item }) => item);
      delete payload.max_output_tokens;
      const body = JSON.stringify({ ...payload, store: false });
      for (const refresh of [false, true]) {
        const credential = await codexCredential(refresh);
        const headers = new Headers(init.headers);
        headers.set("Authorization", `Bearer ${credential.token}`);
        headers.set("originator", "zoen-mastra-pilot");
        if (credential.accountId)
          headers.set("ChatGPT-Account-Id", credential.accountId);
        const response = await fetch(url, { ...init, headers, body });
        if (response.status !== 401 || refresh) return response;
        await response.body?.cancel();
      }
      throw new Error("Codex authentication failed.");
    },
  });
  return wrapLanguageModel({
    model: provider.responses(env.ZOEN_MASTRA_PILOT_MODEL),
    middleware: {
      transformParams: async ({ params }) => ({
        ...params,
        prompt: params.prompt.filter((message) => message.role !== "system"),
        providerOptions: {
          ...params.providerOptions,
          openai: {
            ...params.providerOptions?.openai,
            instructions: params.prompt
              .filter((message) => message.role === "system")
              .map((message) => message.content)
              .join("\n\n"),
            store: false,
            reasoningSummary: null,
          },
        },
        tools: params.tools?.map((tool) =>
          tool.type === "function" ? { ...tool, strict: false } : tool
        ),
      }),
    },
  });
}
