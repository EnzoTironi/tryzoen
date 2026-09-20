import { Secret } from "@shared/environment/secret";
import { query } from "@db/queries";
import { sql } from "drizzle-orm";
import { ZodError as SchemaError } from "zod";
import { SqlError } from "../../db/queries";
import { isValid } from "@shared/validation";
import { z } from "zod";
import { auth as google } from "@googleapis/gmail";
import { symmetricDecrypt } from "better-auth/crypto";
import { getAuth } from "@db/services/auth";
import { env } from "@shared/environment";
import { applicationOrigin } from "@shared/environment/origin";
import { googleWorkspaceScopes } from "@shared/google-workspace/connection";
import {
  accessScopeForUser,
  type AccessScope,
} from "@shared/identity/access-scope";
export class GoogleWorkspaceError extends Error {
  readonly _tag = "GoogleWorkspaceError";
  declare readonly reason:
    | "unconfigured"
    | "unauthenticated"
    | "authorization_required"
    | "unavailable"
    | "invalid_callback";
  constructor(input: {
    readonly reason:
      | "unconfigured"
      | "unauthenticated"
      | "authorization_required"
      | "unavailable"
      | "invalid_callback";
  }) {
    super("GoogleWorkspaceError");
    this.name = "GoogleWorkspaceError";
    Object.assign(this, input);
  }
}
export const googleWorkspaceUserId = async function (scope: AccessScope) {
  if (
    !scope.userId.startsWith("better-auth:") ||
    !scope.userId.slice(12).trim() ||
    accessScopeForUser(scope.userId).workspaceId !== scope.workspaceId
  ) {
    throw new GoogleWorkspaceError({
      reason: "unauthenticated",
    });
  }
  return scope.userId.slice(12);
};
export const requireGoogleWorkspaceMembership = async function (
  scope: AccessScope
) {
  try {
    const userId = await googleWorkspaceUserId(scope);
    const rows = await query(
      sql`SELECT 1 FROM workspace_memberships WHERE user_id = ${scope.userId} AND workspace_id = ${scope.workspaceId}`
    );
    if (rows.length !== 1)
      throw new GoogleWorkspaceError({
        reason: "unauthenticated",
      });
    return userId;
  } catch (error) {
    if (error instanceof SqlError) {
      throw new GoogleWorkspaceError({
        reason: "unavailable",
      });
    }
    throw error;
  }
};
const requireConfiguration = async function () {
  if (!env.GOOGLE_CLIENT_ID || !env.GOOGLE_CLIENT_SECRET) {
    throw new GoogleWorkspaceError({
      reason: "unconfigured",
    });
  }
};
const accountSchema = z.object({
  id: z.string(),
  scope: z.nullable(z.string()),
  hasToken: z.boolean(),
});
const findAccount = async function (scope: AccessScope) {
  try {
    const userId = await googleWorkspaceUserId(scope);
    const rows = await query(sql`
    SELECT a.id, a.scope, (a."accessToken" IS NOT NULL OR a."refreshToken" IS NOT NULL) AS "hasToken"
    FROM account a
    INNER JOIN workspace_memberships m ON m.user_id = ${scope.userId} AND m.workspace_id = ${scope.workspaceId}
    WHERE a."userId" = ${userId} AND a."providerId" = 'google'
      AND a.issuer = 'https://accounts.google.com'
      AND a.scope ~ '(^|[ ,])https://www.googleapis.com/auth/'
      ORDER BY a."createdAt", a.id LIMIT 2`);
    const accounts = await z.array(accountSchema).parseAsync(rows);
    if (accounts.length > 1)
      throw new GoogleWorkspaceError({
        reason: "unavailable",
      });
    return accounts[0];
  } catch (error) {
    if (error instanceof SqlError || error instanceof SchemaError) {
      throw new GoogleWorkspaceError({
        reason: "unavailable",
      });
    }
    throw error;
  }
};
export function hasGoogleWorkspaceScopes(scope: string | null) {
  const granted = new Set(scope?.split(/[ ,]+/u));
  return googleWorkspaceScopes
    .filter((required) =>
      required.startsWith("https://www.googleapis.com/auth/")
    )
    .every((required) => granted.has(required));
}
export const readGoogleWorkspaceConnection = async function (
  scope: AccessScope
) {
  await googleWorkspaceUserId(scope);
  if (!env.GOOGLE_CLIENT_ID || !env.GOOGLE_CLIENT_SECRET)
    return {
      state: "unavailable" as const,
    };
  const account = await findAccount(scope);
  return {
    state:
      account?.hasToken && hasGoogleWorkspaceScopes(account.scope)
        ? ("connected" as const)
        : ("disconnected" as const),
  };
};
export const getGoogleWorkspaceToken = async function (scope: AccessScope) {
  await requireConfiguration();
  const userId = await googleWorkspaceUserId(scope);
  const account = await findAccount(scope);
  if (!account?.hasToken || !hasGoogleWorkspaceScopes(account.scope))
    throw new GoogleWorkspaceError({
      reason: "authorization_required",
    });
  const auth = await getAuth();
  const result = await Promise.try(
    async () =>
      new Secret(
        await auth.api.getAccessToken({
          body: {
            accountId: account.id,
            userId,
          },
        })
      )
  ).catch(() => {
    throw new GoogleWorkspaceError({
      reason: "authorization_required",
    });
  });
  const current = await findAccount(scope);
  if (
    current?.id !== account.id ||
    !current.hasToken ||
    !hasGoogleWorkspaceScopes(current.scope)
  ) {
    throw new GoogleWorkspaceError({
      reason: "authorization_required",
    });
  }
  const token = result.reveal();
  const now = new Date();
  if (
    !token.accessToken ||
    (token.accessTokenExpiresAt &&
      token.accessTokenExpiresAt.getTime() <= now.getTime())
  )
    throw new GoogleWorkspaceError({
      reason: "authorization_required",
    });
  return new Secret({
    token: token.accessToken,
    expiresAt: token.accessTokenExpiresAt?.getTime(),
  });
};
const googleCallbackURL = async function (value: string) {
  const url = await Promise.try(
    async () => new URL(value, applicationOrigin())
  ).catch(() => {
    throw new GoogleWorkspaceError({
      reason: "invalid_callback",
    });
  });
  if (url.origin !== applicationOrigin() || url.username || url.password) {
    throw new GoogleWorkspaceError({
      reason: "invalid_callback",
    });
  }
  return url.href;
};
export const connectGoogleWorkspace = async function (
  headers: Headers,
  callbackURL: string,
  errorCallbackURL: string = callbackURL
) {
  await requireConfiguration();
  const callback = await googleCallbackURL(callbackURL);
  const errorCallback = await googleCallbackURL(errorCallbackURL);
  const auth = await getAuth();
  const session = await Promise.try(async () =>
    auth.api.getSession({
      headers,
    })
  ).catch(() => {
    throw new GoogleWorkspaceError({
      reason: "unauthenticated",
    });
  });
  if (!session)
    throw new GoogleWorkspaceError({
      reason: "unauthenticated",
    });
  await requireGoogleWorkspaceMembership(
    accessScopeForUser(`better-auth:${session.user.id}`)
  );
  const result = await Promise.try(async () =>
    auth.api.linkSocialAccount({
      headers,
      returnHeaders: true,
      body: {
        provider: "google",
        callbackURL: callback,
        errorCallbackURL: errorCallback,
        disableRedirect: true,
        scopes: [...googleWorkspaceScopes],
      },
    })
  ).catch(() => {
    throw new GoogleWorkspaceError({
      reason: "unavailable",
    });
  });
  if (!result.response.url)
    throw new GoogleWorkspaceError({
      reason: "unavailable",
    });
  const url = new URL(result.response.url);
  // Refreshable Workspace access is granted explicitly in Connections.
  url.searchParams.set("prompt", "consent select_account");
  return {
    url: url.href,
    headers: result.headers,
  };
};
export const isInvalidGoogleRevocationToken = (value: unknown) =>
  isValid(
    z.object({
      response: z.object({
        status: z.literal(400),
        data: z.object({
          error: z.literal("invalid_token"),
        }),
      }),
    }),
    value
  );
