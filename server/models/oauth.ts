import { operationSignal, withTimeout } from "../operations/async";
import { jsonString, isValid } from "@shared/validation";
import { z } from "zod";
// Protocol adapters informed by pi's MIT-licensed device OAuth flows; see THIRD_PARTY_NOTICES.md.

import type { ModelProviderSchema } from "../../shared/models/catalog";
import { ModelConnectionError } from "../../shared/models/catalog";

const clients = {
  chatgpt: "app_EMoamEEZ73f0CkXaXp7hrann",
  grok: "b1a00492-073a-47ea-816f-4c329264a828",
} as const;
const tokenUrls = {
  chatgpt: "https://auth.openai.com/oauth/token",
  grok: "https://auth.x.ai/oauth2/token",
} as const;
const secret = z.string().min(1).max(24_000);
export const ModelTokensSchema = z.object({
  accessToken: secret,
  refreshToken: secret,
  expiresAt: z.number(),
  accountId: z.optional(z.string()),
});
export const DevicePayloadSchema = z.object({
  deviceCode: secret,
  userCode: secret,
});
const TokenResponse = z.object({
  access_token: secret,
  refresh_token: z.optional(secret),
  expires_in: z.number().gt(0),
});
const DeviceResponse = z.object({
  device_code: secret,
  user_code: secret,
  verification_uri: z.string(),
  interval: z.optional(z.number()),
  expires_in: z.number(),
});
const CodexDeviceResponse = z.object({
  device_auth_id: secret,
  user_code: secret,
  interval: z.optional(z.union([z.number(), z.string()])),
});
const ProviderError = z.object({ error: z.string() });

const oauthRequest = async function (
  url: string,
  body: URLSearchParams | string
) {
  const response = await withTimeout(async () => {
    try {
      return await ((signal) =>
        fetch(url, {
          method: "POST",
          redirect: "error",
          signal,
          headers: {
            "content-type": isValid(z.string(), body)
              ? "application/json"
              : "application/x-www-form-urlencoded",
            accept: "application/json",
          },
          body,
        }))(operationSignal());
    } catch {
      throw new ModelConnectionError({ reason: "unavailable" });
    }
  }, 20000);
  const data: unknown = await Promise.try(async (): Promise<unknown> =>
    response.json()
  ).catch(() => {
    throw new ModelConnectionError({ reason: "invalid_response" });
  });
  const json = await Promise.try(async () => z.json().parseAsync(data)).catch(
    () => {
      throw new ModelConnectionError({ reason: "invalid_response" });
    }
  );
  return { status: response.status, data: json };
};

const parseTokens = async function (
  provider: z.output<typeof ModelProviderSchema>,
  data: z.core.util.JSONType,
  previousRefresh?: string
) {
  const token = await Promise.try(async () =>
    TokenResponse.parseAsync(data)
  ).catch(() => {
    throw new ModelConnectionError({ reason: "invalid_response" });
  });
  const refreshToken = token.refresh_token ?? previousRefresh;
  if (!refreshToken)
    throw new ModelConnectionError({ reason: "invalid_response" });
  const now = new Date();
  let accountId: string | undefined;
  if (provider === "chatgpt") {
    const payload = token.access_token.split(".")[1];
    if (!payload)
      throw new ModelConnectionError({ reason: "invalid_response" });
    // Routing metadata only: this claim is never used to authenticate a Zoen user.
    const identity = await Promise.try(async () =>
      jsonString(
        z.object({
          "https://api.openai.com/auth": z.object({
            chatgpt_account_id: z.string().min(1),
          }),
        })
      ).parseAsync(Buffer.from(payload, "base64url").toString("utf8"))
    ).catch(() => {
      throw new ModelConnectionError({ reason: "invalid_response" });
    });
    accountId = identity["https://api.openai.com/auth"].chatgpt_account_id;
  }
  return {
    accessToken: token.access_token,
    refreshToken,
    expiresAt: now.getTime() + token.expires_in * 1000,
    accountId,
  };
};

