import { expect, it } from "vitest";
import { defaultMessageReducer, type MessageStreamEvent } from "eve/client";
import { visibleConversationMessages } from "./delivered";
import { messageText } from "./reply";

it("shows the delivered answer once after replay and makes it available to copy and reply", () => {
  const delivery = {
    type: "action.result",
    meta: { id: "delivery-event", at: "2026-09-27T12:00:00.000Z" },
    data: {
      turnId: "turn-1",
      sequence: 0,
      stepIndex: 0,
      status: "completed",
      result: {
        kind: "tool-result",
        toolName: "send_message",
        callId: "send-1",
        output: {
          kind: "message",
          text: "Your two ideas are saved.",
          deliveryId: "delivery-1",
        },
      },
    },
  } satisfies MessageStreamEvent;
  const complete = {
    type: "message.completed",
    meta: { id: "complete", at: "2026-09-27T12:00:01.000Z" },
    data: {
      turnId: "turn-1",
      sequence: 0,
      stepIndex: 1,
      finishReason: "stop",
      message: "DELIVERY_COMPLETE",
    },
  } satisfies MessageStreamEvent;
  const events = [delivery, delivery, complete];
  const reducer = defaultMessageReducer();
  const data = events.reduce(
    (current, event) => reducer.reduce(current, event),
    reducer.initial()
  );
  const visible = visibleConversationMessages(data.messages, events);
  expect(visible).toHaveLength(1);
  const answer = visible[0];
  expect(messageText(answer)).toBe("Your two ideas are saved.");
  expect(JSON.stringify(visible)).not.toContain("DELIVERY_COMPLETE");
});

it("retains a direct answer when no message tool was used and hides only the internal marker", () => {
  const messages = [
    {
      id: "direct",
      role: "assistant" as const,
      parts: [
        {
          type: "text" as const,
          text: "A useful answer",
          state: "done" as const,
          stepIndex: 0,
        },
      ],
    },
  ];
  expect(visibleConversationMessages(messages, [])).toEqual(messages);
  expect(
    visibleConversationMessages(
      [
        {
          id: "marker",
          role: "assistant",
          parts: [
            {
              type: "text",
              text: "DELIVERY_COMPLETE.",
              state: "done",
              stepIndex: 0,
            },
          ],
        },
      ],
      []
    )
  ).toEqual([]);
});
