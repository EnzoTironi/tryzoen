/** Scheduler orchestration only: all Matrix owners and Eve dispatch are mocks.
 * No database, native provider, agent runtime or membership authority runs. */
import type { Session } from "eve/channels";
import type { transaction } from "@db/queries";
import type { ScheduleHandlerArgs, ScheduleToFn } from "eve/schedules";
import type {
  pendingMatrixEvents,
  publishMatrixAnswer,
} from "../../../server/matrix/delivery";
import type {
  pendingMatrixGroupJoins,
  completeMatrixGroupJoin,
} from "../../../server/matrix/participation";
import { afterEach, beforeEach, describe, expect, test, vi } from "vitest";

const owners = vi.hoisted(() => ({
  transaction: vi.fn<typeof transaction>(),
  departures: vi.fn<(deadlineMs: number, limit: number) => Promise<number>>(),
  erasures: vi.fn<(deadlineMs: number, limit: number) => Promise<number>>(),
  joins: vi.fn<typeof pendingMatrixGroupJoins>(),
  completeJoin: vi.fn<typeof completeMatrixGroupJoin>(),
  rooms: vi.fn<(deadlineMs: number, limit: number) => Promise<number>>(),
  activity: vi.fn<(deadlineMs: number, limit: number) => Promise<number>>(),
  events: vi.fn<typeof pendingMatrixEvents>(),
  answer: vi.fn<typeof publishMatrixAnswer>(),
  send: vi.fn<ReturnType<ScheduleToFn>["send"]>(),
  to: vi.fn<ScheduleToFn>(),
}));
vi.mock("@db/queries", () => ({ transaction: owners.transaction }));
vi.mock("../../../server/matrix/membership", () => ({
  reconcileGroupDepartures: owners.departures,
}));
vi.mock("../../../server/matrix/erasure-reconcile", () => ({
  reconcileMatrixErasures: owners.erasures,
}));
vi.mock("../../../server/matrix/participation", () => ({
  pendingMatrixGroupJoins: owners.joins,
  completeMatrixGroupJoin: owners.completeJoin,
}));
vi.mock("../../../server/matrix/rooms", () => ({
  reconcileMatrixRooms: owners.rooms,
}));
vi.mock("../../../server/matrix/activity-reconcile", () => ({
  reconcileMatrixActivity: owners.activity,
}));
vi.mock("../../../server/matrix/delivery", () => ({
  pendingMatrixEvents: owners.events,
  publishMatrixAnswer: owners.answer,
}));
vi.mock("@agent/channels/matrix", () => ({ default: { channel: "matrix" } }));

import schedule from "@agent/schedules/matrix-delivery";
import matrix from "@agent/channels/matrix";
import {
  operationSignal,
  TimeoutError,
  withSignal,
} from "../../../server/operations/async";

const appAuth = {
  attributes: {},
  authenticator: "app",
  principalId: "eve:app",
  principalType: "app",
} satisfies ScheduleHandlerArgs["appAuth"];
const workOrder = [
  "departures",
  "erasures",
  "joins",
  "rooms",
  "activity",
  "delivery",
];
const order: string[] = [];

function session(): Session {
  return {
    id: "synthetic-matrix-session",
    cancel: vi.fn<Session["cancel"]>(),
    clear: vi.fn<Session["clear"]>(),
    compact: vi.fn<Session["compact"]>(),
    getEventStream: vi.fn<Session["getEventStream"]>(),
    getStreamTailIndex: vi.fn<Session["getStreamTailIndex"]>(),
    reset: vi.fn<Session["reset"]>(),
    respond: vi.fn<Session["respond"]>(),
    send: vi.fn<Session["send"]>(),
  };
}
function fire() {
  const waitUntil = vi.fn<ScheduleHandlerArgs["waitUntil"]>();
  schedule.run({ appAuth, to: owners.to, waitUntil });
  const task = waitUntil.mock.calls[0]?.[0];
  if (!task) throw new Error("Schedule did not retain its background task");
  return { task, waitUntil };
}
function joinCandidates(length: number) {
  return Array.from({ length }, (_, i) => ({
    bindingId: `synthetic-binding-${i}`,
    userId: `better-auth:synthetic-user-${i}`,
  }));
}
function answerEvents(length: number) {
  return Array.from({ length }, (_, i) => ({
    eventId: `$synthetic-event-${i}`,
    state: "answer_ready",
  }));
}
function fillQueues(joinResult = true) {
  const expectedDeadline = Date.now() + 30_000;
  for (const owner of [
    owners.departures,
    owners.erasures,
    owners.rooms,
    owners.activity,
  ])
    owner.mockImplementation(async (deadlineMs, limit) => {
      expect(deadlineMs).toBe(expectedDeadline);
      return limit;
    });
  owners.joins.mockResolvedValue(joinCandidates(12));
  owners.completeJoin.mockResolvedValue(joinResult);
  owners.events.mockResolvedValue(answerEvents(100));
}

