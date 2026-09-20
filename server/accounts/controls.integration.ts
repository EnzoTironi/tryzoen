import { z } from "zod";
import { env } from "@shared/environment/env";
import { query } from "@db/queries";
import { sql } from "drizzle-orm";
import assert from "node:assert/strict";
import { getAuth } from "@db/services/auth";
import { accessScopeForUser } from "@shared/identity/access-scope";
import { applicationOrigin } from "@shared/environment/origin";
import { channelChallengeSchema } from "@shared/identity/channel-auth";
import { ChannelAccounts } from "./index";
import {
  readLinkedChannelIdentities,
  revokeLinkedChannelIdentity,
} from "./controls";
const installationId = z.string().min(1).parse(env.TELEGRAM_BOT_ID);
assert.ok(installationId.startsWith("account-controls-"));
const userIds: string[] = [];
const cookieHeader = (response: Response) =>
  response.headers
    .getSetCookie()
    .map((cookie) => cookie.split(";")[0])
    .join("; ");
try {
  const accounts = ChannelAccounts;
  const auth = await getAuth();
  const origin = applicationOrigin();
  const authorize = async (
    senderId: string,
    purpose: "login" | "link",
    existingCookie = ""
  ) => {
    const request = (
      path: string,
      body:
        | {
            channel: "telegram";
            purpose: "login" | "link";
          }
        | {
            id: string;
          },
      cookie: string
    ) =>
      auth.handler(
        new Request(`${origin}/api/auth/channel-auth/${path}`, {
          method: "POST",
          headers: {
            origin,
            "content-type": "application/json",
            cookie,
          },
          body: JSON.stringify(body),
        })
      );
    const started = await request(
      "start",
      {
        channel: "telegram",
        purpose,
      },
      existingCookie
    );
    assert.equal(started.status, 200);
    const challenge = channelChallengeSchema.parse(await started.json());
    const token = new URL(challenge.deepLink).searchParams.get("start");
    assert.ok(token);
    const sender = {
      channel: "telegram" as const,
      installationId,
      senderId,
    };
    await accounts.confirmChallenge({
      token,
      sender,
    });
    const completed = await request(
      "complete",
      {
        id: challenge.id,
      },
      [existingCookie, cookieHeader(started)].filter(Boolean).join("; ")
    );
    assert.equal(completed.status, 200);
    assert.deepEqual(await completed.json(), {
      ok: true,
    });
    const identity = await accounts.getActiveIdentity(sender);
    if (purpose === "login") userIds.push(identity.userId);
    return {
      ...identity,
      cookie: [existingCookie, cookieHeader(completed)]
        .filter(Boolean)
        .join("; "),
    };
  };
  const owner = await authorize("account-owner", "login");
  const foreign = await authorize("other-owner", "login");
  const headers = new Headers({
    cookie: owner.cookie,
  });
  assert.equal(
    (
      await auth.api.getSession({
        headers,
      })
    )?.user.id,
    owner.userId
  );
  const scope = accessScopeForUser(`better-auth:${owner.userId}`);
  await (async function () {
    const rows = await query(
      sql`SELECT workspace_id FROM workspace_memberships WHERE user_id = ${scope.userId} AND workspace_id = ${scope.workspaceId}`
    );
    assert.equal(rows.length, 1);
  })();
  assert.deepEqual(await readLinkedChannelIdentities(headers), [
    {
      id: owner.id,
      channel: "telegram",
      senderId: "account-owner",
    },
  ]);
  await assert.rejects(readLinkedChannelIdentities(new Headers()), {
    reason: "unauthenticated",
  });
  await assert.rejects(revokeLinkedChannelIdentity(headers, foreign.id), {
    reason: "identity_inactive",
  });
  assert.deepEqual(await revokeLinkedChannelIdentity(headers, owner.id), {
    status: "last_access",
  });
  assert.ok(
    await auth.api.getSession({
      headers,
    })
  );
  const foreignHeaders = new Headers({
    cookie: foreign.cookie,
  });
  const foreignScope = accessScopeForUser(`better-auth:${foreign.userId}`);
  await (async function () {
    await query(
      sql`DELETE FROM workspace_memberships WHERE user_id = ${foreignScope.userId} AND workspace_id = ${foreignScope.workspaceId}`
    );
  })();
  assert.ok(
    await auth.api.getSession({
      headers: foreignHeaders,
    })
  );
  await assert.rejects(readLinkedChannelIdentities(foreignHeaders), {
    reason: "unauthenticated",
  });
  await assert.rejects(
    revokeLinkedChannelIdentity(foreignHeaders, foreign.id),
    {
      reason: "unauthenticated",
    }
  );
  const linked = await authorize("account-secondary", "link", owner.cookie);
  assert.equal(linked.userId, owner.userId);
  assert.equal((await readLinkedChannelIdentities(headers)).length, 2);
  assert.deepEqual(await revokeLinkedChannelIdentity(headers, owner.id), {
    status: "revoked",
  });
  assert.equal(
    await auth.api.getSession({
      headers,
    }),
    null
  );
  await assert.rejects(readLinkedChannelIdentities(headers), {
    reason: "unauthenticated",
  });
  await (async function () {
    const rows = await query(
      sql`SELECT id FROM public.channel_identity WHERE id = ${linked.id} AND revoked_at IS NULL`
    );
    assert.equal(rows.length, 1);
    const sessions = await query(
      sql`SELECT id FROM public.session WHERE "userId" = ${owner.userId}`
    );
    assert.equal(sessions.length, 0);
  })();
  process.stdout.write(
    "PASS real PostgreSQL + Better Auth: public channel login, canonical membership, own-only list, foreign rejection, last-access preservation, verified link, unlink and session invalidation\n"
  );
} finally {
  await (async function () {
    await query(
      sql`DELETE FROM public.channel_auth_challenge WHERE installation_id = ${installationId}`
    );
    await query(
      sql`DELETE FROM public.channel_identity WHERE installation_id = ${installationId}`
    );
    for (const userId of userIds) {
      await query(sql`DELETE FROM public."user" WHERE id = ${userId}`);
      const scope = accessScopeForUser(`better-auth:${userId}`);
      await query(sql`DELETE FROM workspaces WHERE id = ${scope.workspaceId}`);
    }
  })();
}
