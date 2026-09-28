import { defineHook, type HookContext, type HookEvent } from "eve/hooks";
import { z } from "zod";
import { recordIdeaExecution } from "@db/services/ideas";
import { scopeFromPrincipal } from "@shared/identity/principal-scope";

export default defineHook({
  events: {
    "turn.started": record,
    "input.requested": record,
    "turn.completed": record,
    "turn.failed": record,
    "turn.cancelled": record,
  },
});

async function record(event: HookEvent, context: HookContext) {
  // An idea remains attached to its original conversation, including follow-ups.
  const principal = context.session.auth.initiator;
  if (principal?.authenticator !== "authjs") return;
  const id = z.uuid().safeParse(principal.attributes.ideaId);
  if (!id.success) return;
  const status =
    event.type === "turn.started"
      ? "running"
      : event.type === "input.requested"
        ? "waiting"
        : event.type === "turn.completed"
          ? "finished"
          : event.type === "turn.cancelled"
            ? "cancelled"
            : "failed";
  await recordIdeaExecution(
    scopeFromPrincipal(principal),
    id.data,
    context.session.id,
    status,
    new Date(event.meta.at),
    z.string().min(1).parse(event.meta.id)
  );
}
