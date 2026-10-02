const configuration = vi.hoisted((): Record<string, unknown> => ({}));
vi.mock("@shared/environment/env", async (original) => {
  const actual = await original<typeof import("@shared/environment/env")>();
  return {
    ...actual,
    env: new Proxy(actual.env, {
      get(target, name): unknown {
        if (
          typeof name === "string" &&
          (name.startsWith("TELEGRAM_") || name.startsWith("KAPSO_"))
        )
          return configuration[name];
        return Reflect.get(target, name);
      },
    }),
  };
});
import { env } from "@shared/environment/env";
import { query } from "@db/queries";
import { sql } from "drizzle-orm";
import { z } from "zod";
import assert from "node:assert/strict";
import { randomBytes, randomUUID } from "node:crypto";
import { betterAuth } from "better-auth";
import { Pool } from "pg";
import { test, vi } from "vitest";
import { readAuthSession } from "../../db/services/auth/session";
import { AuthUnavailable } from "../../db/services/auth";
vi.mock("../../db/services/auth/session", () => ({
  readAuthSession: vi.fn<typeof readAuthSession>(),
}));
import { NativeDeviceAuth } from "../../server/accounts/device";
import { ChannelAccounts } from "../../server/accounts";
import { channelAuthPlugin } from "../../server/channel-auth";
import { accessScopeForUser } from "../../shared/identity/access-scope";
import {
  channelChallengeSchema,
  deviceBoundSchema,
} from "../../shared/identity/channel-auth";
import { linkedIdentity } from "./identity-fixture";
const cookieHeader = (response: Response) =>
  response.headers
    .getSetCookie()
    .map((value) => value.split(";")[0])
    .join("; ");
