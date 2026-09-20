import { withTimeout } from "../operations/async";
import { TimeoutError } from "../operations/async";
import { jsonString } from "@shared/validation";
import { z } from "zod";
import { readBody } from "../http/body";
import { operationSignal } from "../operations/async";

const provider = z.enum(["telegram", "kapso"]);

export class ProviderInputError extends Error {
  readonly _tag = "ProviderInputError";
  declare readonly provider: z.output<typeof provider>;
  declare readonly reason:
    | "malformed"
    | "configuration"
    | "wrong_installation"
    | "unsupported_identity"
    | "invalid_command"
    | "invalid_target"
    | "stale_event"
    | "future_event";
  constructor(input: {
    readonly provider: z.output<typeof provider>;
    readonly reason:
      | "malformed"
      | "configuration"
      | "wrong_installation"
      | "unsupported_identity"
      | "invalid_command"
      | "invalid_target"
      | "stale_event"
      | "future_event";
  }) {
    super("ProviderInputError");
    this.name = "ProviderInputError";
    Object.assign(this, input);
  }
}

export class ProviderRejected extends Error {
  readonly _tag = "ProviderRejected";
  declare readonly provider: z.output<typeof provider>;
  declare readonly status: number;
  constructor(input: {
    readonly provider: z.output<typeof provider>;
    readonly status: number;
  }) {
    super("ProviderRejected");
    this.name = "ProviderRejected";
    Object.assign(this, input);
  }
}

/** Definite rate-limit / flood-control rejection; safe to reschedule the same delivery. */
export class ProviderRetryable extends Error {
  readonly _tag = "ProviderRetryable";
  declare readonly provider: z.output<typeof provider>;
  declare readonly status: number;
  declare readonly retryAfterSeconds: number;
  constructor(input: {
    readonly provider: z.output<typeof provider>;
    readonly status: number;
    readonly retryAfterSeconds: number;
  }) {
    super("ProviderRetryable");
    this.name = "ProviderRetryable";
    Object.assign(this, input);
  }
}

// No request, response body, URL, token or raw exception may enter these errors.
export class ProviderUncertain extends Error {
  readonly _tag = "ProviderUncertain";
  declare readonly provider: z.output<typeof provider>;
  declare readonly reason:
    | "transport"
    | "server_error"
    | "unexpected_status"
    | "malformed_receipt";
  constructor(input: {
    readonly provider: z.output<typeof provider>;
    readonly reason:
      | "transport"
      | "server_error"
      | "unexpected_status"
      | "malformed_receipt";
  }) {
    super("ProviderUncertain");
    this.name = "ProviderUncertain";
    Object.assign(this, input);
  }
}

export const DEFAULT_RETRY_AFTER_SECONDS = 30;
export const MAX_RETRY_AFTER_SECONDS = 3_600;

/** Clamp provider delay into a bounded positive second count. */
export const boundRetryAfterSeconds = (raw: number | undefined): number => {
  if (raw === undefined || !Number.isFinite(raw) || raw < 1) {
    return DEFAULT_RETRY_AFTER_SECONDS;
  }
  return Math.min(Math.floor(raw), MAX_RETRY_AFTER_SECONDS);
};

/** Parse Retry-After as delta-seconds or HTTP-date; undefined when absent/malformed. */
export const parseRetryAfterHeader = (
  value: string | undefined
): number | undefined => {
  if (value === undefined) return undefined;
  const trimmed = value.trim();
  if (trimmed.length === 0 || trimmed.length > 64) return undefined;
  if (/^\d+$/u.test(trimmed)) {
    const seconds = Number(trimmed);
    return Number.isSafeInteger(seconds) ? seconds : undefined;
  }
  const millis = Date.parse(trimmed);
  if (Number.isNaN(millis)) return undefined;
  return Math.ceil((millis - Date.now()) / 1_000);
};

const telegramRetryAfterSchema = z.object({
  parameters: z.optional(
    z.object({
      retry_after: z.optional(z.number()),
    })
  ),
});

async function readReceipt(
  response: Response,
  channel: z.output<typeof provider>
) {
  try {
    return await readBody(response.body, 65_536);
  } catch {
    throw new ProviderUncertain({
      provider: channel,
      reason: "malformed_receipt",
    });
  }
}

async function retryAfter(
  response: Response,
  channel: z.output<typeof provider>
) {
  const header = parseRetryAfterHeader(
    response.headers.get("retry-after") ?? undefined
  );
  if (header !== undefined) return boundRetryAfterSeconds(header);
  try {
    const body = await readReceipt(response, channel);
    const value = jsonString(telegramRetryAfterSchema).safeParse(
      body.toString("utf8")
    );
    return boundRetryAfterSeconds(
      value.success ? value.data.parameters?.retry_after : undefined
    );
  } catch {
    return DEFAULT_RETRY_AFTER_SECONDS;
  }
}

// Sending is never retried here: even a transport failure may follow a successful action.
// A definite 429 rejection is rescheduled by the outbox using the provider's delay.
export async function requestProviderJson(
  channel: z.output<typeof provider>,
  url: string,
  init: RequestInit = {}
) {
  try {
    return await withTimeout(async () => {
      let response: Response;
      try {
        response = await fetch(url, {
          ...init,
          redirect: "error",
          signal: operationSignal(),
        });
      } catch {
        throw new ProviderUncertain({ provider: channel, reason: "transport" });
      }
      try {
        if (response.status === 429) {
          throw new ProviderRetryable({
            provider: channel,
            status: 429,
            retryAfterSeconds: await retryAfter(response, channel),
          });
        }
        if (
          response.status >= 400 &&
          response.status < 500 &&
          response.status !== 408
        ) {
          throw new ProviderRejected({
            provider: channel,
            status: response.status,
          });
        }
        if (!response.ok) {
          throw new ProviderUncertain({
            provider: channel,
            reason:
              response.status >= 500 ? "server_error" : "unexpected_status",
          });
        }
        const body = await readReceipt(response, channel);
        const result = jsonString(z.json()).safeParse(body.toString("utf8"));
        if (!result.success)
          throw new ProviderUncertain({
            provider: channel,
            reason: "malformed_receipt",
          });
        return result.data;
      } finally {
        void response.body?.cancel().catch(() => {
          /* Closing an already cancelled stream needs no recovery. */
        });
      }
    }, 15_000);
  } catch (error) {
    if (error instanceof TimeoutError)
      throw new ProviderUncertain({ provider: channel, reason: "transport" });
    throw error;
  }
}
