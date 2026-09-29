import {
  WorkspacePathSchema,
  GitRevisionSchema,
} from "@zoen/companion-ui/workspace-files";
import { withSignal } from "../../operations/async";
import { z } from "zod";

import { defineDynamic, defineTool } from "eve/tools";
import {
  WorkspaceAccessDenied,
  workspaceActorFromPrincipal,
} from "../../workspaces/access";
import { readWorkspaceCapabilities } from "../../workspaces/capabilities";
import { WorkspaceRepository } from "../../workspaces/repository";

import {
  ProposeKnowledgeSchema,
  proposeKnowledge,
} from "../../workspaces/knowledge";

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
        "workspace-knowledge-propose": defineTool({
          description:
            "Propose a coherent change to workspace knowledge or analysis models for human review in Library. Available only in a private signed-in app conversation. Read the workspace head first. Supply exact file contents, affected paths, dependencies and evidence from authorized files at their revisions or cited web sources. For domain discovery propose knowledge/purpose.md, canonical definitions and knowledge/routing/index.json together. The routing JSON is {version:1,records:[{id:<UUID>,title,summary,terms:[<topic>],paths:[<published knowledge paths>]}]}, up to 60 records and 3 paths each. Preserve each record's UUID across label changes or file moves; update its paths in the same proposal when moving a definition. A routing reference must exist in the resulting revision. This only saves a proposal. It does not approve definitions or execute models. An administrator reviews all files as one change; never claim a proposal was published.",
          inputSchema: ProposeKnowledgeSchema.omit({ operationId: true }),
          execute: (input, execution) =>
            withSignal(execution.abortSignal, async () => {
              const actor = await workspaceActorFromPrincipal(
                execution.session.auth.current ?? undefined
              );
              if (
                !(await readWorkspaceCapabilities(actor)).enabled.includes(
                  "files"
                )
              )
                throw new WorkspaceAccessDenied();
              return proposeKnowledge(actor, {
                ...input,
                operationId: workspaceOperationId(
                  execution.session.id,
                  execution.callId
                ),
              });
            }),
        }),
        "workspace-save": defineTool({
          description:
            "Save a document the user requested into the active workspace. First read workspace_files_list and pass its revision as expectedRevision, even when creating a NEW FILE. expectedRevision is the WORKSPACE head; null is only for an entirely empty workspace. Show the user the path and result. Team documents are shared with members. Analysis models, definitions and routing documents must use workspace-knowledge-propose; this tool cannot publish them. Use proposals/skills/<slug>.md for a skill or proposals/tools/<slug>.json for a customer tool. A tool proposal is JSON with name, description, inputSchema, outputSchema, implementation and tests. Both schemas describe objects with additionalProperties:false. Code implementation: {kind:'code', code:'return {result: input.value};', requires:[]}; code can read input and call tools.<name>(args) for declared read-only requires, with no network, process, files or secrets. Include 1–5 tests: {input:{}, expected:{}, fixtures:{tool_name:{}}}. Remote implementation: {kind:'mcp'|'openapi', connectionId, revision, operation} from a verified connection. Proposals do not execute; an administrator must test and publish them in the app. This tool cannot edit published skills/tools, agent instructions or plugin permissions. Re-read and reconcile a conflicting edit before retrying.",
          inputSchema: z
            .object({
              path: WorkspacePathSchema.regex(
                /^(?:knowledge\/(?!models\/|definitions\/|routing\/|purpose\.md$)|proposals\/(?:skills|tools)\/)/u
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
