import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import {
  mapAsync,
  operationDeadline,
  operationSignal,
  TimeoutError,
  withDeadline,
  withSignal,
  withTimeout,
} from "./async";

const now = 100_000;

function observe<Value>(promise: Promise<Value>) {
  let settled = false;
  const outcome = promise.then(
    (value) => {
      settled = true;
      return { status: "fulfilled" as const, value };
    },
    (reason: unknown) => {
      settled = true;
      return { status: "rejected" as const, reason };
    }
  );
  return {
    outcome,
    settled: () => settled,
    async rejection() {
      const result = await outcome;
      if (result.status !== "rejected") {
        throw new Error("Expected the operation to reject.");
      }
      return result.reason;
    },
  };
}

async function rejection<Value>(promise: Promise<Value>) {
  return observe(promise).rejection();
}

function trackedInputs(count: number) {
  let position = 0;
  const next = vi.fn<() => IteratorResult<number>>(() => {
    if (position >= count) {
      return { done: true, value: undefined };
    }
    return { done: false, value: position++ };
  });
  return {
    next,
    inputs: {
      [Symbol.iterator]() {
        return { next };
      },
    },
  };
}

beforeEach(() => {
  vi.useFakeTimers();
  vi.setSystemTime(now);
});

afterEach(() => {
  vi.useRealTimers();
  vi.restoreAllMocks();
});

