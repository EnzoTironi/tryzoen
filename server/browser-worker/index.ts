import { SqlError } from "../../db/queries";
import { isValid } from "@shared/validation";
import { z } from "zod";

import type { SessionAuthContext } from "eve/context";
import { channelProviderSchema } from "../../shared/identity/channel-auth";
import { accessScopeForUser } from "../../shared/identity/access-scope";
import { scopeFromPrincipal } from "../../shared/identity/principal-scope";
import { workspaceActorFromPrincipal } from "../workspaces/access";
import {
  BrowserWorkerAccessError,
  requireBrowserWorkerChannelIdentity,
  requireBrowserWorkerLease,
  requireBrowserWorkerMembership,
  requireBrowserWorkerScheduleActive,
  requireBrowserWorkerWebSession,
} from "./access";

const identifier = z
  .string()
  .min(1)
  .refine((value) => value === value.trim(), "Expected trimmed text");

const authorize = async function (principal: SessionAuthContext) {
  try {
    if (principal.principalType !== "user")
      throw new BrowserWorkerAccessError({
        reason: "unauthenticated",
      });
    const scope = await Promise.try(async () =>
      scopeFromPrincipal(principal)
    ).catch(() => {
      throw new BrowserWorkerAccessError({ reason: "unauthenticated" });
    });
    const canonical = accessScopeForUser(scope.userId);
    if (
      canonical.workspaceId !== scope.workspaceId &&
      principal.attributes.workspaceKind !== "company"
    )
      throw new BrowserWorkerAccessError({
        reason: "unauthenticated",
      });
    if (canonical.workspaceId !== scope.workspaceId) {
      await Promise.try(async () =>
        workspaceActorFromPrincipal(principal)
      ).catch(() => {
        throw new BrowserWorkerAccessError({ reason: "unauthenticated" });
      });
    }

    if (principal.authenticator === "scheduled-worker") {
      const runId = await Promise.try(async () =>
        identifier.parseAsync(principal.attributes.scheduledRunId)
      ).catch(() => {
        throw new BrowserWorkerAccessError({ reason: "lease_inactive" });
      });
      const leaseToken = await Promise.try(async () =>
        identifier.parseAsync(principal.attributes.scheduledRunLeaseToken)
      ).catch(() => {
        throw new BrowserWorkerAccessError({ reason: "lease_inactive" });
      });
      await requireBrowserWorkerLease(scope, runId, leaseToken);
      const scheduleId = principal.attributes.scheduleId;
      if (scheduleId !== undefined) {
        const id = await Promise.try(async () =>
          identifier.parseAsync(scheduleId)
        ).catch(() => {
          throw new BrowserWorkerAccessError({ reason: "paused" });
        });
        await requireBrowserWorkerScheduleActive(scope, id);
      }
    }

    if (
      principal.authenticator === "verified-channel" ||
      isValid(channelProviderSchema, principal.attributes.conversationChannel)
    ) {
      const identityId = await Promise.try(async () =>
        z.uuid().parseAsync(principal.attributes.channelIdentityId)
      ).catch(() => {
        throw new BrowserWorkerAccessError({ reason: "revoked" });
      });
      await requireBrowserWorkerChannelIdentity(scope, identityId);
    } else if (principal.authenticator === "authjs") {
      const sessionId = await Promise.try(async () =>
        identifier.parseAsync(principal.attributes.authSessionId)
      ).catch(() => {
        throw new BrowserWorkerAccessError({ reason: "unauthenticated" });
      });
      await requireBrowserWorkerWebSession(scope, sessionId);
    } else if (principal.authenticator !== "scheduled-worker") {
      await requireBrowserWorkerMembership(scope);
    }

    return scope;
  } catch (error) {
    if (error instanceof SqlError) {
      throw new BrowserWorkerAccessError({ reason: "unavailable" });
    }
    throw error;
  }
};

export const BrowserWorkerAccess = {
  authorize: (principal: SessionAuthContext) => authorize(principal),
};
