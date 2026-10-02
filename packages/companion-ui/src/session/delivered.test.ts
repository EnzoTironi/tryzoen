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

// Captured from the authenticated synthetic demo's persisted native tool history,
// root-turn-1-tool-history.json (2026-09-30), not an injected UI card.
const persistedQueryOutput = {
  rows: [
    {
      task: "Prepare product captures",
      owner: "Imani Brooks",
      status: "in_progress",
    },
    {
      task: "Review story outline",
      owner: "Maya Chen",
      status: "in_review",
    },
    {
      task: "Review captions",
      owner: "Theo Park",
      status: "in_review",
    },
  ],
  manifest: {
    id: "ae004048-69f8-4d46-80bb-85867d6aac1e",
    engine: "malloy-0.0.434/pglite-snapshot",
    inputSha256:
      "90cfe7cd00da7adbcadae26b25a76a356690d43f994278f716fc557503dcf9d8",
    sqlSha256:
      "de18998f1cb5929efd340cfe70bc4b65aedf3a144d1e3446a13300496087540a",
    startedAt: "2026-09-30T19:43:13.190Z",
    completedAt: "2026-09-30T19:43:17.599Z",
    actor: "better-auth:zoen-investor-demo-v1-maya",
    workspaceId: "zoen-investor-demo-workspace",
    revision: "d200bed779fd7c3af43a165f2015394afb433e0e",
    query: "knowledge/queries/open-launch-tasks.json",
    arguments: {},
    sql: 'WITH __stage0 AS (\n  SELECT \n     base."task" as "task",\n     base."owner" as "owner",\n     base."status" as "status"\n  FROM public.launch_tasks as base\n  WHERE COALESCE(base."status"!=\'done\',true)\n  ORDER BY 2 asc NULLS LAST,1 asc NULLS LAST\n)\nSELECT row_to_json(finalStage) as row FROM __stage0 AS finalStage',
    sources: [
      {
        path: "knowledge/queries/open-launch-tasks.json",
        sha256:
          "b301f1ab278f88e2bf183e5460d4fdd349000f1a3dc4e6267e101a57faa445a4",
      },
      {
        path: "knowledge/models/launch_tasks.malloy",
        sha256:
          "2887e2b68eafe5bafd02881942c22e20d2245a6d5968773458790cd9de471208",
      },
      {
        path: "knowledge/data/launch_tasks.csv",
        sha256:
          "d8f7f024e5bb81d28902c21363eab66071b50df73b74ebba7ef37e9308d220c0",
      },
    ],
    freshness: "Published CSV snapshot; live provider freshness is unknown",
    limits: {
      rows: 100,
      resultBytes: 65536,
      deadlineMs: 15000,
      memoryBytes: 1610612736,
      memoryController: "cgroup-v2",
    },
  },
};

function replayQuery(
  output: unknown = persistedQueryOutput,
  toolName = "workspace_knowledge_query"
) {
  const events = [
    {
      type: "actions.requested",
      meta: { id: "requested", at: "2026-09-30T19:43:12.829Z" },
      data: {
        turnId: "turn_0",
        sequence: 0,
        stepIndex: 6,
        actions: [
          {
            kind: "tool-call",
            toolName,
            callId: "call_H8rMBTGBt9k6rrWvNK9ofoky",
            input: {
              path: "knowledge/queries/open-launch-tasks.json",
              revision: persistedQueryOutput.manifest.revision,
              arguments: {},
            },
          },
        ],
      },
    },
    {
      type: "action.result",
      meta: { id: "query-result", at: "2026-09-30T19:43:17.619Z" },
      data: {
        turnId: "turn_0",
        sequence: 0,
        stepIndex: 6,
        status: "completed",
        result: {
          kind: "tool-result",
          toolName,
          callId: "call_H8rMBTGBt9k6rrWvNK9ofoky",
          output,
        },
      },
    },
    {
      type: "action.result",
      meta: { id: "send-result", at: "2026-09-30T19:43:27.692Z" },
      data: {
        turnId: "turn_0",
        sequence: 0,
        stepIndex: 7,
        status: "completed",
        result: {
          kind: "tool-result",
          toolName: "send_message",
          callId: "call_G2TzsQyvRvYigrjEKNkUG6gs",
          output: { kind: "message", text: "Three open launch tasks." },
        },
      },
    },
    {
      type: "message.completed",
      meta: { id: "complete-query", at: "2026-09-30T19:43:28.000Z" },
      data: {
        turnId: "turn_0",
        sequence: 0,
        stepIndex: 8,
        finishReason: "stop",
        message: "DELIVERY_COMPLETE",
      },
    },
  ] satisfies MessageStreamEvent[];
  const reducer = defaultMessageReducer();
  const data = events.reduce(
    (current, event) => reducer.reduce(current, event),
    reducer.initial()
  );
  return { events, messages: data.messages };
}

