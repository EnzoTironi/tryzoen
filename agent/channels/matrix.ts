import { publishMatrixToolResult } from "../../server/matrix/tool-results";
import {
  publishMatrixInputs,
  respondToMatrixInput,
} from "../../server/matrix/inputs";
import {
  deliveryContext,
  deliverOnce,
  type DeliveryState,
} from "../lib/durable-delivery";
import { mapAsync } from "../../server/operations/async";
import { MatrixError } from "../../server/matrix/client";
import { isValid } from "@shared/validation";
import { z } from "zod";
import { defineChannel, GET, POST, PUT } from "eve/channels";
import {
  acceptMatrixTransaction,
  authorizeMatrixHomeserver,
} from "../../server/matrix/inbound";
import {
  deliverMatrixEvent,
  finishMatrixEvent,
  completeMatrixEvent,
} from "../../server/matrix/delivery";
import { WorkspaceAccessDenied } from "../../server/workspaces/access";
import { matrixConfiguration } from "../../server/matrix/client";
import { matrixProtocolTask } from "../../server/matrix/network-delivery";
import a2a from "./a2a";

interface MatrixState extends DeliveryState {
  response?: {
    key: string;
    text: string;
    delivered: boolean;
    onlyReactionResults: boolean;
    awaitingInput: boolean;
  };
}

function matrixTurnResponse(
  state: MatrixState,
  sequence: number,
  turnId: string
) {
  const key = `${String(sequence)}:${turnId}`;
  if (state.response?.key !== key)
    state.response = {
      key,
      text: "",
      delivered: false,
      onlyReactionResults: true,
      awaitingInput: false,
    };
  return state.response;
}

