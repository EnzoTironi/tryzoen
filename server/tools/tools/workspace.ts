import { withSignal } from "../../operations/async";
import { z } from "zod";

import { defineDynamic, defineTool } from "eve/tools";
import {
  WorkspaceAccessDenied,
  workspaceActorFromPrincipal,
} from "../../workspaces/access";
import { readWorkspaceCapabilities } from "../../workspaces/capabilities";
import { WorkspaceRepository } from "../../workspaces/repository";
import { WorkspacePathSchema, GitRevisionSchema } from "../../workspaces/git";
import { workspaceOperationId } from "../../../agent/lib/workspace-operation";

export default defineDynamic({
  events: {
    "turn.started": (_event, context) => {
      const caller = context.session.auth.current;
      if (
        caller?.principalType !== "user" ||
        ![
          "authjs",
          "verified-channel",
          "a2a",
          "matrix",
          "scheduled-worker",
        ].includes(caller.authenticator) ||
        (caller.attributes.chatKind === "group" &&
          !caller.attributes.groupBindingId)
      )
        return null;
      return {
        "workspace-save": defineTool({
          description:
            "Save a document the user requested into the active workspace. First read workspace_files_list and pass its revision as expectedRevision, even when creating a NEW FILE. expectedRevision is the WORKSPACE head; null is only for an entirely empty workspace. Show the user the path and result. Team documents are shared with members. Use proposals/skills/<slug>.md for a skill or proposals/tools/<slug>.json for a customer tool. A tool proposal is JSON with name, description, inputSchema, outputSchema, implementation and tests. Both schemas describe objects with additionalProperties:false. Code implementation: {kind:'code', code:'return {result: input.value};', requires:[]}; code can read input and call tools.<name>(args) for declared read-only requires, with no network, process, files or secrets. Include 1–5 tests: {input:{}, expected:{}, fixtures:{tool_name:{}}}. Remote implementation: {kind:'mcp'|'openapi', connectionId, revision, operation} from a verified connection. Proposals do not execute; an administrator must test and publish them in the app. This tool cannot edit published skills/tools, agent instructions or plugin permissions. Re-read and reconcile a conflicting edit before retrying.",
          inputSchema: z
            .object({
              path: WorkspacePathSchema.regex(
                /^(?:knowledge|proposals\/(?:skills|tools))\//u
              ),
              expectedRevision: z.nullable(GitRevisionSchema),
              content: z.string().max(262_144),
            })
            .strict(),
          execute: (input, execution) =>
            withSignal(execution.abortSignal, async () => {
              const actor = await workspaceActorFromPrincipal(
                execution.session.auth.current ?? undefined
              );
              if (actor.agentGrantId) throw new WorkspaceAccessDenied();
              if (
                !(await readWorkspaceCapabilities(actor)).enabled.includes(
                  "files"
                )
              )
                throw new WorkspaceAccessDenied();
              const operationId = workspaceOperationId(
                execution.session.id,
                execution.callId
              );
              return await WorkspaceRepository.write(
                actor,
                { ...input, operationId },
                { kind: "agent" }
              );
            }),
        }),
      };
    },
  },
});
