import { defineEval } from "eve/evals";
import { equals, includes } from "eve/evals/expect";
import {
  requireStreamIndex,
  requireWorkerSessionId,
} from "@evals/browser/session";
import { readTaskCompletion } from "@evals/browser/worker-events";

export default defineEval({
  description:
    "Delegate a real browser task with native Eve tools and close its browser",
  tags: ["launch", "browser", "live-model", "live-provider", "synthetic-data"],
  timeoutMs: 240_000,
  async test(t) {
    const started = await t.send(
      "Use the browser to visually inspect https://example.com and report its exact primary heading. This requires a browser, not web_fetch. Close the browser after reading it. Do not log in, submit forms or send external messages."
    );
    const replyIndex = requireStreamIndex(started.session);
    const childId = await requireWorkerSessionId(t, started);
    const child = await t.target.attachSession(childId);
    child.succeeded();
    child
      .noFailedActions()
      .soft()
      .label("browser native actions without failure");
    child.calledTool("manage_browsers", {
      status: "completed",
      count: 1,
      input: { action: "create" },
    });
    child.calledTool("manage_browsers", {
      status: "completed",
      count: 1,
      input: { action: "delete" },
    });
    t.check(
      child.events.some(
        (event) =>
          event.type === "action.result" &&
          event.data.result.kind === "tool-result" &&
          !event.data.result.isError &&
          [
            "playwright_execute",
            "browser_snapshot",
            "computer_action",
          ].includes(event.data.result.toolName)
      ),
      equals(true)
    ).label("real browser page inspection through DOM or screenshot");
    const completion = readTaskCompletion(child.events);
    t.check(completion?.status, equals("success"));
    t.check(completion?.message, includes("Example Domain"));
    child.event("result.completed", { count: 1 });
    const reply = await t.target.attachSession(started.sessionId, {
      startIndex: replyIndex,
    });
    reply.succeeded();
    reply.calledTool("send_message", {
      status: "completed",
      output: { text: /Example Domain/u },
    });
  },
});