beforeEach(() => {
  vi.useFakeTimers({ toFake: ["Date", "setTimeout", "clearTimeout"] });
  vi.setSystemTime(0);
  vi.clearAllMocks();
  order.length = 0;
  owners.transaction.mockReset().mockImplementation(async (run) => run());
  owners.departures.mockReset().mockImplementation(async () => {
    order.push("departures");
    return 0;
  });
  owners.erasures.mockReset().mockImplementation(async () => {
    order.push("erasures");
    return 0;
  });
  owners.rooms.mockReset().mockImplementation(async () => {
    order.push("rooms");
    return 0;
  });
  owners.activity.mockReset().mockImplementation(async () => {
    order.push("activity");
    return 0;
  });
  owners.joins.mockReset().mockImplementation(async () => {
    order.push("joins");
    return [];
  });
  owners.completeJoin.mockReset().mockResolvedValue(true);
  owners.events.mockReset().mockImplementation(async () => {
    order.push("delivery");
    return [];
  });
  owners.answer.mockReset().mockResolvedValue(undefined);
  owners.send.mockReset().mockResolvedValue(session());
  owners.to.mockReset().mockImplementation(() => ({ send: owners.send }));
  vi.spyOn(console, "warn").mockImplementation(() => undefined);
});
afterEach(() => {
  vi.restoreAllMocks();
  vi.useRealTimers();
});

