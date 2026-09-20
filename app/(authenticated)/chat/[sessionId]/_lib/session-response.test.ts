import { Client, type MessageStreamEvent } from "eve/client";
import { afterEach, expect, it, vi } from "vitest";

afterEach(() => vi.unstubAllGlobals());

it("native response results release a parked approval before its answer", async () => {
  const cancelled = vi.fn<() => void>();
  const events = [
    {
      type: "message.received",
      data: { message: "Prepare the action", sequence: 0, turnId: "turn" },
      meta: {
        id: "received",
        at: "2026-09-19T12:00:00.000Z",
        deliveryIds: ["delivery"],
      },
    },
    {
      type: "input.requested",
      data: {
        sequence: 1,
        stepIndex: 0,
        turnId: "turn",
        requests: [
          {
            kind: "tool-approval",
            requestId: "approval",
            action: {
              kind: "tool-call",
              callId: "action-call",
              toolName: "action",
              input: {},
            },
            prompt: "Perform this action?",
            options: [
              { id: "approve", label: "Approve" },
              { id: "cancel", label: "Cancel" },
            ],
          },
        ],
      },
      meta: {
        id: "requested",
        at: "2026-09-19T12:00:01.000Z",
        deliveryIds: ["delivery"],
      },
    },
    {
      type: "session.waiting",
      data: { continuationToken: "", wait: "next-user-message" },
      meta: {
        id: "waiting",
        at: "2026-09-19T12:00:02.000Z",
        deliveryIds: ["delivery"],
      },
    },
  ] satisfies MessageStreamEvent[];
  const encoder = new TextEncoder();
  const fetchMock = vi.fn<typeof fetch>(async (_input, init) => {
    if (init?.method === "POST")
      return Response.json({
        sessionId: "conversation",
        deliveryId: "delivery",
      });
    // Deliberately remain open: result() must close its reader at the waiting boundary.
    return new Response(
      new ReadableStream({
        start(controller) {
          controller.enqueue(
            encoder.encode(
              events.map((event) => JSON.stringify(event)).join("\n") + "\n"
            )
          );
        },
        cancel: cancelled,
      }),
      {
        headers: {
          "content-type": "application/x-ndjson",
          "x-eve-stream-version": "25",
        },
      }
    );
  });
  vi.stubGlobal("fetch", fetchMock);
  const session = new Client({ host: "https://zoen.test" }).sessions.attach(
    "conversation"
  );
  const response = await session.send("Prepare the action");
  const result = await response.result();
  expect(result.status).toBe("waiting");
  expect(result.inputRequests).toHaveLength(1);
  expect(result.inputRequests[0]?.requestId).toBe("approval");
  expect(cancelled).toHaveBeenCalled();
  await session.respond([{ requestId: "approval", optionId: "cancel" }]);
  expect(fetchMock).toHaveBeenLastCalledWith(
    "https://zoen.test/eve/v1/session/conversation",
    expect.objectContaining({
      method: "POST",
      body: JSON.stringify({
        inputResponses: [{ requestId: "approval", optionId: "cancel" }],
      }),
    })
  );
});
