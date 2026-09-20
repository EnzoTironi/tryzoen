import { inspect } from "node:util";
import { APICallError } from "ai";
import { MockLanguageModelV4 } from "ai/test";
import { expect, test } from "vitest";
import { withModelDeadline } from "../model-deadline";

const failure = () =>
  new APICallError({
    message: "PRIVATE-PROVIDER-PAYLOAD",
    url: "https://provider.invalid/PRIVATE-URL",
    requestBodyValues: { instructions: "PRIVATE-WORKSPACE-CONTEXT" },
    responseHeaders: { authorization: "PRIVATE-SERVICE-CREDENTIAL" },
    responseBody: "PRIVATE-PROVIDER-PAYLOAD",
    statusCode: 429,
    isRetryable: true,
  });

test.each(["generate", "stream-start", "stream-read", "stream-event"] as const)(
  "provider %s failures retain retry semantics without exposing private data",
  async (kind) => {
    const model = withModelDeadline(
      new MockLanguageModelV4({
        doGenerate: async () => {
          throw failure();
        },
        doStream: async () => {
          if (kind === "stream-start") throw failure();
          return {
            warnings: [],
            stream: new ReadableStream({
              start(controller) {
                if (kind === "stream-read") controller.error(failure());
                else {
                  controller.enqueue({ type: "error", error: failure() });
                  controller.close();
                }
              },
            }),
          };
        },
      })
    );
    const error = await Promise.try(async () => {
      if (kind === "generate") return model.doGenerate({ prompt: [] });
      const response = await model.doStream({ prompt: [] });
      const item = await response.stream.getReader().read();
      return item.value?.type === "error" ? item.value.error : undefined;
    }).catch((value: unknown) => value);
    expect(APICallError.isInstance(error)).toBe(true);
    expect(error).toMatchObject({ statusCode: 429, isRetryable: true });
    expect(inspect(error)).not.toContain("PRIVATE-");
    expect(inspect(error)).toContain("model provider request failed");
  }
);
