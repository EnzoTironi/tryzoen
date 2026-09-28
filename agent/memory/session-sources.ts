import { defineMemory, defineMemoryProvider } from "eve/memory";
import { env } from "@shared/environment/env";
import { isSharedPrincipal } from "@shared/identity/principal-scope";
import { captureSessionSource } from "../../server/memory/session-capture";
import { settledSessionSource } from "../../server/memory/session-files";
import {
  WorkspaceAccessDenied,
  workspaceActorFromPrincipal,
} from "../../server/workspaces/access";

export default defineMemory({
  description: "Private archive of the accepted final reply for each turn.",
  namespace: "zoen-session-sources-v1",
  visibility: "session",
  scope({ session }) {
    const principal = session.auth.current;
    if (
      !env.ZOEN_SESSION_ARCHIVE_DIR ||
      !principal ||
      isSharedPrincipal(principal) ||
      principal.principalType !== "user" ||
      !["authjs", "verified-channel"].includes(principal.authenticator)
    )
      return null;
    return [session.id, principal.principalId];
  },
  provider: defineMemoryProvider({
    recall: { "turn.started": () => null },
    capture: {
      async "turn.completed"(context) {
        const principal = context.session.auth.current;
        const scope = context.memory.scope.value;
        if (
          !principal ||
          isSharedPrincipal(principal) ||
          !Array.isArray(scope) ||
          scope[0] !== context.session.id ||
          scope[1] !== principal.principalId
        )
          throw new WorkspaceAccessDenied();
        const actor = await workspaceActorFromPrincipal(principal);
        await captureSessionSource(actor, settledSessionSource(context));
      },
    },
  }),
});