const BrowserSession = z.object({
  user: z.object({
    id: z.string(),
  }),
  session: z.object({
    id: z.string(),
  }),
});
test("native linking pins both proofs, rejects account transfers and prevents replay", async () => {
  const databaseUrl = env.DATABASE_URL;
  const pool = new Pool({
    connectionString: databaseUrl,
  });
  const installationId = randomUUID();
  const secret = randomBytes(32).toString("base64url");
  Object.assign(configuration, {
    KAPSO_PHONE_NUMBER_ID: installationId,
    KAPSO_PHONE_NUMBER: "+5511999999999",
  });
  const baseURL = "http://localhost:3000";
  const auth = betterAuth({
    baseURL,
    secret,
    database: pool,
    trustedOrigins: [baseURL],
    advanced: {
      disableOriginCheck: false,
      disableCSRFCheck: false,
    },
    plugins: [channelAuthPlugin()],
  });
  vi.mocked(readAuthSession).mockImplementation(async (headers) => {
    try {
      return await auth.api.getSession({
        headers,
      });
    } catch {
      throw new AuthUnavailable();
    }
  });
  const request = (
    path: string,
    cookie: string,
    body?: z.core.util.JSONType
  ) => {
    const init: RequestInit = {
      method: body === undefined ? "GET" : "POST",
      headers: {
        cookie,
        origin: baseURL,
        "content-type": "application/json",
      },
    };
    if (body !== undefined) init.body = JSON.stringify(body);
    return auth.handler(
      new Request(`${baseURL}/api/auth/channel-auth/${path}`, init)
    );
  };
  const createIdentity = async () => {
    const identity = await linkedIdentity({
      channel: "kapso",
      installationId,
      senderId: randomUUID(),
    });
    const scope = accessScopeForUser(`better-auth:${identity.userId}`);
    const sessionId = randomUUID();
    await query(
      sql`INSERT INTO agent_sessions (session_id, workspace_id, created_by_user_id) VALUES (${sessionId}, ${scope.workspaceId}, ${scope.userId})`
    );
    return {
      identity,
      scope,
      source: {
        identityId: identity.id,
        sessionId,
      },
    };
  };
  const owner = await createIdentity();
  const other = await createIdentity();
  // oxlint-disable-next-line unicorn/consistent-function-scoping -- The default source parameter captures this test’s owner identity.
  const issue = async (
    purpose: "login" | "link",
    callId = randomUUID(),
    source = owner.source
  ) => {
    const devices = NativeDeviceAuth;
    return await devices.issue({
      ...source,
      callId,
      purpose,
    });
  };
  const pending = async () => {
    const devices = NativeDeviceAuth;
    return await devices.pending(owner.source);
  };
  // oxlint-disable-next-line unicorn/consistent-function-scoping -- The default source parameter captures this test’s owner identity.
  const confirm = async (
    id: string,
    boundAt: string,
    purpose: "login" | "link" = "link",
    source = owner.source
  ) => {
    const devices = NativeDeviceAuth;
    const confirmation = {
      ...source,
      challengeId: id,
      browserBoundAt: boundAt,
      purpose,
    };
    return await devices.confirm(confirmation);
  };
  const signIn = async (source = owner.source) => {
    const issued = await issue("login", randomUUID(), source);
    assert.ok(issued.entryToken);
    const response = await request("device-bind", "", {
      id: issued.challenge.id,
      token: issued.entryToken,
      purpose: "login",
    });
    assert.equal(response.status, 200);
    const bound = await (async function () {
      const devices = NativeDeviceAuth;
      return (await devices.pending(source)).find(
        (item) => item.id === issued.challenge.id
      );
    })();
    assert.ok(bound?.browserBoundAt);
    await confirm(bound.id, bound.browserBoundAt, "login", source);
    const completed = await request("complete", cookieHeader(response), {
      id: bound.id,
    });
    assert.equal(completed.status, 200);
    const cookie = cookieHeader(completed);
    const sessionResponse = await auth.handler(
      new Request(`${baseURL}/api/auth/get-session`, {
        headers: {
          cookie,
        },
      })
    );
    return {
      cookie,
      ...BrowserSession.parse(await sessionResponse.json()),
    };
  };
  try {
    const browser = await signIn();
    const wrongBrowser = await signIn();
    const foreignBrowser = await signIn(other.source);
    const start = await request("start", browser.cookie, {
      channel: "kapso",
      purpose: "link",
    });
    assert.equal(start.status, 200);
    const entry = channelChallengeSchema.parse(await start.json());
    assert.equal(entry.channel, "kapso");
    assert.match(
      new URL(entry.deepLink).searchParams.get("text") ?? "",
      /^\/start [A-Za-z0-9_-]{43}$/u
    );
    assert.ok(cookieHeader(start));
    const callId = randomUUID();
    const issued = await issue("link", callId);
    assert.ok(issued.entryToken);
    assert.deepEqual(await issue("link", callId), issued);
    await assert.rejects(issue("login", callId));
    const input = {
      id: issued.challenge.id,
      token: issued.entryToken,
      purpose: "link",
    };
    assert.equal(
      (
        await request("device-bind", browser.cookie, {
          ...input,
          purpose: "login",
        })
      ).status,
      400
    );
    assert.equal((await request("device-bind", "", input)).status, 401);
    assert.equal(
      (await request("device-bind", foreignBrowser.cookie, input)).status,
      409
    );
    const bind = await request("device-bind", browser.cookie, input);
    assert.equal(bind.status, 200);
    const metadata = deviceBoundSchema.parse(await bind.json());
    assert.equal(metadata.purpose, "link");
    assert.deepEqual(Object.keys(metadata).toSorted(), [
      "channel",
      "expiresAt",
      "id",
      "purpose",
    ]);
    const bindingCookie = cookieHeader(bind);
    const boundCookie = `${browser.cookie}; ${bindingCookie}`;
    assert.equal(
      (
        await request(
          "device-bind",
          `${wrongBrowser.cookie}; ${bindingCookie}`,
          input
        )
      ).status,
      401
    );
    assert.equal(
      (await request(`device?id=${input.id}&purpose=link`, bindingCookie))
        .status,
      401
    );
    assert.equal(
      (
        await request(
          `device?id=${input.id}&purpose=link`,
          `${wrongBrowser.cookie}; ${bindingCookie}`
        )
      ).status,
      401
    );
    assert.equal(
      (await request(`device?id=${input.id}&purpose=login`, boundCookie))
        .status,
      400
    );
    assert.equal(
      (await request(`device?id=${input.id}&purpose=link`, boundCookie)).status,
      200
    );
    const bound = (await pending()).find((item) => item.id === input.id);
    assert.ok(bound?.browserBoundAt);
    assert.equal(bound.purpose, "link");
    await assert.rejects(confirm(bound.id, bound.browserBoundAt, "login"));
    assert.equal(
      (
        await request("complete", boundCookie, {
          id: bound.id,
        })
      ).status,
      400
    );
    await confirm(bound.id, bound.browserBoundAt);
    assert.equal(
      (
        await request("complete", `${wrongBrowser.cookie}; ${bindingCookie}`, {
          id: bound.id,
        })
      ).status,
      401
    );
    const sessionsBefore = await pool.query<{
      count: number;
    }>(
      'SELECT count(*)::int AS count FROM public.session WHERE "userId" = $1',
      [owner.identity.userId]
    );
    const results = await Promise.all([
      request("complete", boundCookie, {
        id: bound.id,
      }),
      request("complete", boundCookie, {
        id: bound.id,
      }),
    ]);
    assert.deepEqual(
      results.map((result) => result.status).toSorted((a, b) => a - b),
      [200, 400]
    );
    assert.ok(
      results.every(
        (response) =>
          !response.headers
            .getSetCookie()
            .some((cookie) => cookie.includes("session_token="))
      )
    );
    const sessionsAfter = await pool.query<{
      count: number;
    }>(
      'SELECT count(*)::int AS count FROM public.session WHERE "userId" = $1',
      [owner.identity.userId]
    );
    assert.equal(sessionsAfter.rows[0]?.count, sessionsBefore.rows[0]?.count);
    const owners = await pool.query<{
      id: string;
      userId: string;
    }>(
      'SELECT id, user_id AS "userId" FROM channel_identity WHERE installation_id = $1 ORDER BY id',
      [installationId]
    );
    assert.deepEqual(
      owners.rows,
      [owner.identity, other.identity]
        .map(({ id, userId }) => ({
          id,
          userId,
        }))
        .toSorted((a, b) => a.id.localeCompare(b.id))
    );
    const stale = await issue("link");
    assert.ok(stale.entryToken);
    await pool.query(
      "UPDATE public.session SET \"createdAt\" = clock_timestamp() - interval '11 minutes' WHERE id = $1",
      [wrongBrowser.session.id]
    );
    assert.equal(
      (
        await request("device-bind", wrongBrowser.cookie, {
          id: stale.challenge.id,
          token: stale.entryToken,
          purpose: "link",
        })
      ).status,
      401
    );
    const expiring = await request("device-bind", browser.cookie, {
      id: stale.challenge.id,
      token: stale.entryToken,
      purpose: "link",
    });
    assert.equal(expiring.status, 200);
    const staleBound = (await pending()).find(
      (item) => item.id === stale.challenge.id
    );
    assert.ok(staleBound?.browserBoundAt);
    await pool.query(
      "UPDATE public.session SET \"expiresAt\" = clock_timestamp() - interval '1 second' WHERE id = $1",
      [browser.session.id]
    );
    await assert.rejects(confirm(staleBound.id, staleBound.browserBoundAt));
    assert.equal(
      (
        await request(
          "complete",
          `${browser.cookie}; ${cookieHeader(expiring)}`,
          {
            id: staleBound.id,
          }
        )
      ).status,
      400
    );
    const renewed = await signIn();
    const revoked = await issue("link");
    assert.ok(revoked.entryToken);
    const revokedBinding = await request("device-bind", renewed.cookie, {
      id: revoked.challenge.id,
      token: revoked.entryToken,
      purpose: "link",
    });
    assert.equal(revokedBinding.status, 200);
    const revokedBound = (await pending()).find(
      (item) => item.id === revoked.challenge.id
    );
    assert.ok(revokedBound?.browserBoundAt);
    await confirm(revokedBound.id, revokedBound.browserBoundAt);
    await pool.query("DELETE FROM public.session WHERE id = $1", [
      renewed.session.id,
    ]);
    assert.equal(
      (
        await request(
          "complete",
          `${renewed.cookie}; ${cookieHeader(revokedBinding)}`,
          {
            id: revokedBound.id,
          }
        )
      ).status,
      400
    );
    const expired = await issue("link");
    assert.ok(expired.entryToken);
    await pool.query(
      "UPDATE channel_auth_challenge SET created_at = clock_timestamp() - interval '10 minutes', expires_at = clock_timestamp() - interval '5 minutes' WHERE id = $1",
      [expired.challenge.id]
    );
    const fresh = await signIn();
    assert.equal(
      (
        await request("device-bind", fresh.cookie, {
          id: expired.challenge.id,
          token: expired.entryToken,
          purpose: "link",
        })
      ).status,
      400
    );

    const crossAccount = await issue("link", randomUUID(), other.source);
    assert.ok(crossAccount.entryToken);
    const crossAccountInput = {
      id: crossAccount.challenge.id,
      token: crossAccount.entryToken,
      purpose: "link",
    };
    assert.equal(
      (await request("device-bind", fresh.cookie, crossAccountInput)).status,
      409
    );
    assert.deepEqual(await NativeDeviceAuth.pending(other.source), []);
    assert.deepEqual(
      await ChannelAccounts.getActiveIdentity({
        channel: other.identity.channel,
        installationId: other.identity.installationId,
        senderId: other.identity.senderId,
      }),
      other.identity
    );
    const ownBinding = await request(
      "device-bind",
      foreignBrowser.cookie,
      crossAccountInput
    );
    assert.equal(ownBinding.status, 200);
    const ownBound = (await NativeDeviceAuth.pending(other.source)).find(
      (item) => item.id === crossAccount.challenge.id
    );
    assert.ok(ownBound?.browserBoundAt);
    await confirm(ownBound.id, ownBound.browserBoundAt, "link", other.source);
    assert.equal(
      (
        await request(
          "complete",
          `${foreignBrowser.cookie}; ${cookieHeader(ownBinding)}`,
          { id: ownBound.id }
        )
      ).status,
      200
    );
    assert.equal(
      (
        await ChannelAccounts.getActiveIdentity({
          channel: other.identity.channel,
          installationId: other.identity.installationId,
          senderId: other.identity.senderId,
        })
      ).userId,
      other.identity.userId
    );
  } finally {
    await pool.query(
      "DELETE FROM channel_auth_challenge WHERE installation_id = $1",
      [installationId]
    );
    await pool.query(
      "DELETE FROM channel_identity WHERE installation_id = $1",
      [installationId]
    );
    await pool.query("DELETE FROM workspaces WHERE id = ANY($1)", [
      [owner.scope.workspaceId, other.scope.workspaceId],
    ]);
    await pool.query('DELETE FROM public."user" WHERE id = ANY($1)', [
      [owner.identity.userId, other.identity.userId],
    ]);
    vi.resetAllMocks();
    await pool.end();
  }
});
