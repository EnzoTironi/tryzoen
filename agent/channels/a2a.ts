import { deliveryContext, deliverOnce } from "../lib/durable-delivery";
import { withTimeout } from "../../server/operations/async";
import { ZodError as SchemaError } from "zod";
import { TimeoutError } from "../../server/operations/async";
import { isValid } from "@shared/validation";
import { z } from "zod";
import { defineChannel, GET, POST } from "eve/channels";
import { deliverProtocolCancellation } from "../../server/a2a/cancellation";
import { matrixConfiguration } from "../../server/matrix/client";
import {
  matrixProtocolTask,
  publishMatrixProtocolAnswer,
} from "../../server/matrix/network-delivery";
import { authenticateAgentGrant } from "../../server/workspaces/bots";
import {
  workspaceActorFromPrincipal,
  WorkspaceAccessDenied,
} from "../../server/workspaces/access";
import { readAgentCard } from "../../server/a2a/card";
import { readRpcRequest, TaskQuery } from "../../server/a2a/request";
import { ListQuery, listProtocolTasks } from "../../server/a2a/list";
import {
  deliverProtocolTask,
  recoverableProtocolActor,
} from "../../server/a2a/delivery";
import {
  A2AError,
  A2AMessageSchema,
  acceptProtocolTask,
  cancelProtocolTask,
  awaitProtocolTask,
  finishProtocolTask,
  failProtocolSession,
  protocolTaskView,
  readProtocolTask,
} from "../../server/a2a/tasks";
const responseHeaders = {
  "cache-control": "no-store",
  "A2A-Version": "1.0",
};
type RpcResult =
  | ReturnType<typeof protocolTaskView>
  | {
      task: ReturnType<typeof protocolTaskView>;
    }
  | Awaited<ReturnType<typeof listProtocolTasks>>;
