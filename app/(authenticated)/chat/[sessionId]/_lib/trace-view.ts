import type { MessageStreamEvent } from "eve/client";
import type { EveMessage } from "eve/react";
import { z } from "zod";

const backgroundWorkerDelivery =
  /^Background task (\S+) \((?:browser-agent|agent)\) (?:update: |needs input\.$|is cancelled\.$|is completed\.\n\nResult:\n|failed\.\n\nError:\n)/u;
const backgroundWorkerAuthorization =
  /^Background task (\S+) needs authorization\.$/u;
const taskCancelResultSchema = z.object({
  kind: z.literal("tool-result"),
  output: z.object({ tasks: z.array(z.unknown()) }),
  toolName: z.literal("task_cancel"),
});
const cancelledWorkerTaskSchema = z.object({
  metadata: z.object({ name: z.enum(["browser-agent", "agent"]) }),
  status: z.literal("cancelled"),
  taskId: z.string(),
});

export type TraceView = "imessage" | "trace";

export function messagesForTraceView(
  messages: readonly EveMessage[],
  events: readonly MessageStreamEvent[],
  traceView: TraceView
) {
  if (traceView === "trace") return messages;
  const hiddenMessageIds = backgroundWorkerDeliveryMessageIds(events);
  return messages.filter((message) => !hiddenMessageIds.has(message.id));
}

export function backgroundWorkerDeliveryMessageIds(
  events: readonly MessageStreamEvent[]
) {
  // The runtime marks task-origin messages; user text cannot supply that provenance.
  const cancelledTaskIds = new Set<string>();
  const messageIds = new Set<string>();

  for (const event of events) {
    if (event.type === "action.result") {
      const result = taskCancelResultSchema.safeParse(event.data.result);
      if (!result.success) continue;
      for (const value of result.data.output.tasks) {
        const task = cancelledWorkerTaskSchema.safeParse(value);
        if (task.success) cancelledTaskIds.add(task.data.taskId);
      }
      continue;
    }

    if (
      event.type !== "message.received" ||
      event.data.kind !== "execution.background_task"
    )
      continue;
    const taskId = deliveredTaskId(event.data.message);
    if (taskId) {
      const isCancellation =
        /\((?:browser-agent|agent)\) is cancelled\.$/u.test(event.data.message);
      messageIds.add(`${event.data.turnId}:user`);
      if (isCancellation && cancelledTaskIds.delete(taskId)) {
        messageIds.add(`${event.data.turnId}:user`);
        messageIds.add(`${event.data.turnId}:assistant`);
      }
    }
  }

  return messageIds;
}

function deliveredTaskId(message: string) {
  return (
    backgroundWorkerDelivery.exec(message)?.[1] ??
    backgroundWorkerAuthorization.exec(message)?.[1]
  );
}
