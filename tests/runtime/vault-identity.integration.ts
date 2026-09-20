import { Secret } from "@shared/environment/secret";
import { query as dbQuery } from "@db/queries";
import { sql } from "drizzle-orm";
import { jsonString } from "@shared/validation";
import { z } from "zod";
import {
  createHash,
  createHmac,
  createPublicKey,
  randomBytes,
  verify,
} from "node:crypto";

import { expect, test, vi } from "vitest";
import type * as Environment from "@shared/environment";
import { getInstallationSecrets } from "@db/services/installation-secrets";
import { getAuth } from "@db/services/auth";

import { workspaceFixture } from "./workspace-fixture";

const base = "https://zoen-vault-identity.example.invalid";
const vault = "https://vault-identity.example.invalid";
const clientSecret = "synthetic-vault-oidc-client-secret-for-integration";
vi.mock("@shared/environment", async (original) => {
  const actual = await original<typeof Environment>();
  return {
    ...actual,
    env: {
      ...actual.env,
      BETTER_AUTH_URL: "https://zoen-vault-identity.example.invalid",
      ZOEN_VAULTWARDEN_URL: "https://vault-identity.example.invalid",
      ZOEN_VAULTWARDEN_CLIENT_SECRET: new Secret(
        "synthetic-vault-oidc-client-secret-for-integration"
      ),
    },
  };
});

const tokensSchema = z.object({
  access_token: z.string(),
  refresh_token: z.string(),
  id_token: z.string(),
});

