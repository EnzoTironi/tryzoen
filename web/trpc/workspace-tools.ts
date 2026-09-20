import { withSignal } from "../../server/operations/async";
import { z } from "zod";
import {
  CustomerToolPublication,
  CustomerToolRollback,
  disableCustomerTool,
  listCustomerTools,
  publishCustomerTool,
  rollbackCustomerTool,
  validateCustomerTool,
} from "../../server/workspaces/tools";
import { workspaceProcedure } from "./workspace-procedure";
import { ConnectorInput } from "../../server/connectors/definition";
import {
  connectTools,
  listToolConnections,
  readToolConnection,
  remoteToolDefinition,
  revokeToolConnection,
} from "../../server/connectors/connections";
import { invokeRemoteTool } from "../../server/connectors/invocation";
import { decodeCustomerTool } from "../../server/workspaces/tool-document";
import { WorkspaceRepository } from "../../server/workspaces/repository";
import { WorkspaceAccessDenied } from "../../server/workspaces/access";

const RemoteSelection = z.object({
  connectionId: z.uuid(),
  revision: z.uuid(),
  operation: z.string().max(120),
});
const selectionDefinition = async function (
  actor: Parameters<typeof readToolConnection>[0],
  input: z.output<typeof RemoteSelection>
) {
  const connection = await readToolConnection(
    actor,
    input.connectionId,
    input.revision
  );
  const operation = connection.operations.find(
    (entry) => entry.id === input.operation
  );
  if (!operation) throw new WorkspaceAccessDenied();
  return await decodeCustomerTool(
    JSON.stringify(remoteToolDefinition(connection, operation))
  );
};

export const workspaceToolsRouter = {
  connections: {
    list: workspaceProcedure.query(({ ctx, signal }) =>
      withSignal(signal, async () => listToolConnections(ctx.actor))
    ),
    connect: workspaceProcedure
      .input(ConnectorInput)
      .mutation(({ ctx, input, signal }) =>
        withSignal(signal, async () => connectTools(ctx.actor, input))
      ),
    revoke: workspaceProcedure
      .input(z.object({ id: z.uuid() }))
      .mutation(({ ctx, input, signal }) =>
        withSignal(signal, async () =>
          revokeToolConnection(ctx.actor, input.id)
        )
      ),
    propose: workspaceProcedure
      .input(
        z.object({
          ...RemoteSelection.shape,
          ...CustomerToolPublication.shape,
        })
      )
      .mutation(({ ctx, input, signal }) =>
        withSignal(signal, async () => {
          const definition = await selectionDefinition(ctx.actor, input);
          return await WorkspaceRepository.write(ctx.actor, {
            ...input,
            path: `proposals/tools/${input.slug}.json`,
            content: JSON.stringify(definition, null, 2),
          });
        })
      ),
    test: workspaceProcedure
      .input(
        z.object({
          ...RemoteSelection.shape,
          operationId: z.uuid(),
          input: z.record(z.string(), z.unknown()),
        })
      )
      .mutation(({ ctx, input, signal }) =>
        withSignal(signal, async () => {
          if (!ctx.actor.authSessionId) throw new WorkspaceAccessDenied();
          const definition = await selectionDefinition(ctx.actor, input);
          return await invokeRemoteTool(
            ctx.actor,
            definition,
            input.input,
            `test:${ctx.actor.userId}:${input.operationId}`
          );
        })
      ),
  },
  list: workspaceProcedure.query(({ ctx, signal }) =>
    withSignal(signal, async () => listCustomerTools(ctx.actor))
  ),
  validate: workspaceProcedure
    .input(
      z.object({
        content: z.string().max(32_768),
      })
    )
    .mutation(({ ctx, input, signal }) =>
      withSignal(signal, async () =>
        validateCustomerTool(ctx.actor, input.content)
      )
    ),
  publish: workspaceProcedure
    .input(CustomerToolPublication)
    .mutation(({ ctx, input, signal }) =>
      withSignal(signal, async () => publishCustomerTool(ctx.actor, input))
    ),
  rollback: workspaceProcedure
    .input(CustomerToolRollback)
    .mutation(({ ctx, input, signal }) =>
      withSignal(signal, async () => rollbackCustomerTool(ctx.actor, input))
    ),
  disable: workspaceProcedure
    .input(CustomerToolPublication)
    .mutation(({ ctx, input, signal }) =>
      withSignal(signal, async () => disableCustomerTool(ctx.actor, input))
    ),
};
