import { operationSignal, withTimeout } from "../operations/async";
import { TimeoutError } from "../operations/async";
import { z } from "zod";
import { env } from "@shared/environment";
export class MatrixError extends Error {
  readonly _tag = "MatrixError";
  declare readonly reason: "unavailable" | "forbidden" | "conflict";
  constructor(input: {
    readonly reason: "unavailable" | "forbidden" | "conflict";
  }) {
    super("MatrixError");
    this.name = "MatrixError";
    Object.assign(this, input);
  }
}
export const matrixConfiguration = async () => {
  if (
    !env.ZOEN_MATRIX_URL ||
    !env.ZOEN_MATRIX_SERVER_NAME ||
    !env.ZOEN_MATRIX_AS_TOKEN ||
    !env.ZOEN_MATRIX_HS_TOKEN
  )
    throw new MatrixError({
      reason: "unavailable",
    });
  return {
    url: env.ZOEN_MATRIX_URL,
    serverName: env.ZOEN_MATRIX_SERVER_NAME,
    token: env.ZOEN_MATRIX_AS_TOKEN,
    homeserverToken: env.ZOEN_MATRIX_HS_TOKEN,
    botId: `@_zoen_bot:${env.ZOEN_MATRIX_SERVER_NAME}`,
  };
};

/** Only a configured homeserver is reachable. Tokens never enter URLs or logs. */
export const matrixRequest = async function (
  method: "GET" | "POST" | "PUT",
  path: string,
  body?: z.core.util.JSONType,
  userId?: string
) {
  const config = await matrixConfiguration();
  const url = new URL(`/_matrix/client/v3/${path}`, config.url);
  if (userId) url.searchParams.set("user_id", userId);
  return await withTimeout(async () => {
    try {
      return await (async (signal) => {
        const options: RequestInit = {
          method,
          signal,
          redirect: "error",
          headers: {
            authorization: `Bearer ${config.token.reveal()}`,
            "content-type": "application/json",
          },
        };
        if (body !== undefined && method !== "GET")
          options.body = JSON.stringify(body);
        const response = await fetch(url, options);
        if (!response.ok) {
          const error = z
            .object({
              errcode: z.optional(z.string()),
            })
            .parse(await response.json());
          throw new MatrixError({
            reason:
              error.errcode === "M_USER_IN_USE" ||
              error.errcode === "M_ROOM_IN_USE"
                ? "conflict"
                : response.status === 403
                  ? "forbidden"
                  : "unavailable",
          });
        }
        return z.json().parse(await response.json());
      })(operationSignal());
    } catch (error) {
      throw error instanceof MatrixError
        ? error
        : new MatrixError({
            reason: "unavailable",
          });
    }
  }, 20000);
};

/** Synapse admin erase. A missing user is already gone. Live admin stays optional. */
export const deactivateMatrixUser = async function (matrixId: string) {
  const config = await matrixConfiguration();
  const url = new URL(
    `/_synapse/admin/v1/deactivate/${encodeURIComponent(matrixId)}`,
    config.url
  );
  await withTimeout(async () => {
    try {
      await (async (signal) => {
        const response = await fetch(url, {
          method: "POST",
          signal,
          redirect: "error",
          headers: {
            authorization: `Bearer ${config.token.reveal()}`,
            "content-type": "application/json",
          },
          body: JSON.stringify({
            erase: true,
          }),
        });
        if (response.ok || response.status === 404) return;
        throw new MatrixError({
          reason: "unavailable",
        });
      })(operationSignal());
      return;
    } catch (error) {
      throw error instanceof MatrixError
        ? error
        : new MatrixError({
            reason: "unavailable",
          });
    }
  }, 20000).catch((error: unknown) => {
    if (error instanceof TimeoutError)
      throw new MatrixError({
        reason: "unavailable",
      });
    throw error;
  });
  return {
    deactivated: true as const,
  };
};
export const MatrixEventSchema = z.object({
  event_id: z.string(),
  room_id: z.optional(z.string()),
  type: z.string(),
  sender: z.string(),
  state_key: z.optional(z.string()),
  origin_server_ts: z.optional(z.number()),
  content: z.object({
    body: z.optional(z.string()),
    msgtype: z.optional(z.string()),
    membership: z.optional(z.string()),
    "m.relates_to": z.optional(
      z.object({
        rel_type: z.optional(z.string()),
        event_id: z.optional(z.string()),
        key: z.optional(z.string()),
      })
    ),
  }),
});