test("Vaultwarden OIDC binds the verified person, requires PKCE and retires tokens with the Zoen session", async () => {
  await using workspace = await workspaceFixture();
  const { actor } = workspace;
  const id = actor.userId.replace(/^better-auth:/, "");
  await dbQuery(
    sql`UPDATE public.user SET "emailVerified" = true WHERE id = ${id}`
  );
  const auth = await getAuth();
  const { betterAuthSecret } = await getInstallationSecrets();
  const signature = createHmac("sha256", betterAuthSecret)
    .update(actor.authSessionId)
    .digest("base64");
  const cookie = `__Secure-better-auth.session_token=${encodeURIComponent(`${actor.authSessionId}.${signature}`)}`;
  const request = (path: string, body?: URLSearchParams) =>
    auth.handler(
      new Request(`${base}/api/auth${path}`, {
        method: body ? "POST" : "GET",
        headers: body
          ? {
              "content-type": "application/x-www-form-urlencoded",
              authorization: `Basic ${Buffer.from(`zoen-vaultwarden:${clientSecret}`).toString("base64")}`,
            }
          : { cookie },
        body,
      })
    );
  const metadata = await request("/.well-known/openid-configuration");
  expect(metadata.status).toBe(200);
  const discovery = z.json().parse(await metadata.json());
  expect(discovery).toMatchObject({
    issuer: `${base}/api/auth`,
    grant_types_supported: ["authorization_code", "refresh_token"],
  });
  const verifier = randomBytes(32).toString("base64url");
  const query = new URLSearchParams({
    client_id: "zoen-vaultwarden",
    redirect_uri: `${vault}/identity/connect/oidc-signin`,
    response_type: "code",
    scope: "openid email profile offline_access",
    state: "synthetic-state",
    nonce: "synthetic-nonce",
    code_challenge: createHash("sha256").update(verifier).digest("base64url"),
    code_challenge_method: "S256",
  });
  const authorize = await request(`/oauth2/authorize?${query}`);
  expect(authorize.status).toBe(302);
  const destination = new URL(authorize.headers.get("location") ?? base);
  expect(destination.origin).toBe(vault);
  expect(destination.searchParams.get("state")).toBe("synthetic-state");
  const code = destination.searchParams.get("code");
  expect(code).toBeTruthy();
  const body = new URLSearchParams({
    grant_type: "authorization_code",
    code: code ?? "",
    redirect_uri: `${vault}/identity/connect/oidc-signin`,
    code_verifier: verifier,
  });
  const exchanged = await request("/oauth2/token", body);
  expect(exchanged.status).toBe(200);
  const tokens = tokensSchema.parse(await exchanged.json());
  const wrongSecret = await auth.handler(
    new Request(`${base}/api/auth/oauth2/token`, {
      method: "POST",
      headers: {
        "content-type": "application/x-www-form-urlencoded",
        authorization: `Basic ${Buffer.from("zoen-vaultwarden:incorrect-client-secret").toString("base64")}`,
      },
      body: new URLSearchParams({
        grant_type: "refresh_token",
        refresh_token: tokens.refresh_token,
      }),
    })
  );
  expect(wrongSecret.status).toBeGreaterThanOrEqual(400);
  const info = await auth.handler(
    new Request(`${base}/api/auth/oauth2/userinfo`, {
      headers: { authorization: `Bearer ${tokens.access_token}` },
    })
  );
  expect(info.status).toBe(200);
  expect(await info.json()).toMatchObject({
    sub: id,
    email_verified: true,
  });
  const [header, payload, signed] = tokens.id_token.split(".");
  if (!header || !payload || !signed) throw new Error("ID token missing");
  const claims = jsonString(z.json()).parse(
    Buffer.from(payload, "base64url").toString()
  );
  expect(claims).toMatchObject({
    sub: id,
    iss: `${base}/api/auth`,
    aud: "zoen-vaultwarden",
    nonce: "synthetic-nonce",
    email_verified: true,
  });
  const jwks = await request("/jwks");
  const keys = z
    .object({
      keys: z.array(
        z.object({
          kty: z.string(),
          n: z.string(),
          e: z.string(),
        })
      ),
    })
    .parse(await jwks.json());
  expect(keys.keys).toHaveLength(1);
  const key = keys.keys[0];
  if (!key) throw new Error("Signing key missing");
  expect(
    verify(
      "RSA-SHA256",
      Buffer.from(`${header}.${payload}`),
      createPublicKey({ key, format: "jwk" }),
      Buffer.from(signed, "base64url")
    )
  ).toBe(true);
  const replay = await request("/oauth2/token", body);
  expect(replay.status).toBeGreaterThanOrEqual(400);
  const malicious = new URLSearchParams(query);
  malicious.set("redirect_uri", "https://other.example.invalid/callback");
  const redirectDenied = await request(`/oauth2/authorize?${malicious}`);
  expect(redirectDenied.headers.get("location")).toMatch(
    /^https:\/\/zoen-vault-identity\.example\.invalid\/api\/auth\/error\?/
  );
  const missingPkce = new URLSearchParams(query);
  missingPkce.delete("code_challenge");
  missingPkce.delete("code_challenge_method");
  const pkceDenied = await request(`/oauth2/authorize?${missingPkce}`);
  expect(pkceDenied.headers.get("location") ?? "").not.toContain("?code=");
  expect(pkceDenied.status).not.toBe(200);
  const registration = await auth.handler(
    new Request(`${base}/api/auth/oauth2/register`, {
      method: "POST",
      headers: {
        "content-type": "application/json",
        cookie,
        origin: base,
      },
      body: JSON.stringify({
        redirect_uris: ["https://other.example.invalid"],
      }),
    })
  );
  expect(registration.status).toBeGreaterThanOrEqual(400);
  const invalidVerifier = await request(`/oauth2/authorize?${query}`);
  const challengedCode = new URL(
    invalidVerifier.headers.get("location") ?? base
  ).searchParams.get("code");
  const verifierDenied = await request(
    "/oauth2/token",
    new URLSearchParams({
      grant_type: "authorization_code",
      code: challengedCode ?? "",
      redirect_uri: `${vault}/identity/connect/oidc-signin`,
      code_verifier: randomBytes(32).toString("base64url"),
    })
  );
  expect(verifierDenied.status).toBeGreaterThanOrEqual(400);
  await dbQuery(
    sql`UPDATE public.user SET "emailVerified" = false WHERE id = ${id}`
  );
  const unverified = await auth.handler(
    new Request(`${base}/api/auth/oauth2/userinfo`, {
      headers: { authorization: `Bearer ${tokens.access_token}` },
    })
  );
  expect(unverified.status).toBeGreaterThanOrEqual(400);
  await dbQuery(
    sql`UPDATE public.user SET "emailVerified" = true WHERE id = ${id}`
  );
  await dbQuery(
    sql`DELETE FROM public.session WHERE id = ${actor.authSessionId}`
  );
  const revoked = await request(
    "/oauth2/token",
    new URLSearchParams({
      grant_type: "refresh_token",
      refresh_token: tokens.refresh_token,
    })
  );
  expect(revoked.status).toBeGreaterThanOrEqual(400);
  const credentials = await dbQuery(
    sql`SELECT id FROM oauth_refresh_token WHERE user_id = ${id}`
  );
  expect(credentials).toHaveLength(0);
});
