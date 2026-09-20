import { WorkspaceAccessDenied } from "../../server/workspaces/access";
import { TRPCError } from "@trpc/server";
import { resolveWorkspaceActor } from "../../server/workspaces/session";
import { protectedProcedure } from "./init";
export const workspaceProcedure = protectedProcedure.use(
  async ({ ctx, next }) => {
    const actor = await Promise.try(async () =>
      resolveWorkspaceActor(ctx.requestHeaders)
    ).catch((error: unknown) => {
      if (error instanceof WorkspaceAccessDenied)
        throw new TRPCError({
          code: "FORBIDDEN",
        });
      throw error;
    });
    return next({
      ctx: {
        actor,
      },
    });
  }
);
