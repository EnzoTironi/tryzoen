import { defineEval } from "eve/evals";
import { equals, includes } from "eve/evals/expect";
import {
  requireStreamIndex,
  requireWorkerSessionId,
} from "@evals/browser/session";
import { readTaskCompletion } from "@evals/browser/worker-events";
import { sendMessageToolResultSchema } from "@shared/chat/message-delivery";
import { reactToMessageToolResultSchema } from "@shared/chat/reaction";

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
    // Only the resumed parent slice can prove delivery. Child results and the
    // original acknowledgment are not replies to the user.
    const deliveries = reply.events.flatMap((event) => {
      if (event.type !== "action.result" || event.data.status !== "completed")
        return [];
      const sent = sendMessageToolResultSchema.safeParse(event.data.result);
      if (sent.success)
        return [
          sent.data.output.kind === "message"
            ? (sent.data.output.text ?? "")
            : sent.data.output.url,
        ];
      const reaction = reactToMessageToolResultSchema.safeParse(
        event.data.result
      );
      // A delivered reaction also suppresses the assistant-text fallback in web chat.
      return reaction.success && reaction.data.output.operation === "add"
        ? [""]
        : [];
    });
    const committedReply = reply.events
      .filter((event) => event.type === "message.completed")
      .findLast((event) => event.data.finishReason !== "tool-calls")
      ?.data.message;
    const answer = deliveries.length
      ? deliveries.join("\n")
      : (committedReply ?? "");
    t.check(answer, includes("Example Domain")).label(
      "parent delivers the verified browser heading in web chat"
    );
  },
});