export const disconnectGoogleWorkspace = async function (headers: Headers) {
  try {
    await Promise.try(async () => {
      const auth = await getAuth();
      const session = await Promise.try(async () =>
        auth.api.getSession({
          headers,
        })
      ).catch(() => {
        throw new GoogleWorkspaceError({
          reason: "unauthenticated",
        });
      });
      if (!session)
        throw new GoogleWorkspaceError({
          reason: "unauthenticated",
        });
      const account = await findAccount(
        accessScopeForUser(`better-auth:${session.user.id}`)
      );
      if (!account) return;
      const rows = await query(
        sql`SELECT COALESCE("refreshToken", "accessToken") AS token FROM account WHERE id = ${account.id} AND "userId" = ${session.user.id} AND "providerId" = 'google' AND issuer = 'https://accounts.google.com'`
      );
      const tokens = await z
        .array(
          z.object({
            token: z.nullable(z.string()),
          })
        )
        .parseAsync(rows);
      const encrypted = tokens[0]?.token;
      if (encrypted) {
        const token = await Promise.try(
          async () =>
            new Secret(
              await symmetricDecrypt({
                data: encrypted,
                key: (await auth.$context).secretConfig,
              })
            )
        ).catch(() => {
          throw new GoogleWorkspaceError({
            reason: "unavailable",
          });
        });
        try {
          await new google.OAuth2().revokeToken(token.reveal());
        } catch (error) {
          if (!isInvalidGoogleRevocationToken(error))
            throw new GoogleWorkspaceError({
              reason: "unavailable",
            });
        }
      }
      // Keep issuer + subject: this identity may be the person's only sign-in.
      // A newer grant created during revocation must not be silently cleared.
      const cleared = await query(sql`
      UPDATE account SET "accessToken" = NULL, "refreshToken" = NULL,
        "idToken" = NULL, "accessTokenExpiresAt" = NULL,
        "refreshTokenExpiresAt" = NULL, scope = '', "updatedAt" = now()
      WHERE id = ${account.id} AND "userId" = ${session.user.id}
        AND COALESCE("refreshToken", "accessToken") IS NOT DISTINCT FROM ${encrypted ?? null}
      RETURNING id`);
      if (cleared.length !== 1)
        throw new GoogleWorkspaceError({
          reason: "unavailable",
        });
      return;
    });
    return;
  } catch (error) {
    if (error instanceof SqlError || error instanceof SchemaError) {
      throw new GoogleWorkspaceError({
        reason: "unavailable",
      });
    }
    throw error;
  }
};
