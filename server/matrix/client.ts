import { operationSignal, withTimeout } from "../operations/async";
import { TimeoutError } from "../operations/async";
import { z } from "zod";
import { readBody } from "../http/body";
import { env } from "@shared/environment";
export class MatrixError extends Error {
  readonly _tag = "MatrixError";
  declare readonly reason:
    | "unavailable"
    | "forbidden"
    | "conflict"
    | "expired-position"
    | "not-found";
  constructor(input: { readonly reason: MatrixError["reason"] }) {
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
  method: "GET" | "POST" | "PUT" | "DELETE",
  path: string,
  body?: z.core.util.JSONType,
  userId?: string,
  requestOptions: {
    version?:
      | ""
      | "v1"
      | "v3"
      | "unstable/org.matrix.simplified_msc3575"
      | "unstable/io.element.msc4306";
    maxResponseBytes?: number;
  } = {}
) {
  const config = await matrixConfiguration();
  const version = requestOptions.version ?? "v3";
  const url = new URL(
    `/_matrix/client/${version ? `${version}/` : ""}${path}`,
    config.url
  );
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
        const payload: unknown = requestOptions.maxResponseBytes
          ? JSON.parse(
              (
                await readBody(response.body, requestOptions.maxResponseBytes)
              ).toString("utf8")
            )
          : await response.json();
        if (!response.ok) {
          const error = z
            .object({
              errcode: z.optional(z.string()),
            })
            .parse(payload);
          throw new MatrixError({
            reason: matrixFailureReason(error.errcode, response.status),
          });
        }
        return z.json().parse(payload);
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

function matrixFailureReason(
  code: string | undefined,
  status: number
): MatrixError["reason"] {
  if (code === "M_UNKNOWN_POS") return "expired-position";
  if (code === "M_USER_IN_USE" || code === "M_ROOM_IN_USE") return "conflict";
  if (status === 403) return "forbidden";
  if (status === 404) return "not-found";
  return "unavailable";
}

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
const matrixRelation = z.object({
  rel_type: z.string().optional(),
  event_id: z.string().optional(),
  key: z.string().optional(),
  "m.in_reply_to": z.object({ event_id: z.string() }).optional(),
});
const matrixContent = z.object({
  redacts: z.string().optional(),
  body: z.string().optional(),
  url: z.string().optional(),
  filename: z.string().optional(),
  info: z
    .object({ mimetype: z.string().optional(), size: z.number().optional() })
    .optional(),
  msgtype: z.string().optional(),
  membership: z.string().optional(),
  "m.relates_to": matrixRelation.optional(),
});
const matrixEvent = z.object({
  redacts: z.string().optional(),
  event_id: z.string(),
  room_id: z.string().optional(),
  type: z.string(),
  sender: z.string(),
  state_key: z.string().optional(),
  "m.in_reply_to": z.object({ event_id: z.string() }).optional(),
  origin_server_ts: z.number().optional(),
  content: matrixContent.extend({
    "m.new_content": matrixContent.optional(),
    "org.zoen.edit_operation": z.string().optional(),
    "org.zoen.forwarded": z.boolean().optional(),
    "org.zoen.transaction_id": z.string().max(100).optional(),
  }),
});
const redaction = z.object({ redacted_because: z.json().optional() });
export const MatrixEventSchema = matrixEvent.extend({
  unsigned: redaction
    .extend({
      "m.relations": z
        .object({
          "m.thread": z
            .object({ count: z.number().int().nonnegative() })
            .optional(),
          "m.replace": matrixEvent
            .extend({ unsigned: redaction.optional() })
            .optional(),
        })
        .optional(),
    })
    .optional(),
});
