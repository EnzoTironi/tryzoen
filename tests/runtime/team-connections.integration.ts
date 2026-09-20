import { AsyncLocalStorage } from "node:async_hooks";
import { query } from "@db/queries";
import { sql } from "drizzle-orm";
import type * as GoogleWorkspace from "../../server/google-workspace";
import type * as Environment from "@shared/environment";
import { randomUUID } from "node:crypto";
import { auth as google } from "@googleapis/gmail";
import { symmetricEncrypt } from "better-auth/crypto";
import { afterEach, expect, test, vi, onTestFinished } from "vitest";
import { readWorkspaceCapabilities } from "../../server/workspaces/capabilities";
import {
  disconnectWorkspaceGoogle,
  getWorkspaceGoogleToken,
  shareGoogleConnection,
} from "../../server/workspaces/connections";
import { googleWorkspaceScopes } from "../../shared/google-workspace/connection";
import { workspaceFixture } from "./workspace-fixture";
const fixtureKey = "synthetic-google-connection-key-for-tests-only";
vi.mock("@shared/environment", async (original) => {
  const actual = await original<typeof Environment>();
  return {
    ...actual,
    env: {
      ...actual.env,
      GOOGLE_CLIENT_ID: "synthetic-client",
    },
  };
});
vi.mock("../../db/services/auth", async () => {
  return {
    getAuth: async () => ({
      $context: Promise.resolve({
        secretConfig: "synthetic-google-connection-key-for-tests-only",
      }),
    }),
  };
});
vi.mock("../../server/google-workspace", async (original) => {
  const actual = await original<typeof GoogleWorkspace>();
  const { Secret } = await import("../../shared/environment/secret");
  return {
    ...actual,
    getGoogleWorkspaceToken: async () =>
      new Secret({
        token: "synthetic-access-token",
        expiresAt: Date.now() + 3600_000,
      }),
  };
});
afterEach(() => vi.restoreAllMocks());
const googleFixture = async function (
  verification: boolean | string | number | null = true,
  audience?: string
) {
  const fixture = await workspaceFixture();
  onTestFinished(() => fixture[Symbol.asyncDispose]());
  const subject = randomUUID();
  const refresh = await symmetricEncrypt({
    key: fixtureKey,
    data: "synthetic-refresh-token",
  });
  await query(sql`INSERT INTO account (id, issuer, "accountId", "providerId", "userId", "refreshToken", scope, "updatedAt")
    VALUES (${subject}, 'https://accounts.google.com', ${subject}, 'google', ${fixture.actor.userId.slice(12)}, ${refresh}, ${googleWorkspaceScopes.join(" ")}, now())`);
  const identity = {
    sub: subject,
    email: "team@example.invalid",
    email_verified: true,
    aud: audience ?? "synthetic-client",
    expiry_date: Date.now() + 3600_000,
    scopes: [...googleWorkspaceScopes],
  };
  // The provider client returns the raw wire field without normalizing its type.
  Reflect.set(identity, "email_verified", verification);
  vi.spyOn(google.OAuth2.prototype, "getTokenInfo").mockResolvedValue(identity);
  return fixture;
};
test.each([true, "true"])(
  "an explicit verified Google share (%s) enables team tools without moving personal credentials",
  async (verification) => {
    const { actor, guest } = await googleFixture(verification);
    expect(
      !(
        await Promise.try(async () => shareGoogleConnection(guest)).then(
          (value) => ({
            ok: true as const,
            value,
          }),
          (error: unknown) => ({
            ok: false as const,
            error,
          })
        )
      ).ok
    ).toBe(true);
    await shareGoogleConnection(actor);
    expect((await readWorkspaceCapabilities(guest)).enabled).toContain(
      "google"
    );
    expect((await getWorkspaceGoogleToken(guest)).reveal().token).toBe(
      "synthetic-access-token"
    );
    const stored = await query<{
      credentials: string;
      label: string;
    }>(
      sql`SELECT credentials, label FROM workspace_connections WHERE workspace_id = ${actor.workspaceId}`
    );
    expect(stored[0]?.label).toBe("team@example.invalid");
    expect(stored[0]?.credentials).not.toContain("synthetic-access-token");
    await query(
      sql`DELETE FROM organization_memberships WHERE user_id = ${guest.userId}`
    );
    expect(
      !(
        await Promise.try(async () => getWorkspaceGoogleToken(guest)).then(
          (value) => ({
            ok: true as const,
            value,
          }),
          (error: unknown) => ({
            ok: false as const,
            error,
          })
        )
      ).ok
    ).toBe(true);
    await disconnectWorkspaceGoogle(actor);
    expect(
      !(
        await Promise.try(async () => getWorkspaceGoogleToken(actor)).then(
          (value) => ({
            ok: true as const,
            value,
          }),
          (error: unknown) => ({
            ok: false as const,
            error,
          })
        )
      ).ok
    ).toBe(true);
    expect(
      await query(
        sql`SELECT id FROM account WHERE ('better-auth:' || "userId") = ${actor.userId}`
      )
    ).toHaveLength(1);
  }
);
test.each([false, "false", "TRUE", "1", 1, null, ""])(
  "an unverified wire value (%s) cannot authorize sharing Google",
  async (verification) => {
    const { actor } = await googleFixture(verification);
    expect(
      !(
        await Promise.try(async () => shareGoogleConnection(actor)).then(
          (value) => ({
            ok: true as const,
            value,
          }),
          (error: unknown) => ({
            ok: false as const,
            error,
          })
        )
      ).ok
    ).toBe(true);
    expect(
      await query(
        sql`SELECT workspace_id FROM workspace_connections WHERE workspace_id = ${actor.workspaceId}`
      )
    ).toEqual([]);
  }
);
test("a verified token issued to another OAuth client cannot authorize team sharing", async () => {
  const { actor } = await googleFixture(true, "another-client");
  expect(
    !(
      await Promise.try(async () => shareGoogleConnection(actor)).then(
        (value) => ({
          ok: true as const,
          value,
        }),
        (error: unknown) => ({
          ok: false as const,
          error,
        })
      )
    ).ok
  ).toBe(true);
  expect(
    await query(
      sql`SELECT workspace_id FROM workspace_connections WHERE workspace_id = ${actor.workspaceId}`
    )
  ).toEqual([]);
});
test("an unverified provider identity cannot be published as a team connection", async () => {
  const { actor } = await googleFixture();
  vi.spyOn(google.OAuth2.prototype, "getTokenInfo").mockResolvedValue({
    sub: "another-subject",
    email: "unverified@example.invalid",
    email_verified: false,
    aud: "synthetic-client",
    expiry_date: Date.now() + 3600_000,
    scopes: [],
  });
  expect(
    !(
      await Promise.try(async () => shareGoogleConnection(actor)).then(
        (value) => ({
          ok: true as const,
          value,
        }),
        (error: unknown) => ({
          ok: false as const,
          error,
        })
      )
    ).ok
  ).toBe(true);
  expect(
    await query(
      sql`SELECT workspace_id FROM workspace_connections WHERE workspace_id = ${actor.workspaceId}`
    )
  ).toEqual([]);
});
test("disconnect during token refresh cannot resurrect the shared credential", async () => {
  const { actor } = await googleFixture();
  await shareGoogleConnection(actor);
  const expired = await symmetricEncrypt({
    key: fixtureKey,
    data: JSON.stringify({
      workspaceId: actor.workspaceId,
      accessToken: "expired",
      refreshToken: "synthetic-refresh-token",
      expiresAt: 0,
    }),
  });
  await query(
    sql`UPDATE workspace_connections SET credentials = ${expired} WHERE workspace_id = ${actor.workspaceId}`
  );
  const disconnect = AsyncLocalStorage.bind(() =>
    disconnectWorkspaceGoogle(actor)
  );
  vi.spyOn(
    google.OAuth2.prototype,
    "refreshAccessToken"
    // The Promise overload is selected by production refreshAccessToken().
    // oxlint-disable-next-line typescript/no-misused-promises
  ).mockImplementation(async () => {
    await disconnect();
    return {
      credentials: {
        access_token: "refreshed-after-disconnect",
        expiry_date: Date.now() + 3600_000,
      },
      res: null,
    };
  });
  expect(
    !(
      await Promise.try(async () => getWorkspaceGoogleToken(actor)).then(
        (value) => ({
          ok: true as const,
          value,
        }),
        (error: unknown) => ({
          ok: false as const,
          error,
        })
      )
    ).ok
  ).toBe(true);
  expect(
    await query(
      sql`SELECT workspace_id FROM workspace_connections WHERE workspace_id = ${actor.workspaceId}`
    )
  ).toEqual([]);
});
