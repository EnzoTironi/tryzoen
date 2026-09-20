import { withSignal } from "../../server/operations/async";
import { z } from "zod";
import { TRPCError } from "@trpc/server";
import {
  readDiagnosticSession,
  readInsights,
  reviewDiagnostic,
} from "../../server/observability/insights";
import {
  readTelemetryPolicy,
  updateTelemetryPolicy,
} from "../../server/observability/events";
import { workspaceProcedure } from "./workspace-procedure";

const failure = () =>
  new TRPCError({
    code: "FORBIDDEN",
    message: "Diagnostic access unavailable.",
  });
export const insightsRouter = {
  policy: workspaceProcedure.query(({ ctx, signal }) =>
    withSignal(signal, async () => readTelemetryPolicy(ctx.actor.workspaceId))
  ),
  read: workspaceProcedure
    .input(z.object({ platform: z.boolean() }))
    .query(({ ctx, input, signal }) =>
      withSignal(signal, async () => {
        try {
          return await readInsights(ctx.actor, input.platform);
        } catch {
          throw failure();
        }
      })
    ),
  session: workspaceProcedure
    .input(
      z.object({
        sessionId: z.string().max(200),
        platform: z.boolean(),
        cursor: z.optional(z.nullable(z.string().max(200))),
      })
    )
    .query(({ ctx, input, signal }) =>
      withSignal(signal, async () => {
        try {
          return await readDiagnosticSession(
            ctx.actor,
            input.sessionId,
            input.platform,
            input.cursor ?? null
          );
        } catch {
          throw failure();
        }
      })
    ),
  review: workspaceProcedure
    .input(
      z.object({
        sessionId: z.string().max(200),
        status: z.enum(["new", "investigating", "resolved", "eval-candidate"]),
      })
    )
    .mutation(({ ctx, input, signal }) =>
      withSignal(signal, async () => {
        try {
          await reviewDiagnostic(ctx.actor, input.sessionId, input.status);
          return;
        } catch {
          throw failure();
        }
      })
    ),
  configure: workspaceProcedure
    .input(
      z.object({
        captureContent: z.boolean(),
        retentionDays: z.literal([7, 14, 30]),
      })
    )
    .mutation(({ ctx, input, signal }) =>
      withSignal(signal, async () => {
        try {
          await updateTelemetryPolicy(
            ctx.actor,
            input.captureContent,
            input.retentionDays
          );
          return;
        } catch {
          throw failure();
        }
      })
    ),
};
