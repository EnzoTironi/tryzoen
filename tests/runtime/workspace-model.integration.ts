import { jsonString } from "@shared/validation";
import { z } from "zod";
import { afterEach, expect, test, vi } from "vitest";
import { APICallError, streamText } from "ai";

import type { modelCredentials } from "../../server/models/connections";
import { ModelConnectionError } from "../../shared/models/catalog";
import { workspaceModel } from "../../agent/lib/workspace-model";

const mocks = vi.hoisted(() => ({
  credentials: vi.fn<typeof modelCredentials>(),
}));
vi.mock("../../server/models/connections", () => ({
  modelCredentials: mocks.credentials,
}));

afterEach(() => {
  vi.unstubAllGlobals();
  vi.resetAllMocks();
});
const actor = {
  userId: "better-auth:synthetic",
  workspaceId: "synthetic-space",
  authSessionId: "synthetic-session",
};
const tokens = {
  accessToken: "synthetic-access",
  refreshToken: "synthetic-refresh",
  expiresAt: 9999999999999,
  accountId: "synthetic-account",
};

const answer = [
  {
    type: "response.created",
    response: { id: "resp_1", created_at: 1, model: "synthetic" },
  },
  {
    type: "response.output_item.added",
    output_index: 0,
    item: { type: "message", id: "msg_1" },
  },
  {
    type: "response.output_text.delta",
    item_id: "msg_1",
    output_index: 0,
    delta: "42",
  },
  {
    type: "response.output_item.done",
    output_index: 0,
    item: {
      type: "message",
      id: "msg_1",
      role: "assistant",
      content: [{ type: "output_text", text: "42", annotations: [] }],
    },
  },
  {
    type: "response.completed",
    response: { usage: { input_tokens: 4, output_tokens: 1, total_tokens: 5 } },
  },
]
  .map((event) => `data: ${JSON.stringify(event)}\n\n`)
  .join("");

test.each(["chatgpt", "grok"] as const)(
  "streams through the %s adapter with workspace authorization and credential-free request bodies",
  async (provider) => {
    const model = provider === "chatgpt" ? "gpt-5.6-luna" : "grok-4.6";
    mocks.credentials.mockImplementation(() =>
      Promise.resolve({ provider, model, revision: "revision-one", tokens })
    );
    const fetcher = vi.fn<typeof fetch>().mockResolvedValue(
      new Response(answer, {
        headers: { "content-type": "text/event-stream" },
      })
    );
    vi.stubGlobal("fetch", fetcher);
    const selected = await workspaceModel(actor);
    if (!selected || typeof selected.model === "string")
      throw new Error("Expected a workspace model");
    const response = await selected.model.doStream({
      prompt: [
        { role: "system", content: "Keep this workspace isolated" },
        { role: "user", content: [{ type: "text", text: "6 * 7?" }] },
      ],
      maxOutputTokens: 100,
      providerOptions: { openai: { safetyIdentifier: "synthetic-user" } },
    });
    const chunks = await Array.fromAsync(response.stream);
    expect(chunks).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ type: "text-delta", delta: "42" }),
      ])
    );
    expect(chunks.filter((chunk) => chunk.type === "error")).toHaveLength(0);
    expect(mocks.credentials).toHaveBeenLastCalledWith(actor, "revision-one");
    expect(fetcher.mock.calls[0]?.[0]).toBe(
      provider === "chatgpt"
        ? "https://chatgpt.com/backend-api/codex/responses"
        : "https://api.x.ai/v1/responses"
    );
    const headers = new Headers(fetcher.mock.calls[0]?.[1]?.headers);
    expect(headers.get("authorization")).toBe("Bearer synthetic-access");
    const body = jsonString(z.record(z.string(), z.json())).parse(
      fetcher.mock.calls[0]?.[1]?.body
    );
    expect(body.model).toBe(model);
    expect(body.stream).toBe(true);
    expect(JSON.stringify(body)).not.toContain("synthetic-access");
    expect(body.instructions).toBe(
      provider === "chatgpt" ? "Keep this workspace isolated" : undefined
    );
    expect(body.store).toBe(provider === "chatgpt" ? false : undefined);
    expect(body.max_output_tokens).toBe(
      provider === "chatgpt" ? undefined : 100
    );
    expect(body.safety_identifier).toBe(
      provider === "chatgpt" ? undefined : "synthetic-user"
    );
  }
);

