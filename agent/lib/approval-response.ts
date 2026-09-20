import { matrixSessionActor } from "../../server/matrix/authority";
import { WorkspaceAccessDenied } from "../../server/workspaces/access";
import { z } from "zod";
import type {
  ApprovalResponseContext,
  ApprovalResponseDecision,
} from "eve/tools/approval";
import { isSessionOwned } from "@db/services/sessions";
import { scopeFromPrincipal } from "../../shared/identity/principal-scope";
import { requireChannelPrincipal } from "../../server/channels/principal";

export async function authorizeApprovalResponse(context: {
  responder: ApprovalResponseContext["responder"];
  session: Pick<ApprovalResponseContext["session"], "id" | "initiator">;
}): Promise<ApprovalResponseDecision> {
  const { responder, session } = context;
  if (
    responder.principalType !== "user" ||
    responder.principalId !== session.initiator?.principalId
  ) {
    return {
      status: "rejected",
      reason: "Only the session owner can approve this action.",
    };
  }
  const channel = session.initiator.attributes.conversationChannel;
  if (channel === "matrix") {
    const eventId = z.string().safeParse(responder.attributes.matrixEventId);
    if (
      responder.authenticator !== "matrix" ||
      !eventId.success ||
      eventId.data !== session.initiator.attributes.matrixEventId
    )
      return {
        status: "rejected",
        reason: "Respond to the original group request.",
      };
    try {
      const actor = await matrixSessionActor(eventId.data, session.id);
      return actor.userId === responder.principalId &&
        actor.workspaceId === responder.attributes.workspaceId
        ? { status: "allowed" }
        : {
            status: "rejected",
            reason: "The group request does not belong to the responder.",
          };
    } catch (error) {
      if (error instanceof WorkspaceAccessDenied)
        return {
          status: "rejected",
          reason: "Group access is no longer active.",
        };
      throw error;
    }
  }
  if (channel === "telegram" || channel === "kapso") {
    if (
      responder.attributes.channelIdentityId !==
      session.initiator.attributes.channelIdentityId
    ) {
      return {
        status: "rejected",
        reason: "Respond through the original private channel.",
      };
    }
    await requireChannelPrincipal(channel, responder);
  }
  if (!(await isSessionOwned(scopeFromPrincipal(responder), session.id))) {
    return {
      status: "rejected",
      reason: "This session does not belong to the responder.",
    };
  }
  return { status: "allowed" };
}
