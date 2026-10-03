import { NetworkContactInputSchema } from "@zoen/companion-ui/approval";
import { withSignal } from "../../operations/async";
import { z } from "zod";
import { defineDynamic, defineTool } from "eve/tools";
import { always } from "eve/tools/approval";
import { workspaceOperationId } from "../../../agent/lib/workspace-operation";
import {
  discoverNetworkBots,
  requireNetworkDestination,
} from "../../workspaces/network";
import { workspaceActorFromPrincipal } from "../../workspaces/access";
import {
  openMatrixConversation,
  sendMatrixConversation,
} from "../../matrix/conversations";
import { awaitMatrixResult, readMatrixResult } from "../../matrix/result";

export default defineDynamic({
  events: {
    "turn.started": (_event, context) => {
      const caller = context.session.auth.current;
      // A network grant cannot delegate again or borrow its owner's browser login.
      // Company group sharing needs a separate audience grant, not this personal action.
      if (
        caller?.authenticator !== "authjs" ||
        caller.attributes.chatKind === "group"
      )
        return null;
      return {
        "network-bots": defineTool({
          description:
            "Find published bots by username prefix in the active trusted network, returning at most 20 matches. This does not search names or descriptions. For a supplied @username, use that username unchanged without the leading @, then select the exact username from the returned matches. Copy its destination identity/revision unchanged into network-contact; a username alone is insufficient. Company membership or mutually accepted personal trust is required. Contact does not grant private files, memories, credentials or other networks.",
          inputSchema: z
            .object({
              query: z
                .string()
                .max(30)
                .describe(
                  "Username prefix, without @. For a supplied username, preserve it exactly; an empty prefix lists at most 20 bots."
                ),
            })
            .strict(),
          execute: (input, execution) =>
            withSignal(execution.abortSignal, async () => {
              const actor = await workspaceActorFromPrincipal(
                execution.session.auth.current ?? undefined
              );
              return await discoverNetworkBots(actor, input.query);
            }),
        }),
        "network-contact": defineTool({
          description:
            "Ask another trusted person's or company's bot through Matrix and A2A, using this workspace's published bot identity. First discover the recipient with network-bots and copy its exact destination identity/revision. This sends the exact text to that reviewed bot and requires approval. A changed destination requires fresh discovery and approval. Share only content authorized for that recipient. Returns the result or a pending receipt; use network-result to check a pending receipt, never resend the question. The destination cannot recursively contact bots through this grant.",
          inputSchema: NetworkContactInputSchema,
          approval: always(),
          execute: (input, execution) =>
            withSignal(execution.abortSignal, async () => {
              const approvedInput = NetworkContactInputSchema.parse(input);
              const actor = await workspaceActorFromPrincipal(
                execution.session.auth.current ?? undefined
              );
              await requireNetworkDestination(
                actor,
                approvedInput.username,
                approvedInput.destination
              );
              const room = await openMatrixConversation(
                actor,
                approvedInput.username,
                true,
                approvedInput.destination
              );
              const event = await sendMatrixConversation(
                actor,
                {
                  id: room.id,
                  text: approvedInput.text,
                  operationId: workspaceOperationId(
                    execution.session.id,
                    execution.callId
                  ),
                },
                approvedInput.destination
              );
              return await awaitMatrixResult(actor, room.id, event.event_id);
            }),
        }),
        "network-result": defineTool({
          description:
            "Read an existing network-contact receipt in the active workspace. Does not send a message. If still pending, report that accurately and do not repeatedly resend or claim completion.",
          inputSchema: z
            .object({
              conversationId: z.uuid(),
              eventId: z.string().min(1).max(256),
            })
            .strict(),
          execute: (input, execution) =>
            withSignal(execution.abortSignal, async () => {
              const actor = await workspaceActorFromPrincipal(
                execution.session.auth.current ?? undefined
              );
              return await readMatrixResult(
                actor,
                input.conversationId,
                input.eventId
              );
            }),
        }),
      };
    },
  },
});
