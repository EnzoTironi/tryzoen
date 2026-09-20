import { defineHook } from "eve/hooks";
import { registerBackgroundReplyTarget } from "@agent/lib/reply-targets";
import { readAgentTaskReceipt } from "@agent/lib/task-receipt";

export default defineHook({
  events: {
    "action.result"(event, context) {
      const task = readAgentTaskReceipt(event);
      if (!task) return;
      registerBackgroundReplyTarget(task.taskId, context.session.auth);
    },
  },
});
