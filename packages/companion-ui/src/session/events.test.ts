import type { MessageStreamEvent } from "eve/client";
import { expect, it } from "vitest";
import { isTerminalSession, latestSessionFailure } from "./events";

const failed = {
  type: "turn.failed",
  meta: { id: "failed", at: "2026-10-03T12:00:00Z" },
  data: {
    turnId: "turn_0",
    sequence: 0,
    code: "MODEL_CALL_FAILED",
    message: "Private provider diagnostic",
  },
} satisfies MessageStreamEvent;

const waiting = {
  type: "session.waiting",
  meta: { id: "waiting", at: "2026-10-03T12:00:01Z" },
  data: { continuationToken: "session", wait: "next-user-message" },
} satisfies MessageStreamEvent;

it("retains a recoverable model failure through the idle boundary and history replay", () => {
  const replayed = structuredClone([failed, waiting]);
  expect(latestSessionFailure(replayed)).toEqual(failed);
  expect(isTerminalSession(replayed)).toBe(false);
});

it.each(["turn.started", "turn.completed", "turn.cancelled"] as const)(
  "clears the previous failure when the next turn emits %s",
  (type) => {
    const next = {
      type,
      meta: { id: "next", at: "2026-10-03T12:00:02Z" },
      data: { turnId: "turn_1", sequence: 1 },
    } satisfies MessageStreamEvent;
    expect(latestSessionFailure([failed, waiting, next])).toBeUndefined();
  }
);

it("recognizes terminal session failure without treating it as a recoverable turn", () => {
  const terminal = {
    type: "session.failed",
    meta: { id: "terminal", at: "2026-10-03T12:00:02Z" },
    data: { sessionId: "session", code: "FAILED", message: "Private detail" },
  } satisfies MessageStreamEvent;
  expect(latestSessionFailure([terminal])).toEqual(terminal);
  expect(isTerminalSession([terminal])).toBe(true);
});

it("does not turn a recoverable step error or an approval wait into a failed answer", () => {
  const step = {
    type: "step.failed",
    meta: { id: "step", at: "2026-10-03T12:00:00Z" },
    data: {
      turnId: "turn_0",
      sequence: 0,
      stepIndex: 0,
      code: "TEMPORARY",
      message: "Private step diagnostic",
    },
  } satisfies MessageStreamEvent;
  expect(latestSessionFailure([step, waiting])).toBeUndefined();
  expect(latestSessionFailure([])).toBeUndefined();
});
