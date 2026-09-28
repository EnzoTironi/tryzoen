import { defineDynamic, defineTool } from "eve/tools";
import { z } from "zod";
import { ideaCursorSchema, ideaProposalSchema } from "@zoen/companion-ui/ideas";
import { listPersonalIdeas, proposePersonalIdea } from "@db/services/ideas";
import { resolveModeValue } from "../lib/mode";
import { workspaceActorFromPrincipal } from "../../server/workspaces/access";

export default defineDynamic({
  events: {
    "turn.started": (_event, context) => {
      if (!resolveModeValue(context, { interactive: true })) return null;
      return {
        ideas_list: defineTool({
          availableInSubagents: false,
          description:
            "Read this user's saved proposals and feedback before suggesting ideas. Dismissed topics must not be reintroduced. Positive feedback guides future suggestions but grants no permission to execute. Page using nextCursor when needed.",
          inputSchema: z.object({ cursor: ideaCursorSchema.nullish() }),
          async execute({ cursor }, execution) {
            const actor = await workspaceActorFromPrincipal(
              execution.session.auth.current ??
                execution.session.auth.initiator ??
                undefined
            );
            return listPersonalIdeas(actor, cursor, true);
          },
        }),
        ideas_propose: defineTool({
          availableInSubagents: false,
          description:
            "Save a personal suggestion in the Ideas tab without executing it. Use when asked for ideas or when a useful, grounded next step emerges. Read ideas_list first, respect feedback, avoid duplicates, use the user's language, and explain actual evidence for relevance. Save at most five useful proposals per request; do not fabricate connected data. The user chooses Let's go to start work.",
          inputSchema: ideaProposalSchema,
          async execute(input, execution) {
            const actor = await workspaceActorFromPrincipal(
              execution.session.auth.current ??
                execution.session.auth.initiator ??
                undefined
            );
            return proposePersonalIdea(actor, input);
          },
        }),
      };
    },
  },
});
