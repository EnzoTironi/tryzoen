import { defineDynamic, defineTool } from "eve/tools";
import { always } from "eve/tools/approval";
import { z } from "zod";
import { workspaceOperationId } from "../../../../../agent/lib/workspace-operation";
import { workspaceActorFromPrincipal } from "../../../../../server/workspaces/access";
import { WorkspaceRepository } from "../../../../../server/workspaces/repository";

export default defineDynamic({
  events: {
    "turn.started": (_event, context) =>
      context.session.auth.current?.authenticator === "authjs"
        ? defineTool({
            description:
              "Write only after native approval and live authorization.",
            inputSchema: z.strictObject({ text: z.string() }),
            approval: always(),
            async execute({ text }, execution) {
              if (execution.session.auth.current?.authenticator !== "authjs")
                throw new Error("The reporting identity cannot write.");
              const actor = await workspaceActorFromPrincipal(
                execution.session.auth.current
              );
              const current = await WorkspaceRepository.read(
                actor,
                "knowledge/rebind-approval.md"
              );
              return WorkspaceRepository.write(actor, {
                path: "knowledge/rebind-approval.md",
                content: text,
                expectedRevision: current.revision,
                operationId: workspaceOperationId(
                  execution.session.id,
                  execution.callId
                ),
              });
            },
          })
        : null,
  },
});
