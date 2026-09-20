import { betterAuth } from "better-auth";
import { drizzleAdapter } from "better-auth/adapters/drizzle";
import { account, db, session, user, verification } from "@db";
import { betterAuthBaseURL } from "@shared/environment/origin";
import { env } from "@shared/environment";
import { getInstallationSecrets } from "@db/services/installation-secrets";
import { channelAuthPlugin } from "../../../server/channel-auth";
import * as oauthSchema from "@db/schema/oauth";
import {
  provisionVaultwardenClient,
  vaultwardenAuthPlugins,
} from "./vaultwarden";

export class AuthUnavailable extends Error {
  readonly _tag = "AuthUnavailable";

  constructor() {
    super("AuthUnavailable");
    this.name = "AuthUnavailable";
  }
}

const initializeAuth = async function () {
  await Promise.try(async () => provisionVaultwardenClient()).catch(() => {
    throw new AuthUnavailable();
  });
  const { betterAuthSecret } = await Promise.try(async () =>
    getInstallationSecrets()
  ).catch(() => {
    throw new AuthUnavailable();
  });
  try {
    return betterAuth({
      appName: "Zoen",
      baseURL: betterAuthBaseURL(),
      advanced: { disableOriginCheck: false, disableCSRFCheck: false },
      database: drizzleAdapter(db, {
        provider: "pg",
        schema: { account, session, user, verification, ...oauthSchema },
      }),
      socialProviders:
        env.GOOGLE_CLIENT_ID !== undefined &&
        env.GOOGLE_CLIENT_SECRET !== undefined
          ? {
              google: {
                clientId: env.GOOGLE_CLIENT_ID,
                clientSecret: env.GOOGLE_CLIENT_SECRET.reveal(),
                accessType: "offline",
                prompt: "select_account",
                includeGrantedScopes: false,
              },
            }
          : {},
      account: {
        encryptOAuthTokens: true,
        // Signing in must not replace the separate Gmail/Calendar grant.
        updateAccountOnSignIn: false,
        accountLinking: {
          enabled: true,
          disableImplicitLinking: true,
          allowDifferentEmails: true,
          allowUnlinkingAll: true,
        },
      },
      databaseHooks: {
        user: {
          create: {
            before: async (identity) =>
              identity.emailVerified &&
              (env.ZOEN_REGISTRATION_MODE === "open" ||
                env.ZOEN_BETA_IDENTITIES.includes(
                  `google:${identity.email.toLowerCase()}`
                )),
          },
        },
      },
      disabledPaths: [
        "/token",
        "/account-info",
        "/change-email",
        "/get-access-token",
        "/refresh-token",
        "/link-social",
        "/unlink-account",
        "/request-password-reset",
        "/reset-password",
        "/reset-password/:token",
        "/send-verification-email",
        "/sign-in/email",
        "/sign-up/email",
        "/verify-email",
      ],
      plugins: [channelAuthPlugin(), ...vaultwardenAuthPlugins()],
      secret: betterAuthSecret,
    });
  } catch {
    throw new AuthUnavailable();
  }
};

let initialized: ReturnType<typeof initializeAuth> | undefined;

export function getAuth() {
  return (initialized ??= initializeAuth().catch((error: unknown) => {
    initialized = undefined;
    throw error;
  }));
}
