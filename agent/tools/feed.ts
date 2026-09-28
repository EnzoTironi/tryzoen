import { defineDynamic, defineTool } from "eve/tools";
import { z } from "zod";
import { feedPostInputSchema } from "@zoen/companion-ui/feed";
import {
  publishFeedPost,
  readFeedPost,
  readFeedInstructions,
  listFeedPosts,
} from "@db/services/feed";
import { resolveModeValue } from "../lib/mode";
import { workspaceActorFromPrincipal } from "../../server/workspaces/access";

export default defineDynamic({
  events: {
    "turn.started": (_event, context) => {
      if (
        !resolveModeValue(context, {
          interactive: true,
          "scheduled-worker": true,
        })
      )
        return null;
      return {
        feed_context: defineTool({
          availableInSubagents: false,
          description:
            "Read this user's personal Feed instructions and recent publication titles/reactions before planning a new post. Use feed_read for a full original post. These preferences do not authorize new schedules or external actions.",
          inputSchema: z.object({}),
          async execute(_input, execution) {
            const actor = await workspaceActorFromPrincipal(
              execution.session.auth.current ??
                execution.session.auth.initiator ??
                undefined
            );
            const [instructions, recent] = await Promise.all([
              readFeedInstructions(actor),
              listFeedPosts(actor),
            ]);
            return {
              instructions: instructions.content,
              recent: recent.items.map(({ id, title, liked, createdAt }) => ({
                id,
                title,
                liked,
                createdAt,
              })),
            };
          },
        }),
        feed_publish: defineTool({
          availableInSubagents: false,
          description:
            "Save a finished post to this user's PRIVATE Feed when requested or explicitly included in an authorized scheduled task. Read feed_context first and follow their personal instructions. This is not public publishing and sends no notification. Include an honest relevance explanation and only sources actually consulted. Use the same key on a retry so it cannot duplicate or resurrect a deleted post. Do not put secrets in posts. Respect the user's language.",
          inputSchema: feedPostInputSchema,
          async execute(input, execution) {
            const actor = await workspaceActorFromPrincipal(
              execution.session.auth.current ??
                execution.session.auth.initiator ??
                undefined
            );
            return publishFeedPost(actor, input);
          },
        }),
        feed_read: defineTool({
          availableInSubagents: false,
          description:
            "Read the original private Feed post when the user asks to discuss it. A quoted assistant message with ID feed:<UUID> refers to a Feed post: pass that UUID here and read the original before answering. Returns content, sources, relevance and reaction. Missing or deleted posts cannot be reconstructed by guessing.",
          inputSchema: z.object({ id: z.uuid() }),
          async execute({ id }, execution) {
            const actor = await workspaceActorFromPrincipal(
              execution.session.auth.current ??
                execution.session.auth.initiator ??
                undefined
            );
            return readFeedPost(actor, id);
          },
        }),
      };
    },
  },
});
