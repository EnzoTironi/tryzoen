import { defineHook } from "eve/hooks";
import { isSharedPrincipal } from "@shared/identity/principal-scope";
import {
  workspaceActorFromPrincipal,
  WorkspaceAccessDenied,
} from "../../server/workspaces/access";
import { captureCreatorUpload } from "../../server/creators/sources/intakes";
export default defineHook({
  events: {
    "message.received": async (event, context) => {
      const principal = context.session.auth.current;
      if (
        principal?.principalType !== "user" ||
        principal.authenticator !== "authjs" ||
        isSharedPrincipal(principal) ||
        context.session.parent ||
        event.data.kind
      )
        return;
      try {
        const actor = await workspaceActorFromPrincipal(principal);
        await captureCreatorUpload(actor, context.session.id, event);
      } catch (error) {
        if (error instanceof WorkspaceAccessDenied) return;
        throw error;
      }
    },
  },
});