describe("the canonical absolute deadline context", () => {
  it("exports the deadline scope and inherited deadline reader", () => {
    expect(withDeadline).toBeTypeOf("function");
    expect(operationDeadline).toBeTypeOf("function");
  });

  it.each([NaN, Infinity, -Infinity, -1, 0.5, Number.MAX_SAFE_INTEGER + 1])(
    "rejects invalid absolute deadline %s before invoking work",
    async (deadline) => {
      const run = vi.fn<() => Promise<string>>(async () => "unexpected");
      const reason = await rejection(withDeadline(run, deadline));
      expect(reason).toBeInstanceOf(Error);
      expect(run).not.toHaveBeenCalled();
      expect(vi.getTimerCount()).toBe(0);
      expect(operationDeadline()).toBeUndefined();
    }
  );

  it.each([0, now - 1, now])(
    "rejects elapsed deadline %s before invoking work",
    async (deadline) => {
      const run = vi.fn<() => Promise<string>>(async () => "unexpected");
      expect(await rejection(withDeadline(run, deadline))).toBeInstanceOf(
        TimeoutError
      );
      expect(run).not.toHaveBeenCalled();
      expect(vi.getTimerCount()).toBe(0);
    }
  );

  it("exposes no deadline and one stable live signal outside a scope", () => {
    expect(operationDeadline()).toBeUndefined();
    expect(operationSignal()).toBe(operationSignal());
    expect(operationSignal().aborted).toBe(false);
  });

  it.each([now + 60_000, Number.MAX_SAFE_INTEGER])(
    "accepts generic safe deadline %s beyond the Matrix-specific cap",
    async (deadline) => {
      const result = await withDeadline(async () => {
        expect(operationDeadline()).toBe(deadline);
        expect(operationSignal().aborted).toBe(false);
        return "complete";
      }, deadline);
      expect(result).toBe("complete");
      expect(operationDeadline()).toBeUndefined();
      expect(vi.getTimerCount()).toBe(0);
    }
  );

  it("inherits the earlier nested deadline and restores its parent context", async () => {
    const outerSignal = operationSignal();
    await withDeadline(async () => {
      const parentSignal = operationSignal();
      expect(operationDeadline()).toBe(now + 500);
      await withDeadline(async () => {
        expect(operationDeadline()).toBe(now + 500);
        expect(operationSignal().aborted).toBe(false);
      }, now + 5_000);
      expect(operationDeadline()).toBe(now + 500);
      expect(operationSignal()).toBe(parentSignal);
      await withDeadline(async () => {
        expect(operationDeadline()).toBe(now + 100);
      }, now + 100);
      expect(operationDeadline()).toBe(now + 500);
      expect(operationSignal()).toBe(parentSignal);
    }, now + 500);
    expect(operationDeadline()).toBeUndefined();
    expect(operationSignal()).toBe(outerSignal);
    expect(vi.getTimerCount()).toBe(0);
  });

  it("restores parent context after a nested original authorization rejection", async () => {
    const denied = new Error("Workspace access denied");
    const outerSignal = operationSignal();
    await withDeadline(async () => {
      const parentSignal = operationSignal();
      const reason = await rejection(
        withDeadline(async () => {
          throw denied;
        }, now + 100)
      );
      expect(reason).toBe(denied);
      expect(operationDeadline()).toBe(now + 500);
      expect(operationSignal()).toBe(parentSignal);
      expect(parentSignal.aborted).toBe(false);
    }, now + 500);
    expect(operationSignal()).toBe(outerSignal);
    expect(operationDeadline()).toBeUndefined();
    expect(vi.getTimerCount()).toBe(0);
  });

  it("does not invoke nested work under an already aborted inherited signal", async () => {
    const external = new AbortController();
    const denied = new Error("Membership revoked");
    const run = vi.fn<() => Promise<string>>(async () => "unexpected");
    const reason = await rejection(
      withDeadline(
        () =>
          withSignal(external.signal, async () => {
            external.abort(denied);
            return withDeadline(run, now + 500);
          }),
        now + 1_000
      )
    );
    expect(reason).toBe(denied);
    expect(run).not.toHaveBeenCalled();
    expect(vi.getTimerCount()).toBe(0);
  });

  it("makes clock expiration truthful before the deadline timer fires", async () => {
    const reason = await rejection(
      withDeadline(async () => {
        const signal = operationSignal();
        vi.setSystemTime(now + 10);
        expect(operationSignal()).toBe(signal);
        expect(signal.aborted).toBe(true);
        expect(signal.reason).toBeInstanceOf(TimeoutError);
        signal.throwIfAborted();
      }, now + 10)
    );
    expect(reason).toBeInstanceOf(TimeoutError);
    expect(vi.getTimerCount()).toBe(0);
  });

  it("checks the deadline again after work returns without reading its signal", async () => {
    const reason = await rejection(
      withDeadline(async () => {
        vi.setSystemTime(now + 10);
        return "late answer";
      }, now + 10)
    );
    expect(reason).toBeInstanceOf(TimeoutError);
    expect(operationDeadline()).toBeUndefined();
    expect(vi.getTimerCount()).toBe(0);
  });

  it("cleans its timer after success and original rejection", async () => {
    expect(await withDeadline(async () => "ok", now + 100)).toBe("ok");
    expect(vi.getTimerCount()).toBe(0);
    const original = new Error("Original query rejection");
    expect(
      await rejection(
        withDeadline(async () => {
          throw original;
        }, now + 100)
      )
    ).toBe(original);
    expect(vi.getTimerCount()).toBe(0);
  });
});

