import { withSignal } from "../../server/operations/async";
import { z } from "zod";
import { TRPCError } from "@trpc/server";
import {
  ModelChallengeSchema,
  ModelProviderSchema,
  WorkspaceModelSchema,
} from "../../shared/models/catalog";
import {
  disconnectModel,
  finishModelConnection,
  readModelConnection,
  selectWorkspaceModel,
  startModelConnection,
} from "../../server/models/connections";
import { workspaceProcedure } from "./workspace-procedure";

const failure = () =>
  new TRPCError({
    code: "BAD_REQUEST",
    message: "Model connection unavailable. Please reconnect.",
  });

export const modelsRouter = {
  read: workspaceProcedure.query(({ ctx, signal }) =>
    withSignal(signal, async () => {
      try {
        return await readModelConnection(ctx.actor);
      } catch {
        throw failure();
      }
    })
  ),
  start: workspaceProcedure
    .input(z.object({ provider: ModelProviderSchema }))
    .mutation(({ ctx, input, signal }) =>
      withSignal(signal, async () => {
        try {
          return await startModelConnection(ctx.actor, input.provider);
        } catch {
          throw new TRPCError({
            code: "BAD_REQUEST",
            message: "Model authorization unavailable.",
          });
        }
      })
    ),
  poll: workspaceProcedure
    .input(ModelChallengeSchema)
    .mutation(({ ctx, input, signal }) =>
      withSignal(signal, async () => {
        try {
          return await finishModelConnection(ctx.actor, input.id);
        } catch {
          throw failure();
        }
      })
    ),
  select: workspaceProcedure
    .input(z.object({ model: WorkspaceModelSchema }))
    .mutation(({ ctx, input, signal }) =>
      withSignal(signal, async () => {
        try {
          await selectWorkspaceModel(ctx.actor, input.model);
          return;
        } catch {
          throw failure();
        }
      })
    ),
  disconnect: workspaceProcedure.mutation(({ ctx, signal }) =>
    withSignal(signal, async () => {
      try {
        await disconnectModel(ctx.actor);
        return;
      } catch {
        throw failure();
      }
    })
  ),
};