export const beginModelOAuth = async function (
  provider: z.output<typeof ModelProviderSchema>
) {
  if (provider === "chatgpt") {
    const response = await oauthRequest(
      "https://auth.openai.com/api/accounts/deviceauth/usercode",
      JSON.stringify({ client_id: clients.chatgpt })
    );
    if (response.status !== 200)
      throw new ModelConnectionError({ reason: "unavailable" });
    const value = await CodexDeviceResponse.parseAsync(response.data);
    const seconds = Number(value.interval ?? 5);
    return {
      deviceCode: value.device_auth_id,
      userCode: value.user_code,
      verificationUri: "https://auth.openai.com/codex/device",
      interval: Number.isFinite(seconds)
        ? Math.max(5, Math.min(seconds, 60))
        : 5,
      expiresIn: 900,
    };
  }
  const response = await oauthRequest(
    "https://auth.x.ai/oauth2/device/code",
    new URLSearchParams({
      client_id: clients.grok,
      scope: "openid profile email offline_access grok-cli:access api:access",
      referrer: "zoen",
    })
  );
  if (response.status !== 200)
    throw new ModelConnectionError({ reason: "unavailable" });
  const value = await DeviceResponse.parseAsync(response.data);
  const url = await Promise.try(
    async () => new URL(value.verification_uri)
  ).catch(() => {
    throw new ModelConnectionError({ reason: "invalid_response" });
  });
  if (
    url.protocol !== "https:" ||
    !["auth.x.ai", "accounts.x.ai", "grok.com"].includes(url.hostname) ||
    url.username ||
    url.password ||
    url.port
  )
    throw new ModelConnectionError({ reason: "invalid_response" });
  return {
    deviceCode: value.device_code,
    userCode: value.user_code,
    verificationUri: url.href,
    interval: Math.max(5, Math.min(value.interval ?? 5, 60)),
    expiresIn: Math.max(30, Math.min(value.expires_in, 900)),
  };
};

export const pollModelOAuth = async function (
  provider: z.output<typeof ModelProviderSchema>,
  payload: z.output<typeof DevicePayloadSchema>
) {
  const response =
    provider === "chatgpt"
      ? await oauthRequest(
          "https://auth.openai.com/api/accounts/deviceauth/token",
          JSON.stringify({
            device_auth_id: payload.deviceCode,
            user_code: payload.userCode,
          })
        )
      : await oauthRequest(
          tokenUrls.grok,
          new URLSearchParams({
            client_id: clients.grok,
            grant_type: "urn:ietf:params:oauth:grant-type:device_code",
            device_code: payload.deviceCode,
          })
        );
  if (response.status !== 200) {
    if (provider === "chatgpt" && [403, 404].includes(response.status))
      return { status: "pending" } as const;
    const error = ProviderError.safeParse(response.data);
    if (
      error.success &&
      [
        "authorization_pending",
        "deviceauth_authorization_pending",
        "slow_down",
      ].includes(error.data.error)
    )
      return {
        status: error.data.error === "slow_down" ? "slow_down" : "pending",
      } as const;
    throw new ModelConnectionError({
      reason: response.status === 429 ? "rate_limited" : "denied",
    });
  }
  let data = response.data;
  if (provider === "chatgpt") {
    const code = await z
      .object({ authorization_code: secret, code_verifier: secret })
      .parseAsync(data);
    const exchanged = await oauthRequest(
      tokenUrls.chatgpt,
      new URLSearchParams({
        client_id: clients.chatgpt,
        grant_type: "authorization_code",
        code: code.authorization_code,
        code_verifier: code.code_verifier,
        redirect_uri: "https://auth.openai.com/deviceauth/callback",
      })
    );
    if (exchanged.status !== 200)
      throw new ModelConnectionError({ reason: "denied" });
    data = exchanged.data;
  }
  return {
    status: "connected",
    tokens: await parseTokens(provider, data),
  } as const;
};

export const refreshModelOAuth = async function (
  provider: z.output<typeof ModelProviderSchema>,
  tokens: z.output<typeof ModelTokensSchema>
) {
  const response = await oauthRequest(
    tokenUrls[provider],
    new URLSearchParams({
      client_id: clients[provider],
      grant_type: "refresh_token",
      refresh_token: tokens.refreshToken,
    })
  );
  if (response.status !== 200)
    throw new ModelConnectionError({ reason: "reconnect" });
  return await parseTokens(provider, response.data, tokens.refreshToken);
};
