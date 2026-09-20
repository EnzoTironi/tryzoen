import { describe, expect, it } from "vitest";
import backgroundReplyTargetHook from "@agent/hooks/background-reply-target";
import scheduledCompletionHook from "@agent/hooks/scheduled-run-completion";
import observabilityHook from "@agent/hooks/observability";
import evlogHook from "@agent/hooks/evlog";

describe("public Eve hook subscriptions", () => {
  it.each([
    ["background reply targets", backgroundReplyTargetHook],
    ["scheduled run completion", scheduledCompletionHook],
    ["observability", observabilityHook],
    ["evlog", evlogHook],
  ] as const)(
    "%s does not subscribe to historical subagent callbacks",
    (_name, hook) => {
      expect(
        Object.keys(hook.events ?? {}).filter(
          (event) => event === "*" || event.startsWith("subagent.")
        )
      ).toEqual([]);
    }
  );

  it("keeps background delivery and scheduled completion on native action results", () => {
    expect(Object.keys(backgroundReplyTargetHook.events ?? {})).toContain(
      "action.result"
    );
    expect(Object.keys(scheduledCompletionHook.events ?? {})).toContain(
      "action.result"
    );
  });

  it("keeps lifecycle, tool outcomes and model usage observable", () => {
    expect(Object.keys(observabilityHook.events ?? {})).toEqual(
      expect.arrayContaining([
        "session.started",
        "message.received",
        "step.started",
        "step.completed",
        "action.result",
        "turn.failed",
        "session.failed",
        "session.waiting",
        "session.completed",
      ])
    );
  });
});
