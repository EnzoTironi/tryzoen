import { setTimeout } from "node:timers/promises";
import { mockModel, type MockModelResponder } from "eve/evals";

/** A provider that acknowledges streaming before waiting on its abort signal. */
export function cancellationModel(respond: MockModelResponder) {
  const model = mockModel(respond);
  if (typeof model === "string" || model.specificationVersion !== "v3")
    throw new Error("Expected a V3 mock model.");
  const doStream = model.doStream.bind(model);
  model.doStream = async (params) => {
    const result = await doStream(params);
    const latest = params.prompt.findLast((message) => message.role === "user");
    if (!JSON.stringify(latest).includes("cancel-slow")) return result;
    const reader = result.stream.getReader();
    return {
      ...result,
      stream: new ReadableStream({
        async start(controller) {
          try {
            for (;;) {
              const item = await reader.read();
              if (item.done) break;
              if (item.value.type === "text-delta") {
                controller.enqueue({
                  ...item.value,
                  delta: "Slow response started.",
                });
                await setTimeout(15_000, undefined, {
                  signal: params.abortSignal,
                });
                controller.enqueue({
                  ...item.value,
                  delta: " Late response finished.",
                });
              } else {
                controller.enqueue(item.value);
              }
            }
            controller.close();
          } catch (error) {
            controller.error(error);
          } finally {
            await reader.cancel();
            reader.releaseLock();
          }
        },
      }),
    };
  };
  return model;
}
