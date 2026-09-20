import { jsonString, isValid } from "@shared/validation";
import { z } from "zod";
import type { channelProviderSchema } from "@shared/identity/channel-auth";

import {
  channelStartResultSchema,
  deviceBindingSchema,
  type deviceRequestSchema,
  deviceBoundSchema,
  channelChallengeStatusSchema,
  channelChallengeCompletionSchema,
  channelChallengeIdSchema,
  channelChallengeRequestSchema,
} from "@shared/identity/channel-auth";

const localCallbackSchema = z.string().refine((value) => {
  try {
    const decoded = decodeURIComponent(value);
    return (
      value.startsWith("/") &&
      !value.startsWith("//") &&
      !decoded.startsWith("//") &&
      !/[\\\s]/u.test(decoded) &&
      !decoded
        .split("")
        .some(
          (character) =>
            character.charCodeAt(0) < 32 || character.charCodeAt(0) === 127
        ) &&
      new URL(value, "https://callback.invalid").origin ===
        "https://callback.invalid"
    );
  } catch {
    return false;
  }
});

export function safeCallbackUrl(value: string | undefined) {
  return ((parsed) => (parsed.success ? parsed.data : (() => "/")()))(
    localCallbackSchema.safeParse(value)
  );
}

interface SignOutResult {
  readonly data: { readonly success: boolean } | null;
  readonly error: {
    readonly status: number;
    readonly statusText: string;
  } | null;
}

export function reauthenticationDestination(
  outcome: PromiseSettledResult<SignOutResult>,
  callbackUrl: string
) {
  if (
    outcome.status === "rejected" ||
    outcome.value.error ||
    outcome.value.data?.success !== true
  )
    return undefined;
  return `/sign-in?callbackUrl=${encodeURIComponent(safeCallbackUrl(callbackUrl))}`;
}

export class ChannelAuthorizationError extends Error {
  readonly _tag = "ChannelAuthorizationError";
  declare readonly category: "terminal" | "rate-limit" | "transient";
  declare readonly status: number;
  declare readonly retryAfter: string | null;
  constructor(input: {
    readonly message: string;
    readonly category: "terminal" | "rate-limit" | "transient";
    readonly status: number;
    readonly retryAfter: string | null;
  }) {
    super(input.message);
    this.name = "ChannelAuthorizationError";
    Object.assign(this, input);
  }
}

export function channelHttpError(
  status: number,
  retryAfter: string | null = null
) {
  const terminal = [400, 401, 403, 404, 409, 410, 412].includes(status);
  return new ChannelAuthorizationError({
    status,
    retryAfter,
    category: terminal
      ? "terminal"
      : status === 429
        ? "rate-limit"
        : "transient",
    message: terminal
      ? "This sign-in could not be verified in this browser. Start again and confirm the new request in chat."
      : status === 429
        ? "Too many attempts. Wait before trying again."
        : status === 503
          ? "Sign-in through this messenger is unavailable. Try the other messenger, or try again later."
          : "Unable to check sign-in. Check your connection and try again.",
  });
}

export function invalidChannelChallenge(status: number) {
  return new ChannelAuthorizationError({
    status,
    retryAfter: null,
    category: "terminal",
    message: "This sign-in request is invalid. Start again.",
  });
}

export type ChannelAuthorizationStatus =
  | z.output<typeof channelChallengeStatusSchema>["status"]
  | "invalid";

// Better Auth resets its attempt counter after an idle window, not periodically.
// Leave the default ten-second window between successful status requests.
export const channelAuthorizationPollIntervalMs = 10_000;

const retrySecondsSchema = z.string().regex(/^\d+$/u);
const retryDateSchema = z
  .string()
  .regex(/^[A-Za-z]{3}, \d{2} [A-Za-z]{3} \d{4} \d{2}:\d{2}:\d{2} GMT$/u);

export function channelPollFailure(
  failure: ChannelAuthorizationError,
  failures: number,
  now: number,
  expiresAt: number
) {
  if (now >= expiresAt)
    return { status: "expired" as const, failures, delay: 0 };
  if (failure.category === "terminal")
    return { status: "invalid" as const, failures, delay: 0 };
  const nextFailures =
    failure.category === "transient" ? failures + 1 : failures;
  if (nextFailures >= 5)
    return { status: "invalid" as const, failures: nextFailures, delay: 0 };
  const header = failure.retryAfter;
  const retryAfter =
    header === null
      ? Number.NaN
      : isValid(retrySecondsSchema, header)
        ? Math.min(Number(header) * 1000, expiresAt - now)
        : isValid(retryDateSchema, header)
          ? Date.parse(header) - now
          : Number.NaN;
  const fallback =
    failure.category === "rate-limit"
      ? 30_000
      : Math.min(2000 * 2 ** nextFailures, 30_000);
  const delay = Math.max(
    2000,
    Number.isFinite(retryAfter) ? retryAfter : fallback
  );
  return {
    status: "pending" as const,
    failures: nextFailures,
    delay: Math.min(delay, expiresAt - now),
  };
}