export default defineChannel({
  state: {
    receipts: {},
  },
  context: (state: MatrixState, session) => ({
    ...deliveryContext(state, session),
    state,
  }),
  deliver: (payload, channel) => deliverOnce(payload, channel),
  receive(input, context) {
    return (async function () {
      if (
        input.auth?.principalType !== "runtime" ||
        input.auth.authenticator !== "app"
      )
        throw new WorkspaceAccessDenied();
      const target = await z
        .object({
          eventId: z.string(),
        })
        .parseAsync(input.target);
      const response = await respondToMatrixInput(target.eventId, context);
      if (response.handled) {
        if (response.session) return response.session;
        throw new MatrixError({ reason: "forbidden" });
      }
      return await deliverMatrixEvent(target.eventId, context);
    })();
  },
  routes: [
    PUT("/_matrix/app/v1/transactions/:txnId", async (request, context) => {
      try {
        try {
          const events = await acceptMatrixTransaction(
            request,
            context.params.txnId ?? ""
          );
          // Acknowledge persisted events even when native dispatch is temporarily down.
          context.waitUntil(
            mapAsync(
              events,
              async (id) => {
                try {
                  const protocol = await matrixProtocolTask(id);
                  if (!protocol) {
                    const response = await respondToMatrixInput(id, context);
                    if (!response.handled)
                      await deliverMatrixEvent(id, context);
                    return;
                  }
                  const config = await matrixConfiguration();
                  {
                    await context
                      .to(a2a, {
                        taskId: protocol.taskId,
                      })
                      .send("Resume accepted Matrix request", {
                        auth: {
                          principalType: "service",
                          principalId: config.serverName,
                          authenticator: "matrix-homeserver",
                          attributes: {
                            matrixEventId: id,
                          },
                        },
                      });
                  }
                } catch {
                  console.warn("Matrix event awaits native recovery", {
                    eventId: id,
                  });
                }
              },
              2
            )
          );
          return Response.json({});
        } catch (error) {
          if (error instanceof MatrixError)
            return Response.json(
              {
                errcode: "M_FORBIDDEN",
              },
              {
                status: error.reason === "forbidden" ? 403 : 503,
              }
            );
          throw error;
        }
      } catch {
        return Response.json(
          {
            errcode: "M_UNKNOWN",
          },
          {
            status: 503,
          }
        );
      }
    }),
    POST("/_matrix/app/v1/ping", async (request) => {
      try {
        await authorizeMatrixHomeserver(request);
        return Response.json({});
      } catch {
        return Response.json(
          {
            errcode: "M_FORBIDDEN",
          },
          {
            status: 403,
          }
        );
      }
    }),
    GET("/_matrix/app/v1/users/:userId", async (request, { params }) => {
      try {
        await authorizeMatrixHomeserver(request);
        const config = await matrixConfiguration();
        return Response.json(
          {},
          {
            status: params.userId === config.botId ? 200 : 404,
          }
        );
      } catch {
        return Response.json(
          {
            errcode: "M_FORBIDDEN",
          },
          {
            status: 403,
          }
        );
      }
    }),
    GET("/_matrix/app/v1/rooms/:roomAlias", async (request) => {
      try {
        await authorizeMatrixHomeserver(request);
        return Response.json(
          {
            errcode: "M_NOT_FOUND",
          },
          {
            status: 404,
          }
        );
      } catch {
        return Response.json(
          {
            errcode: "M_FORBIDDEN",
          },
          {
            status: 403,
          }
        );
      }
    }),
  ],
  events: {
    "turn.started"(event, channel) {
      matrixTurnResponse(channel.state, event.sequence, event.turnId);
    },
    async "action.result"(event, channel, context) {
      const delivered = await publishMatrixToolResult(event, context);
      const response = matrixTurnResponse(
        channel.state,
        event.sequence,
        event.turnId
      );
      if (delivered) response.delivered = true;
      response.onlyReactionResults &&= delivered === "reaction";
    },
    async "input.requested"(event, channel, context) {
      const eventId = context.session.auth.current?.attributes.matrixEventId;
      if (isValid(z.string(), eventId)) {
        await publishMatrixInputs(eventId, context.session.id, event.requests);
        matrixTurnResponse(
          channel.state,
          event.sequence,
          event.turnId
        ).awaitingInput = true;
      }
    },
    async "session.failed"(_event, channel) {
      const token = channel.continuation?.token;
      if (!token?.startsWith("matrix:")) return;
      await Promise.try(async () =>
        finishMatrixEvent(
          token.slice(7),
          "Não consegui concluir esta tarefa. Mencione Zoen para tentar novamente."
        )
      ).catch((error: unknown) => {
        if (error instanceof WorkspaceAccessDenied) return Promise.resolve();
        throw error;
      });
      delete channel.state.response;
    },
    "message.completed"(event, channel) {
      // Text blocks can precede or follow tool calls. Only the settled turn can
      // decide whether text is a fallback for native message/reaction delivery.
      if (event.message)
        matrixTurnResponse(channel.state, event.sequence, event.turnId).text =
          event.message;
    },
    async "turn.completed"(event, channel, context) {
      const response = matrixTurnResponse(
        channel.state,
        event.sequence,
        event.turnId
      );
      // Eve also completes a turn when it parks a native question or approval.
      // Keep its delivery authority open until the resumed request settles.
      if (response.awaitingInput) {
        delete channel.state.response;
        return;
      }
      const eventId = context.session.auth.current?.attributes.matrixEventId;
      if (!isValid(z.string(), eventId)) return;
      const message = response.text.trim();
      await Promise.try(async () =>
        response.delivered || message === "DELIVERY_COMPLETE" || !message
          ? completeMatrixEvent(eventId)
          : finishMatrixEvent(eventId, message)
      ).catch((error: unknown) => {
        if (error instanceof WorkspaceAccessDenied) return Promise.resolve();
        throw error;
      });
      delete channel.state.response;
    },
    async "turn.failed"(event, channel, context) {
      const eventId = context.session.auth.current?.attributes.matrixEventId;
      if (!isValid(z.string(), eventId)) return;
      const response = matrixTurnResponse(
        channel.state,
        event.sequence,
        event.turnId
      );
      // Eve treats an empty model follow-up as a failure even when a reaction
      // already fulfilled the turn. Other tools and failures remain reportable.
      const deliveredReaction =
        response.delivered &&
        response.onlyReactionResults &&
        !response.awaitingInput &&
        event.code === "MODEL_CALL_FAILED" &&
        event.details?.semanticErrorId === "empty-model-response";
      await Promise.try(async () =>
        deliveredReaction
          ? completeMatrixEvent(eventId)
          : finishMatrixEvent(
              eventId,
              "Não consegui concluir esta tarefa. Mencione Zoen para tentar novamente."
            )
      ).catch((error: unknown) => {
        if (error instanceof WorkspaceAccessDenied) return Promise.resolve();
        throw error;
      });
      if (
        channel.state.response?.key ===
        `${String(event.sequence)}:${event.turnId}`
      )
        delete channel.state.response;
    },
    "turn.cancelled"(event, channel) {
      if (
        channel.state.response?.key ===
        `${String(event.sequence)}:${event.turnId}`
      )
        delete channel.state.response;
    },
  },
});
