import { readBody, BodyTooLarge } from "../http/body";
import type { Secret } from "@shared/environment/secret";
import { withTimeout } from "../operations/async";
import { TimeoutError } from "../operations/async";
import { jsonString } from "@shared/validation";
import { z } from "zod";
import { createHmac, timingSafeEqual } from "node:crypto";

import type { channelProviderSchema } from "@shared/identity/channel-auth";

const maximumBodyBytes = 256 * 1024;

export class WebhookRejected extends Error {
  readonly _tag = "WebhookRejected";
  declare readonly status: 400 | 401 | 413 | 408;
  constructor(input: { readonly status: 400 | 401 | 413 | 408 }) {
    super("WebhookRejected");
    this.name = "WebhookRejected";
    Object.assign(this, input);
  }
}

const matchesSecret = (received: string, expected: string) => {
  const left = Buffer.from(received);
  const right = Buffer.from(expected);
  return (
    right.length > 0 &&
    left.length === right.length &&
    timingSafeEqual(left, right)
  );
};

export const readVerifiedWebhook = async function (
  request: Request,
  channel: z.output<typeof channelProviderSchema>,
  secret: Secret
) {
  if (secret.reveal().length === 0) {
    throw new WebhookRejected({ status: 401 });
  }
  if (
    channel === "telegram" &&
    !matchesSecret(
      request.headers.get("x-telegram-bot-api-secret-token") ?? "",
      secret.reveal()
    )
  ) {
    throw new WebhookRejected({ status: 401 });
  }

  const source = request.body;
  if (!source) throw new WebhookRejected({ status: 400 });
  let body: Buffer;
  try {
    body = await withTimeout(() => readBody(source, maximumBodyBytes), 5_000);
  } catch (error) {
    throw new WebhookRejected({
      status:
        error instanceof TimeoutError
          ? 408
          : error instanceof BodyTooLarge
            ? 413
            : 400,
    });
  }

  if (
    channel === "kapso" &&
    !matchesSecret(
      request.headers.get("x-webhook-signature") ?? "",
      createHmac("sha256", secret.reveal()).update(body).digest("hex")
    )
  ) {
    throw new WebhookRejected({ status: 401 });
  }

  try {
    return await jsonString(z.json()).parseAsync(body.toString("utf8"));
  } catch {
    throw new WebhookRejected({ status: 400 });
  }
};
