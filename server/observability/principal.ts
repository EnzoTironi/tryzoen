import { isValid } from "@shared/validation";
import { z } from "zod";
import type { SessionAuthContext } from "eve/context";
import { readProtocolTask } from "../a2a/tasks";
import {
  workspaceActorFromPrincipal,
  WorkspaceAccessDenied,
} from "../workspaces/access";

/** Terminal A2A events still belong to the same authorized task; this grants no tool execution. */
export const telemetryScope = async function (
  principal: SessionAuthContext,
  sessionId: string
) {
  if (principal.authenticator !== "a2a")
    return await workspaceActorFromPrincipal(principal);
  const { protocolTaskId, ...attributes } = principal.attributes;
  if (!isValid(z.uuid(), protocolTaskId)) throw new WorkspaceAccessDenied();
  const actor = await workspaceActorFromPrincipal({
    ...principal,
    attributes,
  });
  const task = await readProtocolTask(actor, protocolTaskId);
  if (
    task.state === "TASK_STATE_CANCELED" ||
    (task.sessionId !== null && task.sessionId !== sessionId)
  )
    throw new WorkspaceAccessDenied();
  return actor;
};
