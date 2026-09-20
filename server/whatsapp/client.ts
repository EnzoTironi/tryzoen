import { operationSignal, withTimeout } from "../operations/async";
import { TimeoutError } from "../operations/async";
import { z } from "zod";
import { env } from "@shared/environment";
export class WhatsAppBridgeUnavailable extends Error {
  readonly _tag = "WhatsAppBridgeUnavailable";
  declare readonly reason: string;
  constructor(input: { readonly reason: string }) {
    super("WhatsAppBridgeUnavailable");
    this.name = "WhatsAppBridgeUnavailable";
    Object.assign(this, input);
  }
}
const loginStepSchema = z.object({
  login_id: z.string(),
  type: z.optional(z.string()),
  step_id: z.optional(z.string()),
  display_and_wait: z.optional(
    z.object({
      type: z.optional(z.string()),
      data: z.optional(z.string()),
    })
  ),
});
const whoamiSchema = z.object({
  logins: z.optional(
    z.array(
      z.object({
        id: z.string(),
        name: z.optional(z.string()),
        profile: z.optional(
          z.object({
            phone: z.optional(z.string()),
            name: z.optional(z.string()),
          })
        ),
      })
    )
  ),
});
const eventSchema = z.object({
  event_id: z.string(),
});
const whatsappBridgeConfiguration = async () => {
  if (!env.ZOEN_WHATSAPP_BRIDGE_URL || !env.ZOEN_WHATSAPP_PROVISIONING_SECRET)
    throw new WhatsAppBridgeUnavailable({
      reason: "unconfigured",
    });
  return {
    url: env.ZOEN_WHATSAPP_BRIDGE_URL,
    secret: env.ZOEN_WHATSAPP_PROVISIONING_SECRET,
    asToken: env.ZOEN_WHATSAPP_AS_TOKEN,
    matrixUrl: env.ZOEN_MATRIX_URL,
    serverName: env.ZOEN_MATRIX_SERVER_NAME,
  };
};
const provisionRequest = async function (
  method: "GET" | "POST",
  path: string,
  userId: string,
  body?: z.core.util.JSONType
) {
  const config = await whatsappBridgeConfiguration();
  const url = new URL(path, config.url);
  url.searchParams.set("user_id", userId);
  try {
    return await withTimeout(async () => {
      try {
        return await (async (signal) => {
          const options: RequestInit = {
            method,
            signal,
            redirect: "error",
            headers: {
              authorization: `Bearer ${config.secret.reveal()}`,
              "content-type": "application/json",
            },
          };
          if (body !== undefined && method !== "GET")
            options.body = JSON.stringify(body);
          const response = await fetch(url, options);
          if (!response.ok)
            throw new WhatsAppBridgeUnavailable({
              reason: "unreachable",
            });
          const text = await response.text();
          if (!text) return {};
          return z.json().parse(JSON.parse(text));
        })(operationSignal());
      } catch (error) {
        throw error instanceof WhatsAppBridgeUnavailable
          ? error
          : new WhatsAppBridgeUnavailable({
              reason: "unreachable",
            });
      }
    }, 20000);
  } catch (error) {
    if (error instanceof TimeoutError)
      throw new WhatsAppBridgeUnavailable({
        reason: "unreachable",
      });
    throw error;
  }
};

/** Ready is required before any pairing or send. Tokens never enter URLs or logs. */
export const assertWhatsAppBridgeReady = async function () {
  const config = await whatsappBridgeConfiguration();
  await withTimeout(async () => {
    try {
      await (async (signal) => {
        const response = await fetch(
          new URL("/_matrix/mau/ready", config.url),
          {
            method: "GET",
            signal,
            redirect: "error",
            headers: {
              authorization: `Bearer ${config.secret.reveal()}`,
            },
          }
        );
        if (!response.ok)
          throw new WhatsAppBridgeUnavailable({
            reason: "unreachable",
          });
      })(operationSignal());
      return;
    } catch (error) {
      throw error instanceof WhatsAppBridgeUnavailable
        ? error
        : new WhatsAppBridgeUnavailable({
            reason: "unreachable",
          });
    }
  }, 8000).catch((error: unknown) => {
    if (error instanceof TimeoutError)
      throw new WhatsAppBridgeUnavailable({
        reason: "unreachable",
      });
    throw error;
  });
};
export const startWhatsAppLogin = async function (matrixUserId: string) {
  await assertWhatsAppBridgeReady();
  const raw = await provisionRequest(
    "POST",
    "/_matrix/provision/v3/login/start/qr",
    matrixUserId
  );
  const step = await loginStepSchema.parseAsync(raw);
  return {
    loginId: step.login_id,
    qr: step.display_and_wait?.data ?? null,
  };
};
export const whoamiWhatsApp = async function (matrixUserId: string) {
  await assertWhatsAppBridgeReady();
  const raw = await provisionRequest(
    "GET",
    "/_matrix/provision/v3/whoami",
    matrixUserId
  );
  const whoami = await whoamiSchema.parseAsync(raw);
  const login = whoami.logins?.[0];
  return {
    loggedIn: Boolean(login),
    loginId: login?.id ?? null,
    remoteUserId: login?.id ?? login?.profile?.phone ?? login?.name ?? null,
  };
};
export const logoutWhatsApp = async function (
  matrixUserId: string,
  loginId?: string | null
) {
  await assertWhatsAppBridgeReady();
  await provisionRequest(
    "POST",
    `/_matrix/provision/v3/logout/${encodeURIComponent(loginId ?? "all")}`,
    matrixUserId
  );
  return {
    loggedOut: true as const,
  };
};

/** Portal send uses the WhatsApp appservice token as the puppet. Never delivered without it. */
export const sendWhatsAppPortalMessage = async function (input: {
  roomId: string;
  body: string;
  txnId: string;
  puppetUserId: string;
}) {
  const config = await whatsappBridgeConfiguration();
  const asToken = config.asToken;
  const matrixUrl = config.matrixUrl;
  if (!asToken || !matrixUrl)
    throw new WhatsAppBridgeUnavailable({
      reason: "unconfigured",
    });
  const url = new URL(
    `/_matrix/client/v3/rooms/${encodeURIComponent(input.roomId)}/send/m.room.message/${encodeURIComponent(input.txnId)}`,
    matrixUrl
  );
  url.searchParams.set("user_id", input.puppetUserId);
  try {
    return await withTimeout(async () => {
      try {
        return await (async (signal) => {
          const response = await fetch(url, {
            method: "PUT",
            signal,
            redirect: "error",
            headers: {
              authorization: `Bearer ${asToken.reveal()}`,
              "content-type": "application/json",
            },
            body: JSON.stringify({
              msgtype: "m.text",
              body: input.body,
            }),
          });
          if (!response.ok)
            throw new WhatsAppBridgeUnavailable({
              reason: "unreachable",
            });
          return eventSchema.parse(await response.json());
        })(operationSignal());
      } catch (error) {
        throw error instanceof WhatsAppBridgeUnavailable
          ? error
          : new WhatsAppBridgeUnavailable({
              reason: "unreachable",
            });
      }
    }, 20000);
  } catch (error) {
    if (error instanceof TimeoutError)
      throw new WhatsAppBridgeUnavailable({
        reason: "unreachable",
      });
    throw error;
  }
};
