import type { MessageStreamEvent } from "eve/client";

export function messageTimestamps(events: readonly MessageStreamEvent[]) {
  const timestamps = new Map<string, string>();

  for (const event of events) {
    if (event.type === "message.received") {
      timestamps.set(`${event.meta.id}:user`, event.meta.at);
    }

    if (
      event.type === "message.completed" &&
      event.data.finishReason !== "tool-calls"
    ) {
      timestamps.set(`${event.data.turnId}:assistant`, event.meta.at);
    }
  }

  return timestamps;
}

export function imessageTimestamps(events: readonly MessageStreamEvent[]) {
  const timestamps = new Map<string, string>();

  for (const event of events) {
    if (event.type === "message.received") {
      timestamps.set(`${event.meta.id}:user`, event.meta.at);
    }
  }

  return timestamps;
}
