import { defineHook, type HookContext, type HookEvent } from "eve/hooks";
import { env } from "@shared/environment/env";
import { isSharedPrincipal } from "@shared/identity/principal-scope";
import { captureSessionSource } from "../../server/memory/session-capture";
import { sessionSource } from "../../server/memory/session-files";
import {
  workspaceActorFromPrincipal,
  WorkspaceAccessDenied,
} from "../../server/workspaces/access";

export default defineHook({
  events: {
    "message.received": capture,
    "message.completed": capture,
    "turn.completed": capture,
    "turn.cancelled": capture,
    "turn.failed": capture,
  },
});

async function capture(event: HookEvent, context: HookContext) {
  const principal = context.session.auth.current;
  if (
    !env.ZOEN_SESSION_ARCHIVE_DIR ||
    !principal ||
    isSharedPrincipal(principal) ||
    principal.principalType !== "user" ||
    !["authjs", "verified-channel"].includes(principal.authenticator)
  )
    return;
  try {
    const actor = await workspaceActorFromPrincipal(principal);
    await captureSessionSource(actor, sessionSource(event, context.session.id));
  } catch (error) {
    if (error instanceof WorkspaceAccessDenied) return;
    // A failed capture already fails its turn. Never turn that failure into
    // terminal session failure while trying to archive the failure boundary.
    if (event.type === "turn.failed") {
      console.error("session_archive.failure_boundary_not_captured");
      return;
    }
    throw error;
  }
}
