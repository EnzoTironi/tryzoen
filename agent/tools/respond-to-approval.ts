import { withSignal } from "../../server/operations/async";
import { isValid } from "@shared/validation";
import { z } from "zod";

import { defineDynamic, defineTool } from "eve/tools";
import { internalCallbackBodies } from "../../server/internal/callback-auth";
import { channelProviderSchema } from "../../shared/identity/channel-auth";
import { requireChannelPrincipal } from "../../server/channels/principal";
import { postInternalRequest } from "../lib/internal-request";

const callback = internalCallbackBodies["/internal/channel-input/respond"];
export const inputSchema = z.strictObject({
  requestId: callback.shape.requestId,
  decision: callback.shape.decision,
});

const respond = defineTool({
  description:
    "Submit the current user's explicit approval or cancellation of one pending proposal already delivered in this conversation. Resolve the reference from the conversation; ask for clarification when ambiguous. For a correction, cancel the old proposal and wait for confirmed cancellation before proposing a replacement. Acceptance of this submission does not confirm execution or cancellation. Never repeat an uncertain submission.",
  inputSchema: {
    "~standard": inputSchema["~standard"],
  },
  execute(input, context) {
    return withSignal(context.abortSignal, async () => {
      const auth = context.session.auth.current;
      const channel = await channelProviderSchema.parseAsync(
        auth?.attributes.conversationChannel
      );
      const identity = await requireChannelPrincipal(channel, auth);
      const body = await callback.strict().parseAsync({
        ...input,
        sessionId: context.session.id,
        turnId: context.session.turn.id,
        identityId: identity.id,
        sourceMessageId: auth?.attributes.sourceMessageId,
      });
      const response = await postInternalRequest(
        "/internal/channel-input/respond",
        body
      );
      if (response.status === 202) {
        return { status: "accepted" as const, requestId: input.requestId };
      }
      return {
        status: [400, 401, 403, 409, 422].includes(response.status)
          ? ("rejected" as const)
          : ("uncertain" as const),
        requestId: input.requestId,
      };
    });
  },
});

export default defineDynamic({
  events: {
    "step.started": (_event, context) => {
      const principal = context.session.auth.current;
      if (
        principal?.authenticator !== "verified-channel" ||
        principal.attributes.groupBindingId
      )
        return null;
      if (
        !isValid(
          channelProviderSchema,
          principal.attributes.conversationChannel
        ) ||
        !isValid(z.string().min(1), principal.attributes.sourceMessageId)
      )
        return null;
      return respond;
    },
  },
});