describe("settlement within a strict deadline scope", () => {
  it("rejects late fulfillment only after held work actually settles", async () => {
    const held = Promise.withResolvers<string>();
    const entered = Promise.withResolvers<AbortSignal>();
    const result = observe(
      withDeadline(async () => {
        entered.resolve(operationSignal());
        return held.promise;
      }, now + 10)
    );
    const signal = await entered.promise;
    try {
      await vi.advanceTimersByTimeAsync(10);
      expect(signal.aborted).toBe(true);
      expect(signal.reason).toBeInstanceOf(TimeoutError);
      expect(result.settled()).toBe(false);
    } finally {
      held.resolve("late result");
    }
    expect(await result.rejection()).toBe(signal.reason);
    expect(vi.getTimerCount()).toBe(0);
  });

  it("preserves the exact authorization rejection even after its deadline aborts", async () => {
    const held = Promise.withResolvers<string>();
    const entered = Promise.withResolvers<AbortSignal>();
    const denied = new Error("Workspace authorization was revoked");
    const result = observe(
      withDeadline(async () => {
        entered.resolve(operationSignal());
        return held.promise;
      }, now + 10)
    );
    const signal = await entered.promise;
    try {
      await vi.advanceTimersByTimeAsync(10);
      expect(signal.reason).toBeInstanceOf(TimeoutError);
      expect(result.settled()).toBe(false);
    } finally {
      held.reject(denied);
    }
    expect(await result.rejection()).toBe(denied);
    expect(vi.getTimerCount()).toBe(0);
  });

  it("withSignal preserves deadline metadata and drains held work after cancellation", async () => {
    const external = new AbortController();
    const cancelled = new Error("Caller cancelled");
    const held = Promise.withResolvers<string>();
    const entered = Promise.withResolvers<AbortSignal>();
    const result = observe(
      withDeadline(
        () =>
          withSignal(external.signal, async () => {
            expect(operationDeadline()).toBe(now + 1_000);
            entered.resolve(operationSignal());
            return held.promise;
          }),
        now + 1_000
      )
    );
    const signal = await entered.promise;
    try {
      external.abort(cancelled);
      await vi.advanceTimersByTimeAsync(0);
      expect(signal.aborted).toBe(true);
      expect(signal.reason).toBe(cancelled);
      expect(result.settled()).toBe(false);
    } finally {
      held.resolve("late result");
    }
    const outcome = await result.outcome;
    expect(outcome).toEqual({ status: "rejected", reason: cancelled });
    expect(vi.getTimerCount()).toBe(0);
  });

  it("retains the first external abort reason when the deadline subsequently expires", async () => {
    const external = new AbortController();
    const cancelled = new Error("First cancellation");
    const held = Promise.withResolvers<string>();
    const entered = Promise.withResolvers<AbortSignal>();
    const result = observe(
      withDeadline(
        () =>
          withSignal(external.signal, async () => {
            entered.resolve(operationSignal());
            return held.promise;
          }),
        now + 10
      )
    );
    const signal = await entered.promise;
    try {
      external.abort(cancelled);
      await vi.advanceTimersByTimeAsync(10);
      expect(signal.reason).toBe(cancelled);
      expect(result.settled()).toBe(false);
    } finally {
      held.resolve("late result");
    }
    expect(await result.outcome).toEqual({
      status: "rejected",
      reason: cancelled,
    });
    expect(vi.getTimerCount()).toBe(0);
  });

  it.each(["withSignal", "nested withDeadline"])(
    "preserves native local cancellation before unobserved clock expiry through %s",
    async (scope) => {
      const local = new AbortController();
      const cancelled = new Error("Native local cancellation came first");
      const entered = Promise.withResolvers<void>();
      const held = Promise.withResolvers<void>();
      const run = async () => {
        entered.resolve();
        await held.promise;
        // Do not read this combined signal between local abort and clock expiry.
        const signal = operationSignal();
        expect(signal.reason).toBe(cancelled);
        signal.throwIfAborted();
      };
      const result = observe(
        withDeadline(
          () =>
            withSignal(local.signal, () =>
              scope === "nested withDeadline"
                ? withDeadline(run, now + 10)
                : run()
            ),
          now + 10
        )
      );
      await entered.promise;
      try {
        local.abort(cancelled);
        vi.setSystemTime(now + 10);
        expect(result.settled()).toBe(false);
      } finally {
        held.resolve();
      }
      expect(await result.rejection()).toBe(cancelled);
      expect(vi.getTimerCount()).toBe(0);
    }
  );

  it("withTimeout clips its relative cap to the inherited absolute deadline", async () => {
    const held = Promise.withResolvers<string>();
    const entered = Promise.withResolvers<AbortSignal>();
    const result = observe(
      withDeadline(
        () =>
          withTimeout(async () => {
            expect(operationDeadline()).toBe(now + 10);
            entered.resolve(operationSignal());
            return held.promise;
          }, 500),
        now + 10
      )
    );
    const signal = await entered.promise;
    try {
      await vi.advanceTimersByTimeAsync(10);
      expect(signal.reason).toBeInstanceOf(TimeoutError);
      expect(result.settled()).toBe(false);
    } finally {
      held.resolve("late result");
    }
    expect(await result.rejection()).toBe(signal.reason);
    expect(vi.getTimerCount()).toBe(0);
  });

  it("a shorter relative cap does not abort its longer-lived parent context", async () => {
    const held = Promise.withResolvers<string>();
    const entered = Promise.withResolvers<AbortSignal>();
    const result = observe(
      withDeadline(async () => {
        const parent = operationSignal();
        const child = observe(
          withTimeout(async () => {
            expect(operationDeadline()).toBe(now + 20);
            entered.resolve(operationSignal());
            return held.promise;
          }, 20)
        );
        const outcome = await child.outcome;
        expect(outcome.status).toBe("rejected");
        expect(operationDeadline()).toBe(now + 1_000);
        expect(operationSignal()).toBe(parent);
        expect(parent.aborted).toBe(false);
        return "parent recovered";
      }, now + 1_000)
    );
    const signal = await entered.promise;
    try {
      await vi.advanceTimersByTimeAsync(20);
      expect(signal.reason).toBeInstanceOf(TimeoutError);
      expect(result.settled()).toBe(false);
    } finally {
      held.resolve("late child result");
    }
    expect(await result.outcome).toEqual({
      status: "fulfilled",
      value: "parent recovered",
    });
    expect(vi.getTimerCount()).toBe(0);
  });

  it("an actual timer aborts but does not detach held work, and is cleared on settlement", async () => {
    vi.useRealTimers();
    const schedule = vi.spyOn(globalThis, "setTimeout");
    const clear = vi.spyOn(globalThis, "clearTimeout");
    const held = Promise.withResolvers<string>();
    const aborted = Promise.withResolvers<AbortSignal>();
    const result = observe(
      withDeadline(async () => {
        const signal = operationSignal();
        signal.addEventListener(
          "abort",
          () => {
            aborted.resolve(signal);
          },
          { once: true }
        );
        return held.promise;
      }, Date.now() + 200)
    );
    const signal = await aborted.promise;
    try {
      expect(signal.aborted).toBe(true);
      expect(signal.reason).toBeInstanceOf(TimeoutError);
      expect(result.settled()).toBe(false);
    } finally {
      held.resolve("explicitly released");
    }
    expect(await result.rejection()).toBe(signal.reason);
    expect(schedule).toHaveBeenCalledTimes(1);
    const scheduled = schedule.mock.results[0];
    if (scheduled?.type !== "return") {
      throw new Error("Expected one actual deadline timer.");
    }
    expect(clear).toHaveBeenCalledWith(scheduled.value);
  });
});

