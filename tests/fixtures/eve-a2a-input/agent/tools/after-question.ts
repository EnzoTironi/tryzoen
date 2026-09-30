import { defineTool } from "eve/tools";
import { z } from "zod";
import { workspaceActorFromPrincipal } from "../../../../../server/workspaces/access";
export default defineTool({
  description:
    "Validate live workspace authority after answering the synthetic question.",
  inputSchema: z.strictObject({}),
  async execute(_input, context) {
    const actor = await workspaceActorFromPrincipal(
      context.session.auth.current ?? undefined
    );
    return { completed: true, workspaceId: actor.workspaceId };
  },
});
