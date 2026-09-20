import { withSignal } from "../../../server/operations/async";
import { AuthUnavailable } from "../../../db/services/auth/index";
import { GoogleWorkspaceError } from "../../../server/google-workspace/index";
import { isValid } from "@shared/validation";
import { z } from "zod";
import { auth } from "@googleapis/gmail";
import {
  ConnectionAuthorizationFailedError,
  ConnectionAuthorizationRequiredError,
  defineInteractiveAuthorization,
  type ConnectionPrincipal,
} from "eve/connections";
import type { SessionAuthContext } from "eve/context";
import type { ToolContext } from "eve/tools";
import { scopeFromPrincipal } from "../../../shared/identity/principal-scope";
import { getGoogleWorkspaceToken } from "../../../server/google-workspace";
import { createGoogleWorkspaceChallenge } from "../../../server/google-workspace/challenge";
import { accessScopeForUser } from "../../../shared/identity/access-scope";
import { workspaceActorFromPrincipal } from "../../../server/workspaces/access";
import { getWorkspaceGoogleToken } from "../../../server/workspaces/connections";
import { readWorkspaceCapabilities } from "../../../server/workspaces/capabilities";
function googleScope(principal: ConnectionPrincipal) {
  if (principal.type !== "user")
    throw new ConnectionAuthorizationFailedError("google-workspace", {
      reason: "principal_required",
      retryable: false,
    });
  return scopeFromPrincipal(principal);
}

/** Project Eve's connection principal into the live-authority SessionAuth shape. */
function liveGoogleConsentPrincipal(
  principal: ConnectionPrincipal
): SessionAuthContext {
  if (principal.type !== "user")
    throw new ConnectionAuthorizationFailedError("google-workspace", {
      reason: "principal_required",
      retryable: false,
    });
  return {
    attributes: principal.attributes ?? {},
    // Eve stores the session authenticator on issuer when no IdP issuer is set.
    authenticator: principal.issuer ?? "unknown",
    principalId: principal.id,
    principalType: "user",
  };
}
async function readToken(principal: ConnectionPrincipal) {
  try {
    try {
      const secret = await getGoogleWorkspaceToken(googleScope(principal));
      return secret.reveal();
    } catch (error) {
      if (error instanceof GoogleWorkspaceError)
        throw error.reason === "authorization_required"
          ? new ConnectionAuthorizationRequiredError("google-workspace")
          : new ConnectionAuthorizationFailedError("google-workspace", {
              reason: error.reason,
              retryable: false,
            });
      throw error;
    }
  } catch (error) {
    if (error instanceof AuthUnavailable)
      throw new ConnectionAuthorizationFailedError("google-workspace", {
        reason: "unavailable",
        retryable: false,
      });
    throw error;
  }
}
const googleWorkspaceAuth = defineInteractiveAuthorization({
  getToken: ({ principal }) => readToken(principal),
  async startAuthorization({ principal, callbackUrl }) {
    const url = await Promise.try(async () =>
      createGoogleWorkspaceChallenge(
        liveGoogleConsentPrincipal(principal),
        callbackUrl
      )
    ).catch((error: unknown) => {
      if (error instanceof GoogleWorkspaceError)
        throw new ConnectionAuthorizationFailedError("google-workspace", {
          reason: error.reason,
          retryable: false,
        });
      throw error;
    });
    return {
      challenge: {
        url,
        displayName: "Google Workspace",
      },
    };
  },
  completeAuthorization({ principal, callback }) {
    if (callback.params.error)
      throw new ConnectionAuthorizationFailedError("google-workspace", {
        reason: "authorization_denied",
        retryable: false,
      });
    return readToken(principal);
  },
});
class GoogleApiError extends Error {
  readonly _tag = "GoogleApiError";
  declare readonly status?: number | undefined;
  constructor(input: { readonly status?: number | undefined }) {
    super("GoogleApiError");
    this.name = "GoogleApiError";
    Object.assign(this, input);
  }
}
const googleApiErrorSchema = z.object({
  response: z.object({
    status: z.number().int().min(100).max(599),
  }),
});
export function googleApiErrorStatus(cause: unknown) {
  return isValid(googleApiErrorSchema, cause)
    ? cause.response.status
    : undefined;
}
export function googleApiFailure(cause: unknown) {
  return new GoogleApiError({
    status: googleApiErrorStatus(cause),
  });
}
export async function withGoogleAuth<T>(
  ctx: ToolContext,
  execute: (authClient: InstanceType<typeof auth.OAuth2>) => Promise<T>
) {
  const principal = ctx.session.auth.current;
  const isCompany =
    principal?.principalType === "user" &&
    principal.attributes.workspaceId !==
      accessScopeForUser(principal.principalId).workspaceId;
  const { token } = isCompany
    ? await withSignal(ctx.abortSignal, async () => {
        const actor = await workspaceActorFromPrincipal(principal);
        if (
          actor.agentGrantId ||
          actor.groupBindingId ||
          !(await readWorkspaceCapabilities(actor)).enabled.includes("google")
        )
          throw new ConnectionAuthorizationFailedError("google-workspace", {
            reason: "permission_denied",
            retryable: false,
          });
        return (await getWorkspaceGoogleToken(actor)).reveal();
      })
    : await ctx.getToken(googleWorkspaceAuth);
  const authClient = new auth.OAuth2();
  authClient.setCredentials({
    access_token: token,
  });
  return withSignal(ctx.abortSignal, async () => {
    try {
      try {
        return await execute(authClient);
      } catch (error) {
        throw googleApiFailure(error);
      }
    } catch (error) {
      if (error instanceof GoogleApiError)
        return ((cause) => {
          if (cause.status === 401) return ctx.requireAuth(googleWorkspaceAuth);
          throw cause;
        })(error);
      throw error;
    }
  });
}
