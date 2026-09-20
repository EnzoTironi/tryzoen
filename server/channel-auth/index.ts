import { isValid } from "@shared/validation";
import { z } from "zod";
import { randomBytes } from "node:crypto";
import type { BetterAuthPlugin } from "better-auth";
import {
  APIError,
  createAuthEndpoint,
  formCsrfMiddleware,
  getAuthoritativeSessionFromCtx,
  originCheckMiddleware,
} from "better-auth/api";
import { setSessionCookie } from "better-auth/cookies";
import {
  channelChallengeIdSchema,
  channelChallengeRequestSchema,
  channelChallengeSchema,
  deviceBindingSchema,
  deviceRequestSchema,
  deviceBoundSchema,
} from "../../shared/identity/channel-auth.ts";
import { ChannelAccountError, ChannelAccounts } from "../accounts/index.ts";
import { NativeDeviceAuth } from "../accounts/device";
import { channelDestination } from "../channels/destination";
type EndpointContext = Parameters<typeof setSessionCookie>[0];
const BrowserSecret = z.string().regex(/^[A-Za-z0-9_-]{43}$/u);
class ChannelAuthError extends Error {
  readonly _tag = "ChannelAuthError";
  declare readonly reason:
    | "unavailable"
    | "unauthorized"
    | "invalid"
    | "internal";
  constructor(input: {
    readonly reason: "unavailable" | "unauthorized" | "invalid" | "internal";
  }) {
    super("ChannelAuthError");
    this.name = "ChannelAuthError";
    Object.assign(this, input);
  }
}
const sdk = async <A>(call: () => Promise<A>) => {
  try {
    return await call();
  } catch {
    throw new ChannelAuthError({
      reason: "internal",
    });
  }
};
const browserCookie = (ctx: EndpointContext, id: string) => {
  const cookie = ctx.context.createAuthCookie(`channel_challenge_${id}`, {
    maxAge: 600,
  });
  return {
    name: cookie.name,
    attributes: {
      ...cookie.attributes,
      domain: undefined,
      httpOnly: true,
      sameSite: "lax" as const,
      path: `${new URL(ctx.context.baseURL).pathname.replace(/\/$/u, "")}/channel-auth`,
      maxAge: 600,
    },
  };
};
const readBrowserSecret = async function (ctx: EndpointContext, id: string) {
  const cookie = browserCookie(ctx, id);
  const value = await sdk(() =>
    ctx.getSignedCookie(cookie.name, ctx.context.secret)
  );
  try {
    return await BrowserSecret.parseAsync(value);
  } catch {
    throw new ChannelAuthError({
      reason: "invalid",
    });
  }
};
const readLinkSession = async function (ctx: EndpointContext) {
  const current = await sdk(() => getAuthoritativeSessionFromCtx(ctx));
  if (!current)
    throw new ChannelAuthError({
      reason: "unauthorized",
    });
  const link = {
    userId: current.user.id,
    sessionId: current.session.id,
  };
  const accounts = ChannelAccounts;
  await accounts.requireFreshSession(link);
  return link;
};
const publicError = (error: ChannelAuthError | ChannelAccountError) => {
  if (error.reason === "sender_unlinked")
    return new APIError("FORBIDDEN", {
      message:
        "This messenger is not linked to a Zoen account yet. Sign in with Google, then link it from your account.",
    });
  if (error.reason === "unavailable")
    return new APIError("SERVICE_UNAVAILABLE", {
      message: "Channel unavailable",
    });
  if (error.reason === "account_conflict")
    return new APIError("CONFLICT", {
      message:
        "This messenger is already associated with another account. Accounts are not merged.",
    });
  if (error.reason === "archive_requires_review")
    return new APIError("PRECONDITION_FAILED", {
      message:
        "This account has connections or access that requires separate review.",
    });
  if (error.reason === "account_busy")
    return new APIError("LOCKED", {
      message: "Wait for current deliveries to finish before linking accounts.",
    });
  if (error.reason === "internal")
    return new APIError("INTERNAL_SERVER_ERROR", {
      message: "Unable to complete channel authentication",
    });
  if (error.reason === "unauthorized" || error.reason === "session_invalid")
    return new APIError("UNAUTHORIZED", {
      message: "A recent authenticated session is required",
    });
  return new APIError("BAD_REQUEST", {
    message: "Invalid channel challenge",
  });
};
async function execute<A>(program: Promise<A>): Promise<A> {
  try {
    return await program;
  } catch (error) {
    if (
      error instanceof ChannelAccountError ||
      error instanceof ChannelAuthError
    ) {
      throw publicError(error);
    }
    throw new APIError("INTERNAL_SERVER_ERROR", {
      message: "Unable to complete channel authentication",
    });
  }
}
export const channelAuthPlugin = () =>
  ({
    id: "channel-auth",
    endpoints: {
      startChannelAuth: createAuthEndpoint(
        "/channel-auth/start",
        {
          method: "POST",
          body: channelChallengeRequestSchema,
          use: [originCheckMiddleware, formCsrfMiddleware],
          requireHeaders: true,
        },
        async (ctx) =>
          ctx.json(
            await execute(
              (async function () {
                const destination = await Promise.try(async () =>
                  channelDestination(ctx.body.channel)
                ).catch(() => {
                  throw new ChannelAuthError({
                    reason: "unavailable",
                  });
                });
                const current =
                  ctx.body.purpose === "link"
                    ? await readLinkSession(ctx)
                    : null;
                const accounts = ChannelAccounts;
                const browserSecret = randomBytes(32).toString("base64url");
                const challenge = await accounts.issueChallenge(
                  current
                    ? {
                        purpose: "link" as const,
                        channel: ctx.body.channel,
                        installationId: destination.installationId,
                        browserSecret,
                        userId: current.userId,
                        sessionId: current.sessionId,
                      }
                    : {
                        purpose: "login" as const,
                        channel: ctx.body.channel,
                        installationId: destination.installationId,
                        browserSecret,
                      }
                );
                const message =
                  ctx.body.channel === "kapso"
                    ? `/start ${challenge.token}`
                    : challenge.token;
                const response = await channelChallengeSchema.parseAsync({
                  id: challenge.challengeId,
                  channel: ctx.body.channel,
                  deepLink: `${destination.url}?${destination.parameter}=${encodeURIComponent(message)}`,
                  expiresAt: challenge.expiresAt,
                });
                const cookie = browserCookie(ctx, challenge.challengeId);
                await sdk(() =>
                  ctx.setSignedCookie(
                    cookie.name,
                    browserSecret,
                    ctx.context.secret,
                    cookie.attributes
                  )
                );
                ctx.setHeader("Cache-Control", "no-store");
                return response;
              })()
            )
          )
      ),
      bindNativeDevice: createAuthEndpoint(
        "/channel-auth/device-bind",
        {
          method: "POST",
          body: deviceBindingSchema,
          use: [originCheckMiddleware, formCsrfMiddleware],
          requireHeaders: true,
        },
        async (ctx) =>
          ctx.json(
            await execute(
              (async function () {
                const cookie = browserCookie(ctx, ctx.body.id);
                const previous = await sdk(() =>
                  ctx.getSignedCookie(cookie.name, ctx.context.secret)
                );
                const browserSecret = isValid(BrowserSecret, previous)
                  ? previous
                  : randomBytes(32).toString("base64url");
                const devices = NativeDeviceAuth;
                const input = {
                  ...ctx.body,
                  browserSecret,
                };
                const bound =
                  ctx.body.purpose === "link"
                    ? await devices.bind({
                        ...input,
                        link: await readLinkSession(ctx),
                      })
                    : await devices.bind(input);
                await sdk(() =>
                  ctx.setSignedCookie(
                    cookie.name,
                    browserSecret,
                    ctx.context.secret,
                    cookie.attributes
                  )
                );
                ctx.setHeader("Cache-Control", "no-store");
                return await deviceBoundSchema.parseAsync({
                  id: bound.id,
                  purpose: bound.purpose,
                  channel: bound.channel,
                  expiresAt: bound.expiresAt,
                });
              })()
            )
          )
      ),
      resumeNativeDevice: createAuthEndpoint(
        "/channel-auth/device",
        {
          method: "GET",
          query: deviceRequestSchema,
          requireHeaders: true,
        },
        async (ctx) =>
          ctx.json(
            await execute(
              (async function () {
                const browserSecret = await readBrowserSecret(
                  ctx,
                  ctx.query.id
                );
                const devices = NativeDeviceAuth;
                const input = {
                  ...ctx.query,
                  browserSecret,
                };
                const bound =
                  ctx.query.purpose === "link"
                    ? await devices.resume({
                        ...input,
                        link: await readLinkSession(ctx),
                      })
                    : await devices.resume(input);
                ctx.setHeader("Cache-Control", "no-store");
                return {
                  id: bound.id,
                  purpose: bound.purpose,
                  channel: bound.channel,
                  expiresAt: bound.expiresAt,
                };
              })()
            )
          )
      ),
      channelAuthStatus: createAuthEndpoint(
        "/channel-auth/status",
        {
          method: "GET",
          query: channelChallengeIdSchema,
          requireHeaders: true,
        },
        async (ctx) =>
          ctx.json(
            await execute(
              (async function () {
                const browserSecret = await readBrowserSecret(
                  ctx,
                  ctx.query.id
                );
                const accounts = ChannelAccounts;
                const status = await accounts.getChallengeStatus({
                  challengeId: ctx.query.id,
                  browserSecret,
                });
                ctx.setHeader("Cache-Control", "no-store");
                return status;
              })()
            )
          )
      ),
      completeChannelAuth: createAuthEndpoint(
        "/channel-auth/complete",
        {
          method: "POST",
          body: channelChallengeIdSchema,
          use: [originCheckMiddleware, formCsrfMiddleware],
          requireHeaders: true,
        },
        async (ctx) =>
          ctx.json(
            await execute(
              (async function () {
                const browserSecret = await readBrowserSecret(ctx, ctx.body.id);
                const current = await sdk(() =>
                  getAuthoritativeSessionFromCtx(ctx)
                );
                const accounts = ChannelAccounts;
                const consumeInput = {
                  challengeId: ctx.body.id,
                  browserSecret,
                };
                const consumed = await accounts.consumeChallenge(
                  current
                    ? {
                        ...consumeInput,
                        currentSessionId: current.session.id,
                      }
                    : consumeInput
                );
                if (consumed.purpose === "login") {
                  const issued = await accounts.withLoginSession(
                    consumed,
                    async function () {
                      const user = await sdk(() =>
                        ctx.context.internalAdapter.findUserById(
                          consumed.userId
                        )
                      );
                      if (!user)
                        throw new ChannelAuthError({
                          reason: "invalid",
                        });
                      const session = await sdk(() =>
                        ctx.context.internalAdapter.createSession(user.id)
                      );
                      return {
                        session,
                        user,
                      };
                    }
                  );
                  await sdk(() => setSessionCookie(ctx, issued));
                }
                const cookie = browserCookie(ctx, ctx.body.id);
                ctx.setCookie(cookie.name, "", {
                  ...cookie.attributes,
                  maxAge: 0,
                });
                ctx.setHeader("Cache-Control", "no-store");
                return {
                  ok: true as const,
                };
              })()
            )
          )
      ),
    },
  }) satisfies BetterAuthPlugin;
