import { Secret } from "@shared/environment/secret";
import { withTimeout } from "../operations/async";
import { TimeoutError } from "../operations/async";
import { z } from "zod";
import { createHash, createHmac, timingSafeEqual } from "node:crypto";
import { resolvedInstallationSecrets } from "@db/services/installation-secrets";
import { env } from "@shared/environment/env";
import { BodyTooLarge, readBody } from "../http/body";
import { routeAuth, vercelOidc } from "eve/channels/auth";
export const internalCallbackBodies = {
  "/internal/channel-input/respond": z.object({
    sessionId: z.string().min(1).max(256),
    identityId: z.uuid(),
    sourceMessageId: z.string().min(1).max(256),
    turnId: z.string().min(1).max(256),
    requestId: z.string().min(1).max(256),
    decision: z.enum(["approve", "cancel"]),
  }),
  "/internal/scheduled-run/report": z.object({
    runId: z.uuid(),
  }),
  "/internal/scheduled-run/respond": z.object({
    answer: z
      .string()
      .refine((value) => value === value.trim(), "Expected trimmed text")
      .min(1)
      .max(8000),
    leaseToken: z.uuid(),
    runId: z.uuid(),
  }),
};
export type InternalCallbackRoute = keyof typeof internalCallbackBodies;
export class InternalCallbackRejected extends Error {
  readonly _tag = "InternalCallbackRejected";
  declare readonly status: 400 | 401 | 408 | 413 | 503;
  constructor(input: { readonly status: 400 | 401 | 408 | 413 | 503 }) {
    super("InternalCallbackRejected");
    this.name = "InternalCallbackRejected";
    Object.assign(this, input);
  }
}
function reject(status: InternalCallbackRejected["status"]): never {
  throw new InternalCallbackRejected({
    status,
  });
}
const originSchema = z.string().refine((value) => {
  if (!URL.canParse(value)) return false;
  const url = new URL(value);
  return (
    !url.username &&
    !url.password &&
    (url.protocol === "https:" ||
      (url.protocol === "http:" &&
        ["localhost", "127.0.0.1", "[::1]"].includes(url.hostname)))
  );
});
export function internalCallbackOrigin() {
  const value = originSchema.safeParse(env.BETTER_AUTH_URL);
  if (!value.success)
    throw new InternalCallbackRejected({
      status: 503,
    });
  return new URL(value.data).origin;
}
const callbackKey = async () => {
  try {
    const installation = await resolvedInstallationSecrets();
    const secret = await z
      .string()
      .refine((value) => z.base64().safeParse(value).success, "Expected base64")
      .refine((value) => Buffer.from(value, "base64").length === 32)
      .parseAsync(installation.secretEncryptionKey.reveal());
    return new Secret(
      createHmac("sha256", Buffer.from(secret, "base64"))
        .update("companion/internal-callback/v1")
        .digest()
    );
  } catch {
    return reject(503);
  }
};
function signature(
  key: Secret<Buffer>,
  origin: string,
  route: InternalCallbackRoute,
  timestamp: string,
  body: Uint8Array
) {
  return createHmac("sha256", key.reveal())
    .update(
      JSON.stringify([
        "v1",
        origin,
        "POST",
        route,
        timestamp,
        createHash("sha256").update(body).digest("hex"),
      ])
    )
    .digest();
}
export const internalCallbackHeaders = async function (
  route: InternalCallbackRoute,
  body: string
) {
  const origin = internalCallbackOrigin();
  const key = await callbackKey();
  const timestamp = String(Math.floor(Date.now() / 1000));
  return new Headers({
    "content-type": "application/json",
    "x-internal-callback-time": timestamp,
    "x-internal-callback-signature": signature(
      key,
      origin,
      route,
      timestamp,
      Buffer.from(body)
    ).toString("hex"),
  });
};
async function readInternalCallbackBody(request: Request) {
  if (!request.body)
    throw new InternalCallbackRejected({
      status: 400,
    });
  try {
    return await withTimeout(() => readBody(request.body, 64 * 1024), 5_000);
  } catch (error) {
    throw new InternalCallbackRejected({
      status:
        error instanceof TimeoutError
          ? 408
          : error instanceof BodyTooLarge
            ? 413
            : 400,
    });
  }
}
export const readVerifiedInternalCallback = async function (
  request: Request,
  route: InternalCallbackRoute
) {
  const origin = internalCallbackOrigin();
  const key = await callbackKey();
  const url = new URL(request.url);
  if (request.method !== "POST" || url.pathname !== route || url.search)
    return reject(401);
  const timestamp = await Promise.try(async () =>
    z
      .string()
      .regex(/^\d{10}$/u)
      .parseAsync(request.headers.get("x-internal-callback-time"))
  ).catch(() => {
    return reject(401);
  });
  const age = Math.floor(Date.now() / 1000) - Number(timestamp);
  if (age < -5 || age > 60) return reject(401);
  const encoded = await Promise.try(async () =>
    z
      .string()
      .regex(/^[a-f0-9]{64}$/u)
      .parseAsync(request.headers.get("x-internal-callback-signature"))
  ).catch(() => {
    return reject(401);
  });
  const body = await readInternalCallbackBody(request);
  const expected = signature(key, origin, route, timestamp, body);
  if (!timingSafeEqual(Buffer.from(encoded, "hex"), expected))
    return reject(401);
  // Authentication is time-bounded, not single-use. The existing run/report claim fences dispatch.
  return body;
};
export async function readAuthenticatedInternalCallback(
  request: Request,
  route: InternalCallbackRoute
) {
  if (env.VERCEL_ENV) {
    let auth: Awaited<ReturnType<typeof routeAuth>>;
    try {
      auth = await routeAuth(request, [vercelOidc()]);
    } catch {
      throw new InternalCallbackRejected({
        status: 503,
      });
    }
    if (auth instanceof Response) return auth;
    return readInternalCallbackBody(request);
  }
  return readVerifiedInternalCallback(request, route);
}
