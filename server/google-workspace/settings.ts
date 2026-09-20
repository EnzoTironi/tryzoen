import type { z } from "zod";
import { randomUUID } from "node:crypto";
import {
  GoogleWorkspaceError,
  googleWorkspaceUserId,
  readGoogleWorkspaceConnection,
} from "./index";
import {
  requireWorkspaceAccess,
  type WorkspaceActorSchema,
} from "../workspaces/access";
import { readWorkspaceCapabilities } from "../workspaces/capabilities";
import { WorkspaceRepository } from "../workspaces/repository";
import { capabilitiesPath } from "@shared/workspaces/capabilities";

export const readPersonalGoogleSettings = async function (
  actor: z.output<typeof WorkspaceActorSchema>
) {
  const connection = await readGoogleWorkspaceConnection(actor);
  const capabilities = await readWorkspaceCapabilities(actor);
  return {
    state:
      connection.state === "connected" &&
      !capabilities.enabled.includes("google")
        ? ("paused" as const)
        : connection.state,
  };
};

/** The connection button is an explicit personal-space activation, never a read side effect. */
export const activatePersonalGoogle = async function (
  actor: z.output<typeof WorkspaceActorSchema>
) {
  await googleWorkspaceUserId(actor);
  if (!actor.authSessionId)
    throw new GoogleWorkspaceError({ reason: "unauthenticated" });
  await requireWorkspaceAccess(actor, true);
  const connection = await readGoogleWorkspaceConnection(actor);
  if (connection.state === "unavailable")
    throw new GoogleWorkspaceError({ reason: "unconfigured" });
  const capabilities = await readWorkspaceCapabilities(actor);
  if (!capabilities.enabled.includes("google")) {
    await WorkspaceRepository.write(actor, {
      operationId: randomUUID(),
      expectedRevision: capabilities.revision,
      path: capabilitiesPath,
      content: JSON.stringify(
        { version: 1, enabled: [...capabilities.enabled, "google"] },
        null,
        2
      ),
    });
  }
  return { authorize: connection.state !== "connected" };
};
