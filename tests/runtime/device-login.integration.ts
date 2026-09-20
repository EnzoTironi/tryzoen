import { env } from "@shared/environment/env";
import { query } from "@db/queries";
import { sql } from "drizzle-orm";
import { z } from "zod";
import { deviceAuthStatus } from "../../server/tools/tools/device-auth";
import { channelPrincipal } from "../../server/channels/principal";
import type { ToolContext } from "eve/tools";
import assert from "node:assert/strict";
import { randomBytes, randomUUID } from "node:crypto";
import { betterAuth } from "better-auth";
import { Pool } from "pg";
import { test } from "vitest";
import { NativeDeviceAuth } from "../../server/accounts/device";
import { ChannelAccounts } from "../../server/accounts";
import { channelAuthPlugin } from "../../server/channel-auth";
import { accessScopeForUser } from "../../shared/identity/access-scope";
import { linkedIdentity } from "./identity-fixture";
const cookies = (response: Response) =>
  response.headers
    .getSetCookie()
    .map((value) => value.split(";")[0])
    .join("; ");
test("native browser binding requires same-session approval before BetterAuth can issue a session", async () => {
  const url = env.DATABASE_URL;
  const secret = randomBytes(32).toString("base64url");
  const pool = new Pool({
    connectionString: url,
  });
  const baseURL = "http://localhost:3000";
  const auth = betterAuth({
    baseURL,
    database: pool,
    secret,
    trustedOrigins: [baseURL],
    advanced: {
      disableOriginCheck: false,
      disableCSRFCheck: false,
    },
    plugins: [channelAuthPlugin()],
  });
  const request = (
    path: string,
    body?: {
      readonly id: string;
      readonly token?: string;
      readonly purpose?: "login" | "link";
    },
    cookie = "",
    origin = baseURL
  ) => {
    const init: RequestInit = {
      method: body === undefined ? "GET" : "POST",
      headers: {
        origin,
        cookie,
        "content-type": "application/json",
      },
    };
    if (body) init.body = JSON.stringify(body);
    return auth.handler(new Request(`${baseURL}/api/auth${path}`, init));
  };
  const installationId = randomUUID();
  const identity = await linkedIdentity({
    channel: "kapso",
    installationId,
    senderId: randomUUID(),
  });
  const otherIdentity = await linkedIdentity({
    channel: "kapso",
    installationId,
    senderId: randomUUID(),
  });
  const otherScope = accessScopeForUser(`better-auth:${otherIdentity.userId}`);
  const foreignSession = randomUUID();
  const scope = accessScopeForUser(`better-auth:${identity.userId}`);
  const source = {
    identityId: identity.id,
    sessionId: randomUUID(),
  };
  const otherSession = randomUUID();
  try {
    await (async function () {
      for (const id of [source.sessionId, otherSession])
        await query(
          sql`INSERT INTO agent_sessions (session_id, workspace_id, created_by_user_id) VALUES (${id}, ${scope.workspaceId}, ${scope.userId})`
        );
    })();
    await (async function () {
      await query(
        sql`INSERT INTO agent_sessions (session_id, workspace_id, created_by_user_id) VALUES (${foreignSession}, ${otherScope.workspaceId}, ${otherScope.userId})`
      );
    })();
    const principal = channelPrincipal(identity);
    const context: ToolContext = {
      session: {
        id: source.sessionId,
        auth: {
          current: principal,
          initiator: principal,
        },
        turn: {
          id: randomUUID(),
          sequence: 1,
        },
      },
      callId: randomUUID(),
      toolName: "device-auth-status",
      abortSignal: new AbortController().signal,
      getSandbox() {
        throw new Error("This test has no sandbox.");
      },
      getSkill() {
        throw new Error("This test has no skill runtime.");
      },
      getToken() {
        throw new Error("This test has no provider connection.");
      },
      requireAuth() {
        throw new Error("This test has no provider authorization.");
      },
    };
    assert.deepEqual(await deviceAuthStatus.execute({}, context), {
      requests: [],
    });
    await assert.rejects(async () =>
      deviceAuthStatus.execute(
        {},
        {
          ...context,
          session: {
            ...context.session,
            auth: {
              current: null,
              initiator: principal,
            },
          },
        }
      )
    );
    await Promise.all(
      ["scheduled-worker", "scheduled-result", "better-auth"].map(
        (authenticator) =>
          assert.rejects(async () =>
            deviceAuthStatus.execute(
              {},
              {
                ...context,
                session: {
                  ...context.session,
                  auth: {
                    current: {
                      ...principal,
                      authenticator,
                    },
                    initiator: principal,
                  },
                },
              }
            )
          )
      )
    );
    await assert.rejects(async () =>
      deviceAuthStatus.execute(
        {},
        {
          ...context,
          session: {
            ...context.session,
            parent: {
              callId: randomUUID(),
              rootSessionId: source.sessionId,
              sessionId: source.sessionId,
              turn: context.session.turn,
            },
          },
        }
      )
    );
    const issue = async (callId: string) => {
      const devices = NativeDeviceAuth;
      return await devices.issue({
        ...source,
        callId,
        purpose: "login",
      });
    };
    const pending = async (sessionId = source.sessionId) => {
      const devices = NativeDeviceAuth;
      return await devices.pending({
        identityId: identity.id,
        sessionId,
      });
    };
    const confirm = async (
      challengeId: string,
      browserBoundAt: string,
      sessionId = source.sessionId
    ) => {
      const devices = NativeDeviceAuth;
      return await devices.confirm({
        purpose: "login",
        identityId: identity.id,
        sessionId,
        challengeId,
        browserBoundAt,
      });
    };
    const issued = await issue("first");
    assert.deepEqual(await issue("first"), issued);
    const entryToken = issued.entryToken;
    assert.ok(entryToken);
    assert.deepEqual(await pending(), []);
    await assert.rejects(
      confirm(issued.challenge.id, new Date().toISOString())
    );
    await assert.rejects(
      (async function () {
        const accounts = ChannelAccounts;
        return await accounts.confirmChallenge({
          token: entryToken,
          sender: {
            channel: identity.channel,
            installationId,
            senderId: identity.senderId,
          },
        });
      })()
    );
    const body = {
      id: issued.challenge.id,
      token: entryToken,
      purpose: "login" as const,
    };
    assert.equal(
      (
        await request(
          "/channel-auth/device-bind",
          body,
          "",
          "https://attacker.invalid"
        )
      ).status,
      403
    );
    assert.equal(
      (
        await request("/channel-auth/device-bind", {
          ...body,
          token: randomBytes(32).toString("base64url"),
        })
      ).status,
      400
    );
    const binding = await request("/channel-auth/device-bind", body);
    assert.equal(binding.status, 200);
    assert.equal(binding.headers.get("cache-control"), "no-store");
    const browser = cookies(binding);
    assert.match(browser, /channel_challenge/);
    assert.equal(
      (await request("/channel-auth/device-bind", body)).status,
      400
    );
    assert.equal(
      (await request("/channel-auth/device-bind", body, browser)).status,
      200
    );
    assert.equal(
      (
        await request(
          "/channel-auth/complete",
          {
            id: body.id,
          },
          browser
        )
      ).status,
      400
    );
    assert.deepEqual(await pending(otherSession), []);
    const bound = (await pending())[0];
    assert.ok(bound?.browserBoundAt);
    assert.equal((await issue("first")).entryToken, null);
    assert.equal(
      (await request(`/channel-auth/device?id=${body.id}&purpose=login`))
        .status,
      400
    );
    const resumed = await request(
      `/channel-auth/device?id=${body.id}&purpose=login`,
      undefined,
      browser
    );
    assert.equal(resumed.status, 200);
    assert.equal(resumed.headers.get("cache-control"), "no-store");
    assert.deepEqual(await resumed.json(), {
      id: bound.id,
      purpose: "login",
      channel: bound.channel,
      expiresAt: bound.expiresAt,
    });
    assert.deepEqual(
      await (async function () {
        const devices = NativeDeviceAuth;
        return await devices.pending({
          identityId: otherIdentity.id,
          sessionId: foreignSession,
        });
      })(),
      []
    );
    await assert.rejects(
      (async function () {
        const devices = NativeDeviceAuth;
        return await devices.confirm({
          purpose: "login",
          identityId: otherIdentity.id,
          sessionId: foreignSession,
          challengeId: body.id,
          browserBoundAt: bound.browserBoundAt ?? "",
        });
      })()
    );
    await assert.rejects(confirm(body.id, bound.browserBoundAt, otherSession));
    await assert.rejects(confirm(body.id, "2000-01-01T00:00:00.000Z"));
    assert.deepEqual(await confirm(body.id, bound.browserBoundAt), {
      confirmed: true,
    });
    assert.equal(
      (
        await request("/channel-auth/complete", {
          id: body.id,
        })
      ).status,
      400
    );
    assert.equal(
      (
        await request(
          `/channel-auth/device?id=${body.id}&purpose=login`,
          undefined,
          browser
        )
      ).status,
      200
    );
    const complete = await request(
      "/channel-auth/complete",
      {
        id: body.id,
      },
      browser
    );
    assert.equal(complete.status, 200);
    const session = await request("/get-session", undefined, cookies(complete));
    const sessionBody = z
      .object({
        user: z.object({
          id: z.string(),
        }),
      })
      .parse(await session.json());
    assert.equal(sessionBody.user.id, identity.userId);
    assert.equal(
      (
        await request(
          "/channel-auth/complete",
          {
            id: body.id,
          },
          browser
        )
      ).status,
      400
    );
    await assert.rejects(confirm(body.id, bound.browserBoundAt));
    const revoked = await issue("revoked");
    assert.ok(revoked.entryToken);
    const boundRevoked = await request("/channel-auth/device-bind", {
      id: revoked.challenge.id,
      purpose: "login",
      token: revoked.entryToken,
    });
    assert.equal(boundRevoked.status, 200);
    const revocationTarget = (await pending())[0];
    assert.ok(revocationTarget?.browserBoundAt);
    await confirm(revoked.challenge.id, revocationTarget.browserBoundAt);
    await (async function () {
      await query(
        sql`UPDATE public.channel_identity SET revoked_at = clock_timestamp() WHERE id = ${identity.id}`
      );
    })();
    await assert.rejects(pending());
    assert.equal(
      (
        await request(
          `/channel-auth/device?id=${revoked.challenge.id}&purpose=login`,
          undefined,
          cookies(boundRevoked)
        )
      ).status,
      400
    );
    assert.equal(
      (
        await request(
          "/channel-auth/complete",
          {
            id: revoked.challenge.id,
          },
          cookies(boundRevoked)
        )
      ).status,
      400
    );
  } finally {
    await (async function () {
      await query(
        sql`DELETE FROM public.channel_auth_challenge WHERE installation_id = ${installationId}`
      );
      await query(
        sql`DELETE FROM public.channel_identity WHERE installation_id = ${installationId}`
      );
      await query(sql`DELETE FROM workspaces WHERE id = ${scope.workspaceId}`);
      await query(sql`DELETE FROM public."user" WHERE id = ${identity.userId}`);
      await query(
        sql`DELETE FROM workspaces WHERE id = ${otherScope.workspaceId}`
      );
      await query(
        sql`DELETE FROM public."user" WHERE id = ${otherIdentity.userId}`
      );
    })();
    await pool.end();
  }
});