it("retains the validated persisted knowledge result beside the delivered answer after native replay", () => {
  const { events, messages } = replayQuery();
  const originalPart = messages[0]?.parts.find(
    (part) =>
      part.type === "dynamic-tool" &&
      part.toolName === "workspace_knowledge_query"
  );
  expect(originalPart).toMatchObject({
    type: "dynamic-tool",
    state: "output-available",
    toolMetadata: {
      eve: { kind: "tool-call", name: "workspace_knowledge_query" },
    },
    output: persistedQueryOutput,
  });
  const visible = visibleConversationMessages(messages, events);
  expect(visible.map(messageText)).toEqual(["Three open launch tasks.", ""]);
  expect(visible[1]?.parts).toEqual([originalPart]);
  expect(visible[1]?.parts[0]).toBe(originalPart);
  expect(JSON.stringify(visible)).not.toContain("DELIVERY_COMPLETE");
  // Replaying the same durable snapshot keeps the same result and delivery IDs.
  expect(visibleConversationMessages(messages, events)).toEqual(visible);
});

it.each([
  ["missing provenance", { rows: persistedQueryOutput.rows }],
  [
    "invalid provenance hash",
    {
      ...persistedQueryOutput,
      manifest: { ...persistedQueryOutput.manifest, inputSha256: "invalid" },
    },
  ],
  [
    "missing workspace",
    {
      ...persistedQueryOutput,
      manifest: { ...persistedQueryOutput.manifest, workspaceId: "" },
    },
  ],
  [
    "extra unvalidated output",
    { ...persistedQueryOutput, internal: "must remain hidden" },
  ],
])("hides a knowledge result with %s", (_reason, output) => {
  const { events, messages } = replayQuery(output);
  const visible = visibleConversationMessages(messages, events);
  expect(visible).toHaveLength(1);
  expect(messageText(visible[0])).toBe("Three open launch tasks.");
});

it.each(["workspace_files_read", "send_message", "internal_query"])(
  "does not expose internal %s outputs even when their shape matches a query result",
  (toolName) => {
    const { events, messages } = replayQuery(persistedQueryOutput, toolName);
    expect(
      visibleConversationMessages(messages, events)
        .flatMap((message) => message.parts)
        .every((part) => part.type !== "dynamic-tool")
    ).toBe(true);
  }
);

it("hides preliminary knowledge output until the native terminal result is available", () => {
  const { events } = replayQuery();
  const requested = events.at(0);
  const result = events.at(1);
  if (!requested || result?.type !== "action.result")
    throw new Error("Expected native result event");
  const partial = { ...result, type: "action.partial" as const };
  const partialEvents = [requested, partial];
  const reducer = defaultMessageReducer();
  const data = partialEvents.reduce(
    (current, event) => reducer.reduce(current, event),
    reducer.initial()
  );
  expect(data.messages[0]?.parts).toContainEqual(
    expect.objectContaining({ state: "output-available", partial: true })
  );
  expect(visibleConversationMessages(data.messages, partialEvents)).toEqual([]);
});

it.each(["FAILED", "TOOL_EXECUTION_DENIED"])(
  "hides a failed or denied query result (%s) from native replay",
  (code) => {
    const { events } = replayQuery();
    const requested = events.at(0);
    const result = events.at(1);
    if (!requested || result?.type !== "action.result")
      throw new Error("Expected native result event");
    const failed = {
      ...result,
      data: {
        ...result.data,
        status: "failed" as const,
        error: { code, message: "Not available" },
      },
    } satisfies MessageStreamEvent;
    const failedEvents = [requested, failed];
    const reducer = defaultMessageReducer();
    const data = failedEvents.reduce(
      (current, event) => reducer.reduce(current, event),
      reducer.initial()
    );
    expect(visibleConversationMessages(data.messages, failedEvents)).toEqual(
      []
    );
  }
);

it("preserves existing approval prompts without turning them into query results", () => {
  const { messages } = replayQuery();
  const originalMessage = messages.at(0);
  const part = originalMessage?.parts.find(
    (candidate) => candidate.type === "dynamic-tool"
  );
  if (!originalMessage || !part) throw new Error("Expected native tool part");
  const prompt = {
    ...part,
    toolName: "internal_review",
    state: "approval-requested" as const,
    input: {},
    approval: { id: "request-review" },
    toolMetadata: {
      eve: {
        kind: "tool-call" as const,
        name: "internal_review",
        inputRequest: {
          kind: "question" as const,
          requestId: "request-review",
          prompt: "Review before continuing.",
        },
      },
    },
  };
  const message = { ...originalMessage, parts: [prompt] };
  expect(visibleConversationMessages([message], [])).toEqual([message]);
});
