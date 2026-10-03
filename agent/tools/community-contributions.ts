import { z } from "zod";
import { defineDynamic, defineTool, type ToolContext } from "eve/tools";
import { always } from "eve/tools/approval";
import { CommunityContributionInputSchema } from "@zoen/companion-ui/approval";
import { accessScopeForUser } from "@shared/identity/access-scope";
import { authorizeApprovalResponse } from "@agent/lib/approval-response";
import { withSignal } from "../../server/operations/async";
import {
  WorkspaceAccessDenied,
  workspaceActorFromPrincipal,
} from "../../server/workspaces/access";
import {
  discoverContributionChannels,
  publishCommunityContribution,
  readContributionReceipt,
} from "../../server/matrix/contributions";

function privateOwnerSession(
  session: Pick<ToolContext["session"], "auth" | "parent">
) {
  const principal = session.auth.current;
  return (
    !session.parent &&
    principal?.principalType === "user" &&
    principal.authenticator === "authjs" &&
    principal.attributes.chatKind !== "group" &&
    principal.attributes.workspaceId ===
      accessScopeForUser(principal.principalId).workspaceId
  );
}

async function contributionActor(execution: ToolContext) {
  if (!privateOwnerSession(execution.session))
    throw new WorkspaceAccessDenied();
  return workspaceActorFromPrincipal(
    execution.session.auth.current ?? undefined
  );
}

export default defineDynamic({
  events: {
    "session.started": (_event, context) => {
      if (!privateOwnerSession(context.session)) return null;
      return {
        "community-channels": defineTool({
          description:
            "Find up to 24 community channels you currently belong to. Copy the exact destination unchanged into community-contribute. This does not read anyone's private data or join a channel.",
          inputSchema: z.strictObject({}),
          availableInSubagents: false,
          execute: (_input, execution) =>
            withSignal(execution.abortSignal, async () =>
              discoverContributionChannels(await contributionActor(execution))
            ),
        }),
        "community-contribute": defineTool({
          description:
            "Propose a contribution privately to this session's owner. Discover community-channels and copy the exact destination. Choose a fresh operationId (UUID) for a new contribution. The owner must approve the full text, purpose and channel. Only text is published, as the owner, after current membership and audience are rechecked. Refusal or silence sends nothing. Never include private context beyond the exact text the owner approves. Returns published or an uncertain pending receipt. Check community-contribution-result without resending. An explicit retry must reuse the original operationId and identical destination, purpose and text and requires fresh approval; changed content or audience needs a new proposal. Cancellation during publication can leave an uncertain receipt; check its original operationId before proposing any retry.",
          inputSchema: CommunityContributionInputSchema,
          availableInSubagents: false,
          approval: {
            request: always(),
            response: (context) => authorizeApprovalResponse(context),
          },
          execute: (input, execution) =>
            withSignal(execution.abortSignal, async () =>
              publishCommunityContribution(
                await contributionActor(execution),
                input
              )
            ),
        }),
        "community-contribution-result": defineTool({
          description:
            "Read your private publication receipt. This never sends or retries a message. A pending receipt is an uncertain outcome; do not claim delivery or automatically resend.",
          inputSchema: z.strictObject({ operationId: z.uuid() }),
          availableInSubagents: false,
          execute: (input, execution) =>
            withSignal(execution.abortSignal, async () =>
              readContributionReceipt(
                await contributionActor(execution),
                input.operationId
              )
            ),
        }),
      };
    },
  },
});
