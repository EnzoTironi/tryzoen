import type { z } from "zod";
import { env } from "@shared/environment/env";
import { operationSignal, withTimeout } from "../../server/operations/async";
import { getVercelOidcToken } from "@vercel/oidc";
import {
  InternalCallbackRejected,
  internalCallbackBodies,
  internalCallbackHeaders,
  internalCallbackOrigin,
  type InternalCallbackRoute,
} from "../../server/internal/callback-auth";

export async function postInternalRequest<Route extends InternalCallbackRoute>(
  route: Route,
  body: z.input<(typeof internalCallbackBodies)[Route]>
) {
  const value = internalCallbackBodies[route].strict().parse(body);
  const serialized = JSON.stringify(value);
  let origin: string;
  let headers: Headers;
  if (env.VERCEL_ENV) {
    if (!env.VERCEL_URL) throw new InternalCallbackRejected({ status: 503 });
    origin = new URL(`https://${env.VERCEL_URL}`).origin;
    let token: string;
    try {
      token = await getVercelOidcToken();
    } catch {
      throw new InternalCallbackRejected({ status: 503 });
    }
    headers = new Headers({
      "content-type": "application/json",
      authorization: `Bearer ${token}`,
      "x-vercel-trusted-oidc-idp-token": token,
    });
  } else {
    origin = internalCallbackOrigin();
    headers = await internalCallbackHeaders(route, serialized);
  }
  try {
    return await withTimeout(
      () =>
        fetch(new URL(route, origin), {
          body: serialized,
          headers,
          method: "POST",
          redirect: "error",
          signal: operationSignal(),
        }),
      10_000
    );
  } catch {
    throw new InternalCallbackRejected({ status: 503 });
  }
}
