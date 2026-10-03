import type { MessageStreamEvent } from "eve/client";

export function latestSessionFailure(events: readonly MessageStreamEvent[]) {
  for (let index = events.length - 1; index >= 0; index -= 1) {
    const event = events[index];
    if (!event) continue;
    switch (event.type) {
      case "turn.failed":
      case "session.failed":
        return event;
      case "turn.started":
      case "turn.completed":
      case "turn.cancelled":
      case "session.completed":
      case "context.cleared":
        return undefined;
    }
  }
  return undefined;
}

export function isTerminalSession(events: readonly MessageStreamEvent[]) {
  return events.some(
    (event) =>
      event.type === "session.failed" || event.type === "session.completed"
  );
}

export function conversationStreamEvents(
  events: readonly MessageStreamEvent[]
): readonly MessageStreamEvent[] {
  return events.map((event) => {
    // Eve approval continuations can omit their turn ID while retaining the sequence.
    // Give those turns a stable UI identity without changing the persisted event.
    if (
      "data" in event &&
      "turnId" in event.data &&
      !event.data.turnId &&
      "sequence" in event.data
    ) {
      return Object.assign({}, event, {
        data: {
          ...event.data,
          turnId: `continuation:${event.data.sequence}`,
        },
      });
    }
    return event;
  });
}