test("revocation between selecting a model and sending its request fails without contacting a provider", async () => {
  mocks.credentials
    .mockReturnValueOnce(
      Promise.resolve({
        provider: "chatgpt",
        model: "gpt-5.3-codex-spark",
        revision: "before-revocation",
        tokens,
      })
    )
    .mockReturnValue(
      Promise.reject(new ModelConnectionError({ reason: "changed" }))
    );
  const fetcher = vi.fn<typeof fetch>();
  vi.stubGlobal("fetch", fetcher);
  const selected = await workspaceModel(actor, true);
  if (!selected || typeof selected.model === "string")
    throw new Error("Expected a workspace model");
  expect(selected.model.modelId).toBe("gpt-5.6-luna");
  await expect(
    selected.model.doStream({
      prompt: [{ role: "user", content: [{ type: "text", text: "inspect" }] }],
    })
  ).rejects.toBeInstanceOf(ModelConnectionError);
  expect(fetcher).not.toHaveBeenCalled();
});

test("transient provider errors preserve bounded SDK retries and never expose request content", async () => {
  mocks.credentials.mockReturnValue(
    Promise.resolve({
      provider: "chatgpt",
      model: "gpt-5.6-luna",
      revision: "retry-proof",
      tokens,
    })
  );
  const fetcher = vi
    .fn<typeof fetch>()
    .mockResolvedValueOnce(
      new Response('{"error":"upstream failure with synthetic-secret"}', {
        status: 503,
      })
    )
    .mockResolvedValueOnce(
      new Response(answer, { headers: { "content-type": "text/event-stream" } })
    );
  vi.stubGlobal("fetch", fetcher);
  const selected = await workspaceModel(actor);
  if (!selected) throw new Error("Expected workspace model");
  const result = streamText({
    model: selected.model,
    prompt: "Private synthetic prompt",
    maxRetries: 1,
  });
  expect(await result.text).toBe("42");
  expect(fetcher).toHaveBeenCalledTimes(2);
  fetcher.mockResolvedValue(new Response("synthetic-secret", { status: 400 }));
  if (typeof selected.model === "string")
    throw new Error("Expected resolved model");
  const error = await Promise.resolve(
    selected.model.doStream({
      prompt: [
        {
          role: "user",
          content: [{ type: "text", text: "Private synthetic prompt" }],
        },
      ],
    })
  ).catch((cause: unknown) => cause);
  expect(APICallError.isInstance(error)).toBe(true);
  if (!APICallError.isInstance(error))
    throw new Error("Expected sanitized SDK failure");
  expect(error.isRetryable).toBe(false);
  expect(error.statusCode).toBe(400);
  expect(JSON.stringify(error)).not.toContain("synthetic-secret");
  expect(JSON.stringify(error)).not.toContain("Private synthetic prompt");
  expect(error.requestBodyValues).toEqual({});
});

test("an unauthorized response refreshes once, then rechecks workspace authorization before retrying", async () => {
  const connection = {
    provider: "chatgpt",
    model: "gpt-5.6-luna",
    revision: "refresh-proof",
    tokens,
  } as const;
  mocks.credentials
    .mockReturnValueOnce(Promise.resolve(connection))
    .mockReturnValueOnce(Promise.resolve(connection))
    .mockReturnValue(
      Promise.resolve({
        ...connection,
        tokens: { ...tokens, accessToken: "renewed-access" },
      })
    );
  const authorizations: (string | null)[] = [];
  const fetcher = vi
    .fn<typeof fetch>()
    .mockImplementation(async (_input, init) => {
      authorizations.push(new Headers(init?.headers).get("authorization"));
      return authorizations.length === 1
        ? new Response(null, { status: 401 })
        : new Response(answer, {
            headers: { "content-type": "text/event-stream" },
          });
    });
  vi.stubGlobal("fetch", fetcher);
  const selected = await workspaceModel(actor);
  if (!selected) throw new Error("Expected model");
  expect(
    await streamText({
      model: selected.model,
      prompt: "Reply 42",
      maxRetries: 0,
    }).text
  ).toBe("42");
  expect(authorizations).toEqual([
    "Bearer synthetic-access",
    "Bearer renewed-access",
  ]);
  expect(mocks.credentials).toHaveBeenLastCalledWith(
    actor,
    "refresh-proof",
    "synthetic-access"
  );
});
