import type { drainSessionSources } from "../../../server/memory/session-capture";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const drain = vi.hoisted(() => vi.fn<typeof drainSessionSources>());
const configuration = vi.hoisted(() => ({
  ZOEN_MEMORY_INGESTION_CONCURRENCY: 1,
}));
vi.mock("../../../server/memory/session-capture", () => ({
  drainSessionSources: drain,
}));
vi.mock("@shared/environment", () => ({ env: configuration }));

import schedule from "@agent/schedules/session-archive";

describe("session archive schedule", () => {
  beforeEach(() => {
    configuration.ZOEN_MEMORY_INGESTION_CONCURRENCY = 1;
    drain.mockReset().mockResolvedValue({ configured: true, stored: 0 });
  });

  afterEach(() => vi.restoreAllMocks());

  it("continues beyond one dispatch and stops when the queue is empty", async () => {
    drain
      .mockResolvedValueOnce({ configured: true, stored: 125 })
      .mockResolvedValueOnce({ configured: true, stored: 3 });

    await schedule.run();

    expect(drain).toHaveBeenCalledTimes(3);
  });

  it("waits for every configured worker before starting another round", async () => {
    configuration.ZOEN_MEMORY_INGESTION_CONCURRENCY = 3;
    const workers = Array.from({ length: 3 }, () =>
      Promise.withResolvers<Awaited<ReturnType<typeof drainSessionSources>>>()
    );
    for (const worker of workers) drain.mockReturnValueOnce(worker.promise);

    const running = schedule.run();
    expect(drain).toHaveBeenCalledTimes(3);
    workers[0]?.resolve({ configured: true, stored: 25 });
    await Promise.resolve();
    expect(drain).toHaveBeenCalledTimes(3);
    for (const worker of workers.slice(1))
      worker.resolve({ configured: true, stored: 25 });
    await running;

    expect(drain).toHaveBeenCalledTimes(6);
  });

  it("shares overlapping ticks and allows a new tick after completion", async () => {
    const worker =
      Promise.withResolvers<Awaited<ReturnType<typeof drainSessionSources>>>();
    drain.mockReturnValueOnce(worker.promise);
    const first = schedule.run();
    const overlap = schedule.run();

    expect(overlap).toBe(first);
    expect(drain).toHaveBeenCalledTimes(1);
    worker.resolve({ configured: true, stored: 0 });
    await Promise.all([first, overlap]);
    await schedule.run();

    expect(drain).toHaveBeenCalledTimes(2);
  });

  it("finishes healthy workers and later work before surfacing failures", async () => {
    configuration.ZOEN_MEMORY_INGESTION_CONCURRENCY = 2;
    const healthy =
      Promise.withResolvers<Awaited<ReturnType<typeof drainSessionSources>>>();
    const cause = new Error("One account needs repair.");
    drain.mockRejectedValueOnce(cause).mockReturnValueOnce(healthy.promise);
    const running = schedule.run();
    const outcome = running.catch((error: unknown) => error);

    await Promise.resolve();
    expect(schedule.run()).toBe(running);
    expect(drain).toHaveBeenCalledTimes(2);
    healthy.resolve({ configured: true, stored: 25 });
    const error = await outcome;
    if (!(error instanceof AggregateError))
      throw new Error("Expected failed batch");
    expect(error.errors).toEqual([cause]);
    expect(drain).toHaveBeenCalledTimes(4);

    await schedule.run();
    expect(drain).toHaveBeenCalledTimes(6);
  });

  it("stops starting work at the time budget without abandoning active delivery", async () => {
    const clock = vi.spyOn(performance, "now").mockReturnValue(0);
    const worker =
      Promise.withResolvers<Awaited<ReturnType<typeof drainSessionSources>>>();
    drain.mockImplementationOnce(() => {
      clock.mockReturnValue(45_000);
      return worker.promise;
    });
    const running = schedule.run();
    expect(schedule.run()).toBe(running);
    worker.resolve({ configured: true, stored: 125 });
    await running;

    expect(drain).toHaveBeenCalledTimes(1);
  });

  it("bounds repeated dispatch even when the backlog never empties", async () => {
    configuration.ZOEN_MEMORY_INGESTION_CONCURRENCY = 4;
    vi.spyOn(performance, "now").mockReturnValue(0);
    drain.mockResolvedValue({ configured: true, stored: 125 });

    await schedule.run();

    expect(drain).toHaveBeenCalledTimes(32);
  });

  it("does not loop when archive storage is not configured", async () => {
    drain.mockResolvedValue({ configured: false, stored: 0 });

    await schedule.run();

    expect(drain).toHaveBeenCalledTimes(1);
  });
});