async function requestJson<A>(
  path: string,
  init: RequestInit,
  responseSchema: z.ZodType<A>,
  signal?: AbortSignal
): Promise<A> {
  const deadline = AbortSignal.timeout(10_000);
  try {
    const response = await fetch(`/api/auth/channel-auth/${path}`, {
      ...init,
      cache: "no-store",
      credentials: "same-origin",
      redirect: "error",
      signal: signal ? AbortSignal.any([signal, deadline]) : deadline,
    });
    if (!response.ok)
      throw channelHttpError(
        response.status,
        response.headers.get("Retry-After") ??
          response.headers.get("X-Retry-After")
      );
    const parsed = jsonString(responseSchema).safeParse(await response.text());
    if (!parsed.success) throw invalidChannelChallenge(response.status);
    return parsed.data;
  } catch (error) {
    if (error instanceof ChannelAuthorizationError) throw error;
    throw channelHttpError(0);
  }
}

export const startChannelAuthorization = async function (
  channel: z.output<typeof channelProviderSchema>,
  purpose: z.output<typeof channelChallengeRequestSchema>["purpose"],
  signal?: AbortSignal
) {
  const intent = await Promise.try(async () =>
    channelChallengeRequestSchema.parseAsync({
      channel,
      purpose,
    })
  ).catch(() => {
    throw channelHttpError(400);
  });
  const challenge = await requestJson(
    "start",
    {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(intent),
    },
    channelStartResultSchema,
    signal
  );
  if (challenge.channel !== channel) throw invalidChannelChallenge(200);
  return challenge;
};

export const checkChannelAuthorization = async function (
  id: string,
  signal?: AbortSignal
) {
  const input = await Promise.try(async () =>
    channelChallengeIdSchema.parseAsync({
      id,
    })
  ).catch(() => {
    throw channelHttpError(400);
  });
  return await requestJson(
    `status?id=${encodeURIComponent(input.id)}`,
    { method: "GET" },
    channelChallengeStatusSchema,
    signal
  );
};

export const completeChannelAuthorization = async function (
  id: string,
  signal?: AbortSignal
) {
  const input = await Promise.try(async () =>
    channelChallengeIdSchema.parseAsync({
      id,
    })
  ).catch(() => {
    throw channelHttpError(400);
  });
  await requestJson(
    "complete",
    {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(input),
    },
    channelChallengeCompletionSchema,
    signal
  );
};

export function channelFailureMessage(
  failure: ChannelAuthorizationError,
  purpose: z.output<typeof channelChallengeRequestSchema>["purpose"]
) {
  if (failure.status === 412)
    return "Esta conta tem conexões, cofre ou acesso a equipes. A vinculação precisa de uma revisão para preservar esses acessos.";
  if (failure.status === 423)
    return "Aguarde as entregas em andamento terminarem e tente novamente.";
  if (purpose === "login") return failure.message;
  if (failure.status === 401)
    return "Sign in again before linking another channel, then return to Account to start a new request.";
  if (failure.status === 409)
    return "Este mensageiro já pertence a outra conta Zoen. Você pode preservar essa conta como arquivo e usar a conta atual para novas conversas.";
  if (failure.category === "terminal")
    return "This account-linking request could not be verified. Start a new request and confirm it in the messenger account you want to link.";
  return failure.message;
}

export const bindNativeBrowser = async function (
  input: z.output<typeof deviceBindingSchema>,
  signal?: AbortSignal
) {
  const body = await Promise.try(async () =>
    deviceBindingSchema.parseAsync(input)
  ).catch(() => {
    throw channelHttpError(400);
  });
  return await requestJson(
    "device-bind",
    {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(body),
    },
    deviceBoundSchema,
    signal
  );
};

export const resumeNativeBrowser = (
  input: z.output<typeof deviceRequestSchema>,
  signal?: AbortSignal
) =>
  requestJson(
    `device?id=${encodeURIComponent(input.id)}&purpose=${input.purpose}`,
    { method: "GET" },
    deviceBoundSchema,
    signal
  );
