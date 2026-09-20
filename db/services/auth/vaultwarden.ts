import { createHash } from "node:crypto";
import { oauthProvider } from "@better-auth/oauth-provider";
import { jwt } from "better-auth/plugins";
import { APIError } from "better-auth/api";
import { and, eq } from "drizzle-orm";
import { db, oauthClient, user } from "@db";
import { env } from "@shared/environment";

const clientId = "zoen-vaultwarden";
const scopes = ["openid", "email", "profile", "offline_access"];
const hashClientSecret = (value: string) =>
  createHash("sha256").update(value).digest("base64url");

class VaultIdentityUnavailable extends Error {
  readonly _tag = "VaultIdentityUnavailable";

  constructor() {
    super("VaultIdentityUnavailable");
    this.name = "VaultIdentityUnavailable";
  }
}

const vaultIdentityClaims = async function (
  identity: Pick<typeof user.$inferSelect, "id">
) {
  const rows = await Promise.try(async () =>
    db
      .select({ email: user.email, name: user.name })
      .from(user)
      .where(and(eq(user.id, identity.id), eq(user.emailVerified, true)))
      .limit(1)
  ).catch(() => {
    throw new VaultIdentityUnavailable();
  });
  const current = rows[0];
  if (!current) throw new VaultIdentityUnavailable();
  return { email: current.email, email_verified: true, name: current.name };
};

const claims = async (identity: Pick<typeof user.$inferSelect, "id">) => {
  try {
    return await vaultIdentityClaims(identity);
  } catch {
    throw new APIError("FORBIDDEN", {
      message: "A verified Zoen account is required.",
    });
  }
};

export const vaultwardenAuthPlugins = () =>
  env.ZOEN_VAULTWARDEN_URL && env.ZOEN_VAULTWARDEN_CLIENT_SECRET
    ? [
        jwt({
          jwks: { keyPairConfig: { alg: "RS256" } },
          disableSettingJwtHeader: true,
        }),
        oauthProvider({
          loginPage: "/vault/sign-in",
          consentPage: "/vault/sign-in",
          scopes,
          grantTypes: ["authorization_code", "refresh_token"],
          allowDynamicClientRegistration: false,
          allowUnauthenticatedClientRegistration: false,
          clientPrivileges: () => false,
          resourcePrivileges: () => false,
          cachedTrustedClients: new Set([clientId]),
          storeClientSecret: { hash: hashClientSecret },
          accessTokenExpiresIn: 300,
          refreshTokenExpiresIn: 86_400,
          customIdTokenClaims: ({ user: identity }) => claims(identity),
          customUserInfoClaims: ({ user: identity }) => claims(identity),
          customAccessTokenClaims: ({ user: identity }) => {
            if (!identity) throw new APIError("FORBIDDEN");
            return claims(identity).then(async () => ({}));
          },
        }),
      ]
    : [];

/** One immutable first-party client; no public or user-managed client registration. */
export const provisionVaultwardenClient = async function () {
  const url = env.ZOEN_VAULTWARDEN_URL;
  const secret = env.ZOEN_VAULTWARDEN_CLIENT_SECRET;
  if (!url || !secret) return;
  const client = {
    clientId,
    clientSecret: hashClientSecret(secret.reveal()),
    name: "Zoen Vault",
    scopes,
    disabled: false,
    skipConsent: true,
    enableEndSession: false,
    tokenEndpointAuthMethod: "client_secret_basic",
    applicationType: "web",
    grantTypes: ["authorization_code", "refresh_token"],
    responseTypes: ["code"],
    redirectUris: [`${url}/identity/connect/oidc-signin`],
    requirePKCE: true,
  };
  await Promise.try(async () =>
    db
      .insert(oauthClient)
      .values({ id: clientId, ...client })
      .onConflictDoUpdate({ target: oauthClient.clientId, set: client })
  ).catch(() => {
    throw new VaultIdentityUnavailable();
  });
};
