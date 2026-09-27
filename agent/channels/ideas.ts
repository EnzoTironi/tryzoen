import { z, ZodError } from "zod";
import { defineChannel, POST } from "eve/channels";
import { acceptPersonalIdea } from "@db/services/ideas";
import { saveChat } from "@db/services/chats";
import { resolveWorkspaceActor } from "../../server/workspaces/session";
import { WorkspaceAccessDenied } from "../../server/workspaces/access";
import {
  deliveryContext,
  deliverOnce,
  sendDurableMessage,
} from "../lib/durable-delivery";

export default defineChannel({
  state: { receipts: {} },
  context: deliveryContext,
  deliver: deliverOnce,
  routes: [
    POST("/companion/ideas/:ideaId/start", async (request, context) => {
      // JSON and the same-origin browser policy prevent cross-site form submissions;
      // native clients authenticate using their existing account headers.
      if (
        request.headers.get("sec-fetch-site") === "cross-site" ||
        !request.headers.get("content-type")?.startsWith("application/json")
      )
        return new Response(null, { status: 403 });
      try {
        const actor = await resolveWorkspaceActor(request.headers);
        const id = z.uuid().parse(context.params.ideaId);
        const idea = await acceptPersonalIdea(
          actor,
          id,
          z.string().min(1).parse(actor.authSessionId)
        );
        if (idea.sessionId) return Response.json({ sessionId: idea.sessionId });
        const session = await sendDurableMessage(
          context,
          `idea:${idea.id}`,
          `idea:${idea.id}`,
          idea.proposal.prompt,
          {
            title: idea.proposal.title,
            auth: {
              authenticator: "authjs",
              principalId: actor.userId,
              principalType: "user",
              attributes: {
                authSessionId: idea.startAuthSessionId ?? "",
                workspaceId: actor.workspaceId,
                workspaceKind:
                  actor.organizationId === null ? "personal" : "company",
                conversationChannel: "eve",
                ideaId: idea.id,
              },
            },
          }
        );
        await saveChat(actor, {
          sessionId: session.id,
          title: idea.proposal.title,
        });
        return Response.json({ sessionId: session.id });
      } catch (error) {
        if (error instanceof WorkspaceAccessDenied)
          return new Response(null, { status: 403 });
        if (error instanceof ZodError)
          return new Response(null, { status: 400 });
        // Repeating this endpoint keeps the original receipt and never starts a
        // second task. The client can recover from an interrupted handoff.
        return Response.json(
          {
            error:
              "Could not confirm the start. Try again to recover this task.",
          },
          { status: 503 }
        );
      }
    }),
  ],
});
