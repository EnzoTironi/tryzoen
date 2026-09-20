import {
  APICallError,
  gateway,
  type LanguageModel,
  wrapLanguageModel,
} from "ai";

import { ModelConnectionError } from "../../shared/models/catalog";

function providerFailure(error: unknown, signal?: AbortSignal): unknown {
  if (signal?.aborted) return signal.reason;
  if (error instanceof ModelConnectionError) return error;
  if (APICallError.isInstance(error)) {
    return new APICallError({
      message: "The model provider request failed.",
      url: "model://provider",
      requestBodyValues: {},
      statusCode: error.statusCode,
      isRetryable: error.isRetryable,
    });
  }
  return new Error("The model provider request failed.");
}

/** Bound provider requests and keep private prompts and credentials out of error logs. */
export function withModelDeadline(model: LanguageModel) {
  return wrapLanguageModel({
    model: typeof model === "string" ? gateway(model) : model,
    middleware: {
      transformParams: async ({ params }) => ({
        ...params,
        abortSignal: AbortSignal.any([
          AbortSignal.timeout(90_000),
          ...(params.abortSignal ? [params.abortSignal] : []),
        ]),
      }),
      async wrapGenerate({ doGenerate, params }) {
        try {
          return await doGenerate();
        } catch (error) {
          throw providerFailure(error, params.abortSignal);
        }
      },
      async wrapStream({ doStream, params }) {
        try {
          const response = await doStream();
          const reader = response.stream.getReader();
          return {
            ...response,
            stream: new ReadableStream({
              async pull(controller) {
                try {
                  const item = await reader.read();
                  if (item.done) {
                    controller.close();
                    reader.releaseLock();
                    return;
                  }
                  controller.enqueue(
                    item.value.type === "error"
                      ? {
                          ...item.value,
                          error: providerFailure(
                            item.value.error,
                            params.abortSignal
                          ),
                        }
                      : item.value
                  );
                } catch (error) {
                  controller.error(providerFailure(error, params.abortSignal));
                  reader.releaseLock();
                }
              },
              async cancel(reason) {
                await reader.cancel(reason);
                reader.releaseLock();
              },
            }),
          };
        } catch (error) {
          throw providerFailure(error, params.abortSignal);
        }
      },
    },
  });
}
