import { AsyncLocalStorage } from "node:async_hooks";
import { setTimeout as delay } from "node:timers/promises";

const operations = new AsyncLocalStorage<{
  signal: AbortSignal;
  deadline?: { at: number; expire: () => void };
}>();
const neverAborted = new AbortController().signal;

export function operationDeadline() {
  return operations.getStore()?.deadline?.at;
}

export function operationSignal() {
  const current = operations.getStore();
  if (current?.deadline && Date.now() >= current.deadline.at) {
    current.deadline.expire();
  }
  return current?.signal ?? neverAborted;
}

export async function withSignal<Value>(
  signal: AbortSignal | undefined,
  run: () => Promise<Value>
) {
  const deadline = operations.getStore()?.deadline;
  const combined = signal
    ? AbortSignal.any([operationSignal(), signal])
    : operationSignal();
  combined.throwIfAborted();
  if (deadline) {
    // Materialize native any() propagation so the first abort remains authoritative.
    const observeAbort = () => combined.aborted;
    combined.addEventListener("abort", observeAbort);
    return operations.run({ signal: combined, deadline }, async () => {
      try {
        const result = await run();
        operationSignal().throwIfAborted();
        return result;
      } finally {
        // Mark elapsed time without replacing the operation's original failure.
        operationSignal();
        combined.removeEventListener("abort", observeAbort);
      }
    });
  }
  const cancellation = Promise.withResolvers<never>();
  const rejectOnAbort = () => {
    cancellation.reject(combined.reason);
  };
  combined.addEventListener("abort", rejectOnAbort, { once: true });
  try {
    return await operations.run({ signal: combined }, () =>
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

/** An absolute budget propagates cancellation and awaits the work it started. */
export async function withDeadline<Value>(
  run: () => Promise<Value>,
  deadlineMs: number
) {
  if (!Number.isSafeInteger(deadlineMs) || deadlineMs < 0) {
    throw new RangeError("Expected a finite nonnegative operation deadline.");
  }
  const parent = operationSignal();
  parent.throwIfAborted();
  const inherited = operationDeadline();
  const at = Math.min(inherited ?? deadlineMs, deadlineMs);
  if (Date.now() >= at) throw new TimeoutError();
  const controller = new AbortController();
  const expire = () => {
    controller.abort(new TimeoutError());
  };
  const signal = AbortSignal.any([parent, controller.signal]);
  const observeAbort = () => signal.aborted;
  signal.addEventListener("abort", observeAbort);
  let timeout: ReturnType<typeof setTimeout> | undefined;
  const arm = () => {
    const remaining = at - Date.now();
    if (remaining <= 0) {
      expire();
      return;
    }
    // Node clamps larger delays to one millisecond; recheck the absolute budget.
    timeout = setTimeout(arm, Math.min(remaining, 2_147_483_647));
  };
  arm();
  try {
    return await operations.run(
      { signal, deadline: { at, expire } },
      async () => {
        operationSignal().throwIfAborted();
        const result = await run();
        operationSignal().throwIfAborted();
        return result;
      }
    );
  } finally {
    if (Date.now() >= at) expire();
    clearTimeout(timeout);
    signal.removeEventListener("abort", observeAbort);
  }
}

export async function withTimeout<Value>(
  run: () => Promise<Value>,
  milliseconds: number
) {
  if (operationDeadline() !== undefined) {
    return withDeadline(run, Date.now() + milliseconds);
  }
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
  const results: Output[] = [];
  const controller = new AbortController();
  if (operationDeadline() !== undefined) {
    let index = 0;
    const work = { failed: false, exhausted: false };
    let failure: unknown;
    await withSignal(controller.signal, async () => {
      const iterator = inputs[Symbol.iterator]();
      const workers: Promise<void>[] = [];
      const capacity = Math.max(1, Math.floor(concurrency));
      for (let worker = 0; worker < capacity; worker++) {
        if (work.exhausted || work.failed) break;
        workers.push(
          (async () => {
            try {
              for (;;) {
                operationSignal().throwIfAborted();
                const next = iterator.next();
                if (next.done) {
                  work.exhausted = true;
                  return;
                }
                const item = next.value;
                operationSignal().throwIfAborted();
                const current = index++;
                results[current] = await run(item, current);
              }
            } catch (error) {
              if (!work.failed) {
                work.failed = true;
                failure = error;
                controller.abort(error);
              }
            }
          })()
        );
      }
      await Promise.allSettled(workers);
      if (!work.failed) {
        try {
          operationSignal().throwIfAborted();
        } catch (error) {
          work.failed = true;
          failure = error;
        }
      }
      if (!work.exhausted) {
        try {
          iterator.return?.();
        } catch (error) {
          if (!work.failed) {
            work.failed = true;
            failure = error;
          }
        }
      }
      if (work.failed) throw failure;
    });
    return results;
  }
  const items = Array.from(inputs);
  const iterator = items.entries();
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