describe("mapAsync inside a strict deadline scope", () => {
  it("checks cancellation before iterator.next and never eagerly consumes later inputs", async () => {
    const external = new AbortController();
    const cancelled = new Error("Stop before the next input");
    const { inputs, next } = trackedInputs(3);
    const worker = vi.fn<(input: number, index: number) => number>((input) => {
      external.abort(cancelled);
      return input;
    });
    const reason = await rejection(
      withDeadline(
        () => withSignal(external.signal, () => mapAsync(inputs, worker, 1)),
        now + 100
      )
    );
    expect(reason).toBe(cancelled);
    expect(worker).toHaveBeenCalledExactlyOnceWith(0, 0);
    expect(next).toHaveBeenCalledTimes(1);
    expect(vi.getTimerCount()).toBe(0);
  });

  it.each([
    {
      label: "authorization Error",
      first: new Error("First authorization failure"),
    },
    { label: "undefined", first: undefined },
  ])(
    "drains all started workers and preserves first thrown $label",
    async ({ first }) => {
      const initial = Promise.withResolvers<number>();
      const later = Promise.withResolvers<number>();
      const started = Promise.withResolvers<void>();
      const laterFailure = new Error("Later worker failure");
      const { inputs, next } = trackedInputs(3);
      let starts = 0;
      const worker = vi.fn<(input: number) => Promise<number>>((input) => {
        starts++;
        if (starts === 2) {
          started.resolve();
        }
        return input === 0 ? initial.promise : later.promise;
      });
      const result = observe(
        withDeadline(() => mapAsync(inputs, worker, 2), now + 1_000)
      );
      await started.promise;
      try {
        initial.reject(first);
        await vi.advanceTimersByTimeAsync(0);
        expect(result.settled()).toBe(false);
        expect(worker).toHaveBeenCalledTimes(2);
        expect(next).toHaveBeenCalledTimes(2);
      } finally {
        later.reject(laterFailure);
      }
      expect(await result.rejection()).toBe(first);
      expect(worker).toHaveBeenCalledTimes(2);
      expect(next).toHaveBeenCalledTimes(2);
      expect(vi.getTimerCount()).toBe(0);
    }
  );

  it("finite inputs bound worker creation even with infinite concurrency", async () => {
    const worker = vi.fn<(input: number) => number>((input) => input * 2);
    const result = await withDeadline(
      () => mapAsync([1, 2], worker, Infinity),
      now + 100
    );
    expect(result).toEqual([2, 4]);
    expect(worker).toHaveBeenCalledTimes(2);
    expect(vi.getTimerCount()).toBe(0);
  });

  it("preserves result order when workers finish out of order", async () => {
    const first = Promise.withResolvers<number>();
    const secondStarted = Promise.withResolvers<void>();
    const result = observe(
      withDeadline(
        () =>
          mapAsync(
            [10, 20],
            (input, index) => {
              if (index === 0) {
                return first.promise;
              }
              secondStarted.resolve();
              return input * 2;
            },
            2
          ),
        now + 100
      )
    );
    await secondStarted.promise;
    expect(result.settled()).toBe(false);
    first.resolve(20);
    expect(await result.outcome).toEqual({
      status: "fulfilled",
      value: [20, 40],
    });
    expect(vi.getTimerCount()).toBe(0);
  });
});

