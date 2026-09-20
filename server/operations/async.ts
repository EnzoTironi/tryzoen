import { AsyncLocalStorage } from "node:async_hooks";
import { setTimeout as delay } from "node:timers/promises";

const signals = new AsyncLocalStorage<AbortSignal>();
const neverAborted = new AbortController().signal;

export function operationSignal() {
  return signals.getStore() ?? neverAborted;
}

export async function withSignal<Value>(
  signal: AbortSignal | undefined,
  run: () => Promise<Value>
) {
  const combined = signal
    ? AbortSignal.any([operationSignal(), signal])
    : operationSignal();
  combined.throwIfAborted();
  const cancellation = Promise.withResolvers<never>();
  const rejectOnAbort = () => {
    cancellation.reject(combined.reason);
  };
  combined.addEventListener("abort", rejectOnAbort, { once: true });
  try {
    return await signals.run(combined, () =>
      Promise.race([Promise.try(run), cancellation.promise])
    );
  } finally {
    combined.removeEventListener("abort", rejectOnAbort);
  }
}

export class TimeoutError extends Error {
  readonly _tag = "TimeoutError";
  constructor() {
    super("The operation timed out.");
    this.name = "TimeoutError";
  }
}

export async function withTimeout<Value>(
  run: () => Promise<Value>,
  milliseconds: number
) {
  const controller = new AbortController();
  const timeout = setTimeout(() => {
    controller.abort(new TimeoutError());
  }, milliseconds);
  try {
    return await withSignal(controller.signal, run);
  } finally {
    clearTimeout(timeout);
  }
}

export function sleep(milliseconds: number) {
  return delay(milliseconds, undefined, { signal: operationSignal() });
}

/** Preserve order while limiting concurrent provider requests. */
export async function mapAsync<Input, Output>(
  inputs: Iterable<Input>,
  run: (input: Input, index: number) => Promise<Output> | Output,
  concurrency = 1
) {
  const items = Array.from(inputs);
  const results: Output[] = [];
  const iterator = items.entries();
  const controller = new AbortController();
  await withSignal(controller.signal, () =>
    Promise.all(
      Array.from(
        { length: Math.min(items.length, Math.max(1, concurrency)) },
        async () => {
          try {
            for (const [index, item] of iterator) {
              operationSignal().throwIfAborted();
              results[index] = await run(item, index);
            }
          } catch (error) {
            controller.abort(error);
            throw error;
          }
        }
      )
    )
  );
  return results;
}
