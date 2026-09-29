import type { drainMemoryErasures } from "../../../server/memory/erasure";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const drain = vi.hoisted(() => vi.fn<typeof drainMemoryErasures>());
vi.mock("../../../server/memory/erasure", () => ({
  drainMemoryErasures: drain,
}));
import schedule from "@agent/schedules/memory-erasure";

describe("memory erasure schedule", () => {
  beforeEach(() => drain.mockReset().mockResolvedValue({ cleared: 0 }));
  afterEach(() => vi.restoreAllMocks());

  it("drains beyond one batch, surfaces failures after healthy work and shares overlapping ticks", async () => {
    const pending =
      Promise.withResolvers<Awaited<ReturnType<typeof drainMemoryErasures>>>();
    const failure = new Error("Synthetic failed partition");
    drain
      .mockReturnValueOnce(pending.promise)
      .mockRejectedValueOnce(failure)
      .mockResolvedValueOnce({ cleared: 3 });
    const first = schedule.run();
    const outcome = first.catch((error: unknown) => error);
    expect(schedule.run()).toBe(first);
    pending.resolve({ cleared: 5 });
    expect(await outcome).toMatchObject({ errors: [failure] });
    expect(drain).toHaveBeenCalledTimes(4);
    await schedule.run();
    expect(drain).toHaveBeenCalledTimes(5);
  });

  it("does not abandon a running filesystem operation at its soft deadline", async () => {
    const clock = vi.spyOn(performance, "now").mockReturnValue(0);
    const pending =
      Promise.withResolvers<Awaited<ReturnType<typeof drainMemoryErasures>>>();
    drain.mockImplementationOnce(() => {
      clock.mockReturnValue(45_000);
      return pending.promise;
    });
    const running = schedule.run();
    expect(schedule.run()).toBe(running);
    pending.resolve({ cleared: 5 });
    await running;
    expect(drain).toHaveBeenCalledTimes(1);
  });

  it("bounds work even when the backlog never empties", async () => {
    vi.spyOn(performance, "now").mockReturnValue(0);
    drain.mockResolvedValue({ cleared: 5 });
    await schedule.run();
    expect(drain).toHaveBeenCalledTimes(8);
  });
});
