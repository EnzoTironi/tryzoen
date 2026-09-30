import { TRPCError } from "@trpc/server";
import {
  ExternalAgentMemberError,
  ExternalAgentRegistrationSchema,
  ExternalAgentListSchema,
  registerExternalAgentMember,
  listExternalAgentMembers,
} from "../../server/workspaces/agent-members";
import { WorkspaceAccessDenied } from "../../server/workspaces/access";
import { withSignal } from "../../server/operations/async";
import { workspaceProcedure } from "./workspace-procedure";

const agentMemberProcedure = workspaceProcedure.use(async ({ next }) => {
  const result = await next();
  if (!result.ok) {
    const cause = result.error.cause;
    if (cause instanceof WorkspaceAccessDenied)
      throw new TRPCError({ code: "FORBIDDEN", cause });
    if (cause instanceof ExternalAgentMemberError)
      throw new TRPCError({
        code:
          cause.code === "invalid_input"
            ? "BAD_REQUEST"
            : cause.code === "conflict"
              ? "CONFLICT"
              : "INTERNAL_SERVER_ERROR",
        cause,
      });
  }
  return result;
});

export const externalAgentsRouter = {
  register: agentMemberProcedure
    .input(ExternalAgentRegistrationSchema)
    .mutation(({ ctx, input, signal }) =>
      withSignal(signal, () => registerExternalAgentMember(ctx.actor, input))
    ),
  list: agentMemberProcedure
    .input(ExternalAgentListSchema)
    .query(({ ctx, input, signal }) =>
      withSignal(signal, () => listExternalAgentMembers(ctx.actor, input))
    ),
};
