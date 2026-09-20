import { mapAsync, withSignal } from "../operations/async";
import { ConnectorError } from "../connectors/definition";
import { z } from "zod";
import { always } from "eve/tools/approval";
import { defineTool, type DynamicResolveContext } from "eve/tools";
import {
  workspaceActorFromPrincipal,
  WorkspaceAccessDenied,
} from "../workspaces/access";
import { WorkspaceRepository } from "../workspaces/repository";
import {
  customerToolId,
  decodeCustomerTool,
  CustomerToolError,
} from "../workspaces/tool-document";
import { listCustomerTools } from "../workspaces/tools";
import { executeCustomerCode } from "./customer-runtime";
import { invokeWorkspaceTool, readWorkspaceToolCatalog } from "./workspace";
import type { ToolCatalog } from "./definition";
import { requireRemoteTool } from "../connectors/connections";
import { invokeRemoteTool } from "../connectors/invocation";

export const resolveCustomerTools = async function (
  context: DynamicResolveContext
) {
  const actor = await workspaceActorFromPrincipal(
    context.session.auth.current ?? context.session.auth.initiator ?? undefined
  );
  // External bot grants need a separate, explicit tools capability. A files
  // grant must not silently become a way to execute the destination's code.
  const empty: ToolCatalog = {};
  if (actor.agentGrantId) return empty;
  const listing = await listCustomerTools(actor);
  const repository = WorkspaceRepository;
  const available = new Set<string>(
    (await readWorkspaceToolCatalog(actor)).tools.map((entry) => entry.path)
  );
  if (!available.has("workspace_files_list")) return empty;
  const entries = await mapAsync(
    listing.tools.filter((tool) => !tool.draft),
    async (entry) => {
      const file = await repository.read(actor, entry.path);
      if (
        !file.content ||
        customerToolId(entry.slug, file.content) !== entry.id
      )
        return null;
      const definition = await decodeCustomerTool(file.content);
      if (
        definition.implementation.kind === "code" &&
        definition.implementation.requires.some(
          (path) => !available.has(path) || path.startsWith("workspace_google_")
        )
      )
        return null;
      if (definition.implementation.kind !== "code") {
        const allowed = await Promise.try(async () => {
          await requireRemoteTool(actor, definition);
          return true;
        }).catch((error: unknown) => {
          if (error instanceof ConnectorError) return Promise.resolve(false);
          throw error;
        });
        if (!allowed) return null;
      }
      const tool = defineTool({
        description:
          definition.implementation.kind === "code"
            ? definition.description
            : `${definition.description} External service action: approval is required for these exact arguments. If the outcome is uncertain, do not retry with a new call; ask the user to verify the remote result.`,
        inputSchema: z.fromJSONSchema(definition.inputSchema),
        outputSchema: z.fromJSONSchema(definition.outputSchema),
        approval:
          definition.implementation.kind === "code" ? undefined : always(),
        execute: (input, execution) =>
          withSignal(execution.abortSignal, async () => {
            const current = await workspaceActorFromPrincipal(
              execution.session.auth.current ??
                execution.session.auth.initiator ??
                undefined
            );
            if (
              current.workspaceId !== actor.workspaceId ||
              current.agentGrantId
            )
              throw new WorkspaceAccessDenied();
            const stored = await WorkspaceRepository.read(current, entry.path);
            if (
              !stored.content ||
              customerToolId(entry.slug, stored.content) !== entry.id
            )
              throw new CustomerToolError({
                reason: "unavailable",
              });

            const output =
              definition.implementation.kind !== "code"
                ? await invokeRemoteTool(
                    current,
                    definition,
                    input,
                    `${execution.session.id}:${execution.callId}`
                  )
                : await executeCustomerCode(definition, input, {
                    invoke: (call) => invokeWorkspaceTool(current, call),
                  });
            // Membership and publication can change while a mediated read waits.
            const latest = await WorkspaceRepository.read(current, entry.path);
            if (latest.content !== stored.content)
              throw new CustomerToolError({
                reason: "unavailable",
              });
            return output;
          }),
      });
      return [entry.id, tool] as const;
    },
    1
  );
  const tools: ToolCatalog = Object.fromEntries(
    entries.filter((entry) => entry !== null)
  );
  return tools;
};