describe("established behavior outside the strict deadline scope", () => {
  it("withSignal still rejects promptly while its legacy held callback continues", async () => {
    const external = new AbortController();
    const cancelled = new Error("Legacy caller cancellation");
    const held = Promise.withResolvers<string>();
    const entered = Promise.withResolvers<void>();
    let workSettled = false;
    const result = observe(
      withSignal(external.signal, async () => {
        expect(operationDeadline()).toBeUndefined();
        entered.resolve();
        const value = await held.promise;
        workSettled = true;
        return value;
      })
    );
    await entered.promise;
    try {
      external.abort(cancelled);
      expect(await result.outcome).toEqual({
        status: "rejected",
        reason: cancelled,
      });
      expect(workSettled).toBe(false);
    } finally {
      held.resolve("legacy callback release");
    }
    await vi.advanceTimersByTimeAsync(0);
    expect(workSettled).toBe(true);
    expect(operationDeadline()).toBeUndefined();
  });

  it("withTimeout retains its legacy prompt rejection without creating deadline metadata", async () => {
    const held = Promise.withResolvers<string>();
    const entered = Promise.withResolvers<void>();
    let workSettled = false;
    const result = observe(
      withTimeout(async () => {
        expect(operationDeadline()).toBeUndefined();
        entered.resolve();
        const value = await held.promise;
        workSettled = true;
        return value;
      }, 10)
    );
    await entered.promise;
    try {
      await vi.advanceTimersByTimeAsync(10);
      expect(await result.rejection()).toBeInstanceOf(TimeoutError);
      expect(workSettled).toBe(false);
    } finally {
      held.resolve("legacy callback release");
    }
    await vi.advanceTimersByTimeAsync(0);
    expect(workSettled).toBe(true);
    expect(operationDeadline()).toBeUndefined();
    expect(vi.getTimerCount()).toBe(0);
  });

  it("mapAsync retains ordered output and eager input materialization", async () => {
    const { inputs, next } = trackedInputs(2);
    const worker = vi.fn<(input: number) => number>((input) => {
      expect(operationDeadline()).toBeUndefined();
      expect(next).toHaveBeenCalledTimes(3);
      return input * 2;
    });
    expect(await mapAsync(inputs, worker, 2)).toEqual([0, 2]);
    expect(worker).toHaveBeenCalledTimes(2);
    expect(operationDeadline()).toBeUndefined();
  });
});
