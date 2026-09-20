import { withSignal } from "../../server/operations/async";
import { TimeoutError } from "../../server/operations/async";
import { InvalidMessage } from "../../server/messaging/model";
import { IdentityInactive } from "../../server/messaging/model";
import { ChannelTransportError } from "../../server/channels/transport";
import { ChannelResponseUncertain } from "../lib/channel-response";
import { ChannelResponseRejected } from "../lib/channel-response";
import { ZodError as SchemaError } from "zod";
import { InternalCallbackRejected } from "../../server/internal/callback-auth";
import { jsonString } from "@shared/validation";
import { defineChannel, POST } from "eve/channels";
import {
  internalCallbackBodies,
  readAuthenticatedInternalCallback,
} from "../../server/internal/callback-auth";
import { submitChannelResponse } from "../lib/channel-response";
const route = "/internal/channel-input/respond";
export default defineChannel({
  routes: [
    POST(route, (request, { attachSession }) =>
      withSignal(request.signal, async () => {
        try {
          try {
            try {
              try {
                try {
                  try {
                    try {
                      try {
                        const raw = await readAuthenticatedInternalCallback(
                          request,
                          route
                        );
                        if (raw instanceof Response) return raw;
                        const input = await jsonString(
                          internalCallbackBodies[route].strict()
                        ).parseAsync(raw.toString("utf8"));
                        await submitChannelResponse(
                          input,
                          attachSession(input.sessionId)
                        );
                        return Response.json(
                          {
                            status: "accepted",
                            requestId: input.requestId,
                          },
                          {
                            status: 202,
                          }
                        );
                      } catch (error) {
                        if (error instanceof InternalCallbackRejected)
                          return new Response(null, {
                            status: error.status,
                          });
                        throw error;
                      }
                    } catch (error) {
                      if (error instanceof SchemaError)
                        return new Response(null, {
                          status: 400,
                        });
                      throw error;
                    }
                  } catch (error) {
                    if (error instanceof ChannelResponseRejected)
                      return new Response(null, {
                        status: 409,
                      });
                    throw error;
                  }
                } catch (error) {
                  if (error instanceof ChannelResponseUncertain)
                    return new Response(null, {
                      status: 503,
                    });
                  throw error;
                }
              } catch (error) {
                if (error instanceof ChannelTransportError)
                  return new Response(null, {
                    status: 401,
                  });
                throw error;
              }
            } catch (error) {
              if (error instanceof IdentityInactive)
                return new Response(null, {
                  status: 401,
                });
              throw error;
            }
          } catch (error) {
            if (error instanceof InvalidMessage)
              return new Response(null, {
                status: 409,
              });
            throw error;
          }
        } catch (error) {
          if (error instanceof TimeoutError)
            return new Response(null, {
              status: 503,
            });
          throw error;
        }
      })
    ),
  ],
});