describe("bounded Matrix delivery schedule", () => {
  test("uses one minute cron and one absolute deadline for every owner", async () => {
    expect(schedule.cron).toBe("* * * * *");
    owners.joins.mockResolvedValue(joinCandidates(1));
    await fire().task;
    expect(owners.departures).toHaveBeenCalledExactlyOnceWith(30_000, 10);
    expect(owners.erasures).toHaveBeenCalledExactlyOnceWith(30_000, 20);
    expect(owners.joins).toHaveBeenCalledExactlyOnceWith(5);
    expect(owners.completeJoin).toHaveBeenCalledExactlyOnceWith(
      "synthetic-binding-0",
      "better-auth:synthetic-user-0",
      30_000
    );
    expect(owners.rooms).toHaveBeenCalledExactlyOnceWith(30_000, 5);
    expect(owners.activity).toHaveBeenCalledExactlyOnceWith(30_000, 5);
    expect(owners.events).toHaveBeenCalledExactlyOnceWith(25);
    expect(owners.transaction).toHaveBeenCalledTimes(2);
    for (const [, options] of owners.transaction.mock.calls)
      expect(options).toEqual({ outermost: true });
  });

  test.each([0, 1, 2, 3, 4, 5])(
    "rotates the first work class at minute %i",
    async (minute) => {
      vi.setSystemTime(minute * 60_000);
      await fire().task;
      expect(order).toEqual([
        ...workOrder.slice(minute),
        ...workOrder.slice(0, minute),
      ]);
    }
  );

  test.each([true, false])(
    "caps the tick at 50 attempts when join completion returns %s",
    async (joinResult) => {
      fillQueues(joinResult);
      await fire().task;
      expect(owners.departures).toHaveBeenCalledExactlyOnceWith(30_000, 10);
      expect(owners.erasures).toHaveBeenCalledExactlyOnceWith(30_000, 20);
      expect(owners.joins).toHaveBeenCalledExactlyOnceWith(5);
      expect(owners.completeJoin).toHaveBeenCalledTimes(5);
      expect(owners.rooms).toHaveBeenCalledExactlyOnceWith(30_000, 5);
      expect(owners.activity).toHaveBeenCalledExactlyOnceWith(30_000, 5);
      expect(owners.answer).toHaveBeenCalledTimes(5);
      expect(owners.to).not.toHaveBeenCalled();
    }
  );

  test("passes only the remaining global budget when delivery runs first", async () => {
    vi.setSystemTime(300_000);
    fillQueues();
    await fire().task;
    expect(owners.answer).toHaveBeenCalledTimes(25);
    expect(owners.departures).toHaveBeenCalledExactlyOnceWith(330_000, 10);
    expect(owners.erasures).toHaveBeenCalledExactlyOnceWith(330_000, 15);
    expect(owners.joins).not.toHaveBeenCalled();
    expect(owners.rooms).not.toHaveBeenCalled();
    expect(owners.activity).not.toHaveBeenCalled();
  });

  test("charges a failed class its allocation and continues healthy work", async () => {
    fillQueues();
    owners.departures.mockRejectedValueOnce(
      new Error("Synthetic unhealthy class")
    );
    await fire().task;
    expect(owners.erasures).toHaveBeenCalledExactlyOnceWith(30_000, 20);
    expect(owners.completeJoin).toHaveBeenCalledTimes(5);
    expect(owners.rooms).toHaveBeenCalledTimes(1);
    expect(owners.activity).toHaveBeenCalledTimes(1);
    expect(owners.answer).toHaveBeenCalledTimes(5);
  });

  test.each([-1, Number.NaN, 11])(
    "reserves the allocation for invalid consumed count %s",
    async (consumed) => {
      fillQueues();
      owners.departures.mockResolvedValueOnce(consumed);
      await fire().task;
      expect(owners.answer).toHaveBeenCalledTimes(5);
      expect(owners.completeJoin).toHaveBeenCalledTimes(5);
    }
  );

  test("leaves failed joins for the next tick while completing healthy joins", async () => {
    const queued = joinCandidates(2);
    let failed = false;
    owners.joins.mockImplementation(async () => [...queued]);
    owners.completeJoin.mockImplementation(async (bindingId) => {
      if (bindingId === "synthetic-binding-0" && !failed) {
        failed = true;
        throw new Error("Synthetic join transport failure");
      }
      const index = queued.findIndex((item) => item.bindingId === bindingId);
      if (index >= 0) queued.splice(index, 1);
      return true;
    });
    await fire().task;
    expect(queued).toEqual(joinCandidates(1));
    expect(owners.completeJoin.mock.calls.map(([id]) => id)).toEqual([
      "synthetic-binding-0",
      "synthetic-binding-1",
    ]);
    await fire().task;
    expect(queued).toEqual([]);
    expect(owners.completeJoin.mock.calls.map(([id]) => id)).toEqual([
      "synthetic-binding-0",
      "synthetic-binding-1",
      "synthetic-binding-0",
    ]);
  });

  test("publishes ready answers and resumes pending events with app auth", async () => {
    owners.events.mockResolvedValue([
      { eventId: "$synthetic-ready", state: "answer_ready" },
      { eventId: "$synthetic-pending", state: "pending" },
    ]);
    await fire().task;
    expect(owners.answer).toHaveBeenCalledExactlyOnceWith("$synthetic-ready");
    expect(owners.to).toHaveBeenCalledExactlyOnceWith(matrix, {
      eventId: "$synthetic-pending",
    });
    expect(owners.send).toHaveBeenCalledExactlyOnceWith(
      "Resume accepted Matrix event",
      { auth: appAuth }
    );
  });

  test("continues other candidates after one answer delivery fails", async () => {
    owners.events.mockResolvedValue(answerEvents(3));
    owners.answer.mockRejectedValueOnce(
      new Error("Synthetic delivery failure")
    );
    await fire().task;
    expect(owners.answer.mock.calls.map(([id]) => id)).toEqual([
      "$synthetic-event-0",
      "$synthetic-event-1",
      "$synthetic-event-2",
    ]);
  });

  test("bounds concurrent event delivery at two", async () => {
    owners.events.mockResolvedValue(answerEvents(5));
    const entered = Promise.withResolvers<void>();
    const release = Promise.withResolvers<void>();
    let active = 0;
    let maximum = 0;
    owners.answer.mockImplementation(async () => {
      active += 1;
      maximum = Math.max(maximum, active);
      if (active === 2) entered.resolve();
      await release.promise;
      active -= 1;
    });
    const tick = fire();
    await entered.promise;
    expect(owners.answer).toHaveBeenCalledTimes(2);
    release.resolve();
    await tick.task;
    expect(owners.answer).toHaveBeenCalledTimes(5);
    expect(maximum).toBe(2);
  });

  test("stops all subsequent classes when the shared deadline expires", async () => {
    owners.departures.mockImplementationOnce(async () => {
      vi.setSystemTime(30_000);
      return 1;
    });
    await expect(fire().task).rejects.toBeInstanceOf(TimeoutError);
    expect(owners.erasures).not.toHaveBeenCalled();
    expect(owners.joins).not.toHaveBeenCalled();
    expect(owners.rooms).not.toHaveBeenCalled();
    expect(owners.activity).not.toHaveBeenCalled();
    expect(owners.events).not.toHaveBeenCalled();
  });

  test("checks the deadline before each join completion", async () => {
    vi.setSystemTime(120_000);
    owners.joins.mockResolvedValue(joinCandidates(3));
    owners.completeJoin.mockImplementationOnce(async () => {
      vi.setSystemTime(150_000);
      return true;
    });
    await expect(fire().task).rejects.toBeInstanceOf(TimeoutError);
    expect(owners.completeJoin).toHaveBeenCalledExactlyOnceWith(
      "synthetic-binding-0",
      "better-auth:synthetic-user-0",
      150_000
    );
    expect(owners.rooms).not.toHaveBeenCalled();
    expect(owners.events).not.toHaveBeenCalled();
  });

  test("checks the deadline before each event dispatch", async () => {
    vi.setSystemTime(300_000);
    owners.events.mockResolvedValue(answerEvents(3));
    owners.answer.mockImplementationOnce(async () => {
      vi.setSystemTime(330_000);
    });
    await expect(fire().task).rejects.toBeInstanceOf(TimeoutError);
    expect(owners.answer).toHaveBeenCalledExactlyOnceWith("$synthetic-event-0");
    expect(owners.departures).not.toHaveBeenCalled();
  });

  test("shares overlapping tick work and permits another tick after completion", async () => {
    const release = Promise.withResolvers<number>();
    owners.departures.mockReturnValueOnce(release.promise);
    const first = fire();
    const second = fire();
    expect(second.task).toBe(first.task);
    expect(owners.departures).toHaveBeenCalledTimes(1);
    release.resolve(0);
    await first.task;
    await fire().task;
    expect(owners.departures).toHaveBeenCalledTimes(2);
  });

  test("retains one tick while an already started owner settles after the deadline", async () => {
    const entered = Promise.withResolvers<AbortSignal>();
    const release = Promise.withResolvers<number>();
    owners.departures.mockImplementationOnce(async () => {
      entered.resolve(operationSignal());
      return release.promise;
    });
    const first = fire();
    let settled = false;
    const outcome = first.task.then(
      () => {
        settled = true;
        return undefined;
      },
      (error: unknown) => {
        settled = true;
        return error;
      }
    );
    const signal = await entered.promise;
    await vi.advanceTimersByTimeAsync(30_000);
    expect(signal.aborted).toBe(true);
    expect(settled).toBe(false);
    const overlapping = fire();
    expect(overlapping.task).toBe(first.task);
    expect(owners.departures).toHaveBeenCalledTimes(1);
    expect(owners.erasures).not.toHaveBeenCalled();
    release.resolve(0);
    expect(await outcome).toBe(signal.reason);
    expect(settled).toBe(true);
    await fire().task;
    expect(owners.departures).toHaveBeenCalledTimes(2);
  });

  test("aborts owner work at the overall 30-second deadline", async () => {
    const entered = Promise.withResolvers<AbortSignal>();
    const blocked = Promise.withResolvers<number>();
    owners.departures.mockImplementationOnce(async () => {
      const signal = operationSignal();
      entered.resolve(signal);
      signal.addEventListener(
        "abort",
        () => {
          blocked.reject(signal.reason);
        },
        { once: true }
      );
      return blocked.promise;
    });
    const tick = fire();
    const outcome = tick.task.catch((error: unknown) => error);
    const signal = await entered.promise;
    expect(signal.aborted).toBe(false);
    await vi.advanceTimersByTimeAsync(30_000);
    await outcome;
    expect(signal.aborted).toBe(true);
    expect(owners.erasures).not.toHaveBeenCalled();
    expect(owners.events).not.toHaveBeenCalled();
  });

  test("preserves external cancellation and starts no later provider work", async () => {
    const controller = new AbortController();
    const entered = Promise.withResolvers<AbortSignal>();
    const blocked = Promise.withResolvers<number>();
    const cause = new Error("Synthetic caller cancellation");
    owners.events.mockResolvedValue(answerEvents(1));
    owners.departures.mockImplementationOnce(async () => {
      const signal = operationSignal();
      entered.resolve(signal);
      signal.addEventListener(
        "abort",
        () => {
          blocked.reject(signal.reason);
        },
        { once: true }
      );
      return blocked.promise;
    });
    const running = withSignal(controller.signal, async () => {
      await fire().task;
    });
    const outcome = running.catch((error: unknown) => error);
    const signal = await entered.promise;
    controller.abort(cause);
    await outcome;
    // Let the aborted owner's callback/catches settle without advancing Date.
    await new Promise<void>((resolve) => setImmediate(resolve));
    expect(signal.aborted).toBe(true);
    expect(signal.reason).toBe(cause);
    expect(owners.erasures).not.toHaveBeenCalled();
    expect(owners.joins).not.toHaveBeenCalled();
    expect(owners.rooms).not.toHaveBeenCalled();
    expect(owners.activity).not.toHaveBeenCalled();
    expect(owners.events).not.toHaveBeenCalled();
    expect(owners.answer).not.toHaveBeenCalled();
    expect(owners.to).not.toHaveBeenCalled();
  });
});
