import { z } from "zod";
import { symmetricDecodeJWT, symmetricEncodeJWT } from "better-auth/crypto";

import type { SessionAuthContext } from "eve/context";
import { resolvedInstallationSecrets } from "@db/services/installation-secrets";
import { applicationOrigin } from "@shared/environment/origin";
import { BrowserWorkerAccess } from "../browser-worker";
import { BrowserWorkerAccessError } from "../browser-worker/access";
import { GoogleWorkspaceError, googleWorkspaceUserId } from "./index";

const purpose = "companion-google-workspace-link";
const flowSchema = z.object({
  userId: z.string().min(1),
  callbackURL: z.string(),
});

function denyWithoutLiveAuthority(error: unknown) {
  return new GoogleWorkspaceError({
    reason:
      !(error instanceof BrowserWorkerAccessError) ||
      error.reason === "unavailable"
        ? "unavailable"
        : "unauthenticated",
  });
}

export const validateGoogleCallback = async function (
  callbackURL: string,
  origin: string
) {
  const url = await Promise.try(async () => new URL(callbackURL)).catch(() => {
    throw new GoogleWorkspaceError({ reason: "invalid_callback" });
  });
  if (
    url.origin !== origin ||
    url.username ||
    url.password ||
    url.hash ||
    !/^\/eve\/v1\/connections\/[^/]+\/callback\/[^/]+\/[^/]+$/u.test(
      url.pathname
    )
  ) {
    throw new GoogleWorkspaceError({ reason: "invalid_callback" });
  }
  return url.href;
};

/**
 * Issues a native Google consent handoff only when the caller still has live
 * delegated authority (channel/web/schedule), not workspace ownership alone.
 */
export const createGoogleWorkspaceChallenge = async function (
  principal: SessionAuthContext,
  callbackUrl: string
) {
  const access = BrowserWorkerAccess;
  const scope = await Promise.try(async () =>
    access.authorize(principal)
  ).catch((error: unknown) => {
    throw denyWithoutLiveAuthority(error);
  });
  const userId = await googleWorkspaceUserId(scope);
  const callbackURL = await validateGoogleCallback(
    callbackUrl,
    applicationOrigin()
  );
  const secrets = await resolvedInstallationSecrets();
  const flow = await Promise.try(async () =>
    symmetricEncodeJWT(
      { userId, callbackURL },
      secrets.betterAuthSecret.reveal(),
      purpose,
      600
    )
  ).catch(() => {
    throw new GoogleWorkspaceError({ reason: "unavailable" });
  });
  const url = new URL("/api/google-workspace/connect", applicationOrigin());
  url.searchParams.set("flow", flow);
  return url.href;
};

export const readGoogleWorkspaceChallenge = async function (
  flow: string,
  userId: string
) {
  const secrets = await resolvedInstallationSecrets();
  const payload = await Promise.try(async () =>
    symmetricDecodeJWT<unknown>(
      flow,
      secrets.betterAuthSecret.reveal(),
      purpose
    )
  ).catch(() => {
    throw new GoogleWorkspaceError({ reason: "invalid_callback" });
  });
  const decoded = await Promise.try(async () =>
    flowSchema.parseAsync(payload)
  ).catch(() => {
    throw new GoogleWorkspaceError({ reason: "invalid_callback" });
  });
  if (decoded.userId !== userId)
    throw new GoogleWorkspaceError({ reason: "unauthenticated" });
  return await validateGoogleCallback(decoded.callbackURL, applicationOrigin());
};
