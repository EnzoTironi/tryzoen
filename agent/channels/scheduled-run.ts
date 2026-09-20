import { withSignal } from "../../server/operations/async";
import { jsonString } from "@shared/validation";
import { z } from "zod";
import { requireScheduledChannelOwner } from "../../server/schedules/channel-owner";
import { defineChannel, POST } from "eve/channels";
import { parseInputResponses, resolveTextToResponses } from "eve/client";

import {
  InternalCallbackRejected,
  readAuthenticatedInternalCallback,
  internalCallbackBodies,
} from "../../server/internal/callback-auth";
import { dispatchScheduledReport } from "@agent/lib/schedules/report";
import {
  claimScheduledAgentRunInput,
  getScheduledReportChannel,
  finishScheduledAgentRunInput,
  restoreScheduledAgentRunInput,
} from "@db/services/scheduled-agent-jobs";

const scheduledRunTargetSchema = z.object({
  restart: z.optional(z.boolean()),
  runId: z.uuid(),
});

export default defineChannel({
  async receive(input, { from }) {
    const target = await scheduledRunTargetSchema
      .strict()
      .parseAsync(input.target);
    const source = from(`scheduled-run:${target.runId}`);
    if (target.restart) {
      await source.reset({
        reason: "Scheduled worker exceeded its runtime.",
      });
    }
    return source.send(input.message, {
      auth: input.auth,
      title: `Scheduled run ${target.runId}`,
    });
  },
  routes: [
    POST(
      "/internal/scheduled-run/report",
      async (request, { attachSession, to, waitUntil }) => {
        return withSignal(request.signal, async () => {
          try {
            const raw = await readAuthenticatedInternalCallback(
              request,
              "/internal/scheduled-run/report"
            );
            if (raw instanceof Response) return raw;
            const input = await Promise.try(async () =>
              jsonString(
                internalCallbackBodies[
                  "/internal/scheduled-run/report"
                ].strict()
              ).parseAsync(raw.toString("utf8"))
            ).catch(() => {
              throw new InternalCallbackRejected({ status: 400 });
            });
            const channel = await getScheduledReportChannel(input.runId);
            if (channel)
              waitUntil(
                dispatchScheduledReport(
                  { attachSession, to },
                  input.runId,
                  channel
                )
              );
            return new Response(null, { status: 202 });
          } catch (error) {
            if (error instanceof InternalCallbackRejected)
              return new Response("Scheduled callback rejected", {
                status: error.status,
              });
            throw error;
          }
        });
      }
    ),
    POST(
      "/internal/scheduled-run/respond",
      async (request, { attachSession }) => {
        const decoded = await withSignal(request.signal, async () => {
          return await Promise.try(async () => {
            const raw = await readAuthenticatedInternalCallback(
              request,
              "/internal/scheduled-run/respond"
            );
            if (raw instanceof Response) return raw;
            try {
              return await jsonString(
                internalCallbackBodies[
                  "/internal/scheduled-run/respond"
                ].strict()
              ).parseAsync(raw.toString("utf8"));
            } catch {
              throw new InternalCallbackRejected({ status: 400 });
            }
          }).then(
            (value) => ({ ok: true as const, value }),
            (error: unknown) => ({ ok: false as const, error })
          );
        });
        if (!decoded.ok) {
          const failure = decoded.error;
          const status =
            failure instanceof InternalCallbackRejected ? failure.status : 503;
          return new Response("Scheduled callback rejected", { status });
        }
        if (decoded.value instanceof Response) return decoded.value;
        const input = decoded.value;
        const claimed = await claimScheduledAgentRunInput(
          input.runId,
          input.leaseToken
        );
        if (
          !claimed?.run.pendingInputRequests ||
          !claimed.run.workerSessionId
        ) {
          return new Response(null, { status: 409 });
        }
        const responses = parseInputResponses(
          resolveTextToResponses(input.answer, claimed.run.pendingInputRequests)
        );
        if (responses.length === 0) {
          await restoreScheduledAgentRunInput(
            input.runId,
            input.leaseToken,
            "The answer did not match the pending request."
          );
          return new Response(null, { status: 422 });
        }
        try {
          const channel = claimed.job.conversationChannel;
          if (channel === "telegram" || channel === "kapso") {
            await requireScheduledChannelOwner({
              ...claimed.job,
              conversationChannel: channel,
            });
          }
          const attributes = {
            conversationChannel: claimed.job.conversationChannel,
            conversationId: claimed.job.conversationId,
            scheduleId: claimed.job.id,
            scheduledRunId: claimed.run.id,
            workspaceId: claimed.job.workspaceId,
          };
          const result = await attachSession(
            claimed.run.workerSessionId
          ).respond(responses, {
            auth: {
              attributes:
                channel === "telegram" || channel === "kapso"
                  ? {
                      ...attributes,
                      channelIdentityId: claimed.job.conversationId,
                    }
                  : attributes,
              authenticator: "scheduled-input",
              issuer: "open-instinct",
              principalId: claimed.job.createdByUserId,
              principalType: "user",
            },
          });
          if (result.status !== "accepted") {
            await restoreScheduledAgentRunInput(
              input.runId,
              input.leaseToken,
              "The scheduled session is no longer active."
            );
            return new Response(null, { status: 409 });
          }
          await finishScheduledAgentRunInput(input.runId, input.leaseToken);
          return new Response(null, { status: 202 });
        } catch (error) {
          await restoreScheduledAgentRunInput(
            input.runId,
            input.leaseToken,
            error instanceof Error ? error.message : String(error)
          );
          return new Response(null, { status: 502 });
        }
      }
    ),
  ],
});