export default defineChannel({
  state: {
    receipts: {},
  },
  context: deliveryContext,
  deliver: deliverOnce,
  receive(input, context) {
    return (async function () {
      if (
        isValid(
          z.object({
            cancelSessionId: z.string().min(1),
          }),
          input.target
        )
      ) {
        if (
          input.auth?.principalType !== "runtime" ||
          input.auth.authenticator !== "app"
        )
          throw new WorkspaceAccessDenied();
        return await deliverProtocolCancellation(
          input.target.cancelSessionId,
          context
        );
      }
      const target = await z
        .object({
          taskId: z.uuid(),
        })
        .parseAsync(input.target);
      if (
        input.auth?.principalType === "service" &&
        input.auth.authenticator === "matrix-homeserver"
      ) {
        const config = await matrixConfiguration();
        const eventId = input.auth.attributes.matrixEventId;
        if (
          input.auth.principalId !== config.serverName ||
          !isValid(z.string(), eventId)
        )
          throw new WorkspaceAccessDenied();
        const mapped = await matrixProtocolTask(eventId);
        if (mapped?.taskId !== target.taskId) throw new WorkspaceAccessDenied();
      } else if (
        input.auth?.principalType !== "runtime" ||
        input.auth.authenticator !== "app"
      )
        throw new WorkspaceAccessDenied();
      const actor = await recoverableProtocolActor(target.taskId);
      return await deliverProtocolTask(actor, target.taskId, context);
    })();
  },
  routes: [
    GET("/agents/:username/agent-card", async (request, { params }) => {
      try {
        const card = await readAgentCard(
          params.username ?? "",
          request.headers.get("authorization")
        );
        return Response.json(card, {
          headers: responseHeaders,
        });
      } catch {
        return Response.json(
          {
            error: "Agent not found",
          },
          {
            status: 404,
            headers: responseHeaders,
          }
        );
      }
    }),
    POST(
      "/agents/:username",
      async (request, { params, from, resolveSession, attachSession }) => {
        let id: string | number | null = null;
        try {
          try {
            try {
              try {
                // Authentication precedes body parsing, session lookup and protocol work.
                const identity = await authenticateAgentGrant(
                  request.headers.get("authorization"),
                  params.username ?? ""
                );
                const rpc = await readRpcRequest(request);
                id = rpc.id;
                const { actor } = identity;
                const grantId = actor.agentGrantId;
                if (!grantId)
                  throw new A2AError({
                    code: -32001,
                    message: "Agent access denied",
                  });
                const success = (result: RpcResult) =>
                  Response.json(
                    {
                      jsonrpc: "2.0",
                      id,
                      result,
                    },
                    {
                      headers: responseHeaders,
                    }
                  );
                if (rpc.method === "SendMessage") {
                  const message = await A2AMessageSchema.strict().parseAsync(
                    rpc.params
                  );
                  const task = await acceptProtocolTask(actor, message);
                  if (task.state === "TASK_STATE_SUBMITTED") {
                    await deliverProtocolTask(actor, task.id, {
                      from,
                      resolveSession,
                    });
                  }
                  const result = message.configuration?.returnImmediately
                    ? await readProtocolTask(actor, task.id)
                    : await Promise.resolve()
                        .then(async () =>
                          withTimeout(
                            async () => awaitProtocolTask(actor, task.id),
                            55000
                          )
                        )
                        .catch((error: unknown) => {
                          if (error instanceof TimeoutError)
                            throw new A2AError({
                              code: -32000,
                              message:
                                "Task is still running. Use GetTask or retry with returnImmediately: true and the same message ID.",
                            });
                          throw error;
                        });
                  return success({
                    task: protocolTaskView(result),
                  });
                } else if (rpc.method === "GetTask") {
                  const query = await TaskQuery.strict().parseAsync(rpc.params);
                  return success(
                    protocolTaskView(await readProtocolTask(actor, query.id))
                  );
                } else if (rpc.method === "ListTasks") {
                  const query = await ListQuery.strict().parseAsync(
                    rpc.params ?? {}
                  );
                  return success(await listProtocolTasks(actor, query));
                } else if (rpc.method === "CancelTask") {
                  const query = await TaskQuery.strict().parseAsync(rpc.params);
                  const task = await cancelProtocolTask(actor, query.id);
                  const sessionId = task.sessionId;
                  if (sessionId)
                    await Promise.resolve()
                      .then(async () => attachSession(sessionId).cancel())
                      .catch(() => {
                        throw new A2AError({
                          code: -32603,
                          message: "Cancellation could not be delivered",
                        });
                      });
                  return success(
                    protocolTaskView(await readProtocolTask(actor, task.id))
                  );
                } else
                  throw new A2AError({
                    code: -32601,
                    message: "Method not supported",
                  });
              } catch (error) {
                if (error instanceof A2AError)
                  return Response.json(
                    {
                      jsonrpc: "2.0",
                      id,
                      error: {
                        code: error.code,
                        message: error.message,
                      },
                    },
                    {
                      headers: responseHeaders,
                    }
                  );
                throw error;
              }
            } catch (error) {
              if (error instanceof WorkspaceAccessDenied)
                return Response.json(
                  {
                    jsonrpc: "2.0",
                    id,
                    error: {
                      code: -32001,
                      message: "Agent access denied",
                    },
                  },
                  {
                    status: 401,
                    headers: {
                      ...responseHeaders,
                      "www-authenticate": "Bearer",
                    },
                  }
                );
              throw error;
            }
          } catch (error) {
            if (error instanceof SchemaError)
              return Response.json(
                {
                  jsonrpc: "2.0",
                  id,
                  error: {
                    code: -32602,
                    message: "Invalid method parameters",
                  },
                },
                {
                  headers: responseHeaders,
                }
              );
            throw error;
          }
        } catch {
          return Response.json(
            {
              jsonrpc: "2.0",
              id,
              error: {
                code: -32603,
                message: "Service temporarily unavailable",
              },
            },
            {
              status: 503,
              headers: responseHeaders,
            }
          );
        }
      }
    ),
  ],
  events: {
    "session.failed"(event, channel) {
      return failProtocolSession(event.sessionId, channel.continuation?.token);
    },
    async "message.completed"(event, _channel, context) {
      if (event.finishReason === "tool-calls") return;
      const caller = context.session.auth.current;
      const taskId = caller?.attributes.protocolTaskId;
      if (!caller || !isValid(z.string(), taskId)) return;
      await Promise.try(async () => {
        const actor = await workspaceActorFromPrincipal(caller);
        const text = event.message ?? "";
        await finishProtocolTask(actor, taskId, "TASK_STATE_COMPLETED", text);
        await publishMatrixProtocolAnswer(taskId);
      }).catch((error: unknown) => {
        if (error instanceof WorkspaceAccessDenied) return Promise.resolve();
        throw error;
      });
    },
    async "turn.failed"(_event, _channel, context) {
      const caller = context.session.auth.current;
      const taskId = caller?.attributes.protocolTaskId;
      if (!caller || !isValid(z.string(), taskId)) return;
      await Promise.try(async () => {
        const actor = await workspaceActorFromPrincipal(caller);
        await finishProtocolTask(
          actor,
          taskId,
          "TASK_STATE_FAILED",
          "The task could not be completed. Start a new task to retry."
        );
        await publishMatrixProtocolAnswer(taskId);
      }).catch((error: unknown) => {
        if (error instanceof WorkspaceAccessDenied) return Promise.resolve();
        throw error;
      });
    },
  },
});
