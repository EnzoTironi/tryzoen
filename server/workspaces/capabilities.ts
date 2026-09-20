import { jsonString } from "@shared/validation";
import type { z } from "zod";
import {
  capabilitiesPath,
  defaultWorkspaceCapabilities,
  WorkspaceCapabilitiesSchema,
} from "@shared/workspaces/capabilities";
import type { WorkspaceActorSchema } from "./access";
import { WorkspaceRepository } from "./repository";

export const readWorkspaceCapabilities = async function (
  actor: z.output<typeof WorkspaceActorSchema>
) {
  const selection = await WorkspaceRepository.selection(actor, [
    capabilitiesPath,
  ]);
  const document = selection.documents[0];
  const capabilities = document
    ? await jsonString(WorkspaceCapabilitiesSchema).parseAsync(document.content)
    : defaultWorkspaceCapabilities;
  return { ...capabilities, revision: selection.revision };
};
