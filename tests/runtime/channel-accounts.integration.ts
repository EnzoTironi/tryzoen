import { Client } from "pg";
import { env } from "@shared/environment/env";
import { query } from "@db/queries";
import { sql } from "drizzle-orm";
import { withTimeout, sleep } from "../../server/operations/async";
import { accessScopeForUser } from "../../shared/identity/access-scope";
import assert from "node:assert/strict";
import { randomBytes, randomUUID } from "node:crypto";
import { test } from "vitest";
import {
  ChannelAccounts,
  ChannelAccountError,
} from "../../server/accounts/index.ts";
import { linkedIdentity } from "./identity-fixture";
const secret = () => randomBytes(32).toString("base64url");
const rejected = <A>(
  operation: Promise<A>,
  reason: ChannelAccountError["reason"]
) =>
  operation.then(
    async () => assert.fail(`Expected ${reason}`),
    (error: unknown) => {
      assert.ok(error instanceof ChannelAccountError);
      assert.equal(error.reason, reason);
    }
  );
test("channel identities, browser binding, races and revocation against migrated PostgreSQL", async () => {
  const accounts = ChannelAccounts;
  const installationId = `test-${randomUUID()}`;
  const sender = {
    channel: "telegram",
    installationId,
    senderId: "12345",
  } as const;
  const userIds = new Set<string>();
  try {
    await Promise.try(async () => {
      await rejected(
        accounts.resolveVerifiedSender({
          ...sender,
          senderId: " 12345",
        }),
        "invalid_input"
      );
      const first = await linkedIdentity(sender);
      userIds.add(first.userId);
      assert.deepEqual(await accounts.resolveVerifiedSender(sender), {
        status: "linked",
        identity: first,
      });
      const browserSecret = secret();
      const challenge = await accounts.issueChallenge({
        purpose: "login" as const,
        channel: "telegram",
        installationId,
        browserSecret,
      });
      const previewSender = {
        ...sender,
        senderId: "preview-only",
      };
      await rejected(
        accounts.previewChallenge({
          token: challenge.token,
          sender: previewSender,
        }),
        "sender_unlinked"
      );
      const preview = await accounts.previewChallenge({
        token: challenge.token,
        sender,
      });
      assert.deepEqual(preview, {
        id: challenge.challengeId,
        purpose: "login",
        expiresAt: challenge.expiresAt,
      });
      assert.match(
        challenge.expiresAt,
        /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{3}Z$/u
      );
      const expiry = await query<{
        expiresAt: string;
        untouched: boolean;
      }>(sql`SELECT
          to_char(expires_at AT TIME ZONE 'UTC', 'YYYY-MM-DD"T"HH24:MI:SS.MS"Z"') AS "expiresAt",
          confirmed_at IS NULL AND identity_id IS NULL AND consumed_at IS NULL AS untouched
          FROM public.channel_auth_challenge WHERE id = ${challenge.challengeId}`);
      assert.equal(expiry[0]?.expiresAt, challenge.expiresAt);
      assert.equal(expiry[0].untouched, true);
      await rejected(
        accounts.getActiveIdentity(previewSender),
        "identity_inactive"
      );
      await rejected(
        accounts.previewChallenge({
          token: challenge.token,
          sender: {
            ...sender,
            channel: "kapso",
          },
        }),
        "invalid_challenge"
      );
      await rejected(
        accounts.previewChallenge({
          token: challenge.token,
          sender: {
            ...sender,
            installationId: "wrong",
          },
        }),
        "invalid_challenge"
      );
      await rejected(
        accounts.previewChallenge({
          token: secret(),
          sender,
        }),
        "invalid_challenge"
      );
      const statusInput = {
        challengeId: challenge.challengeId,
        browserSecret,
      };
      assert.deepEqual(await accounts.getChallengeStatus(statusInput), {
        status: "pending",
      });
      await rejected(
        accounts.getChallengeStatus({
          ...statusInput,
          browserSecret: secret(),
        }),
        "invalid_challenge"
      );
      await rejected(
        accounts.getChallengeStatus({
          ...statusInput,
          challengeId: randomUUID(),
        }),
        "invalid_challenge"
      );
      await rejected(
        accounts.consumeChallenge({
          challengeId: challenge.challengeId,
          browserSecret,
        }),
        "invalid_challenge"
      );
      await rejected(
        accounts.confirmChallenge({
          token: challenge.token,
          sender: {
            ...sender,
            installationId: "wrong-installation",
          },
        }),
        "invalid_challenge"
      );
      await accounts.confirmChallenge({
        token: challenge.token,
        sender,
      });
      assert.deepEqual(
        await accounts.confirmChallenge({
          token: challenge.token,
          sender,
        }),
        {
          challengeId: challenge.challengeId,
        }
      );
      await rejected(
        accounts.confirmChallenge({
          token: challenge.token,
          sender: {
            ...sender,
            senderId: "67890",
          },
        }),
        "invalid_challenge"
      );
      await rejected(
        accounts.consumeChallenge({
          challengeId: challenge.challengeId,
          browserSecret: secret(),
        }),
        "invalid_challenge"
      );
      assert.deepEqual(await accounts.getChallengeStatus(statusInput), {
        status: "confirmed",
      });
      assert.deepEqual(await accounts.getChallengeStatus(statusInput), {
        status: "confirmed",
      });
      await rejected(
        accounts.previewChallenge({
          token: challenge.token,
          sender,
        }),
        "invalid_challenge"
      );
      const consumes = await Promise.all(
        Array.from(
          {
            length: 8,
          },
          () =>
            Promise.try(async () =>
              accounts.consumeChallenge({
                challengeId: challenge.challengeId,
                browserSecret,
              })
            ).then(
              (value) => value,
              (error: unknown) => {
                assert.ok(error instanceof ChannelAccountError);
                assert.equal(error.reason, "invalid_challenge");
                return null;
              }
            )
        )
      );
      assert.equal(consumes.filter(Boolean).length, 1);
      assert.deepEqual(await accounts.getChallengeStatus(statusInput), {
        status: "consumed",
      });
      assert.equal(
        consumes.find(Boolean)?.principalId,
        `better-auth:${first.userId}`
      );
      const stored = await query<{
        token_hash: string;
        browser_secret_hash: string;
      }>(sql`SELECT token_hash, browser_secret_hash
        FROM public.channel_auth_challenge WHERE id = ${challenge.challengeId}`);
      assert.notEqual(stored[0]?.token_hash, challenge.token);
      assert.notEqual(stored[0]?.browser_secret_hash, browserSecret);
      await rejected(
        accounts.revokeIdentity({
          identityId: first.id,
          userId: first.userId,
        }),
        "last_access"
      );
      const other = await linkedIdentity({
        ...sender,
        senderId: "67890",
      });
      userIds.add(other.userId);
      await rejected(
        accounts.revokeIdentity({
          identityId: first.id,
          userId: other.userId,
        }),
        "identity_inactive"
      );
      const sessionId = randomUUID();
      await query(sql`INSERT INTO public.session (id, token, "userId", "expiresAt", "createdAt", "updatedAt")
        VALUES (${sessionId}, ${secret()}, ${first.userId}, clock_timestamp() + interval '1 hour', clock_timestamp(), clock_timestamp())`);
      const link = {
        userId: first.userId,
        sessionId,
      };
      await query(
        sql`UPDATE public.session SET "createdAt" = clock_timestamp() - interval '11 minutes' WHERE id = ${sessionId}`
      );
      await rejected(
        accounts.issueChallenge({
          purpose: "link" as const,
          userId: link.userId,
          sessionId: link.sessionId,
          channel: "telegram",
          installationId,
          browserSecret,
        }),
        "session_invalid"
      );
      const rejectedLinks = await query(
        sql`SELECT id FROM public.channel_auth_challenge WHERE requesting_session_id = ${sessionId}`
      );
      assert.equal(rejectedLinks.length, 0);
      await query(
        sql`UPDATE public.session SET "createdAt" = clock_timestamp() WHERE id = ${sessionId}`
      );
      const conflict = await accounts.issueChallenge({
        purpose: "link" as const,
        userId: link.userId,
        sessionId: link.sessionId,
        channel: "telegram",
        installationId,
        browserSecret,
      });
      await rejected(
        accounts.previewChallenge({
          token: conflict.token,
          sender: {
            ...sender,
            senderId: "67890",
          },
        }),
        "account_conflict"
      );
      await rejected(
        accounts.confirmChallenge({
          token: conflict.token,
          sender: {
            ...sender,
            senderId: "67890",
          },
        }),
        "account_conflict"
      );
      const linkedSender = {
        ...sender,
        channel: "kapso",
        senderId: "5511999999999",
      } as const;
      const linking = await accounts.issueChallenge({
        purpose: "link" as const,
        userId: link.userId,
        sessionId: link.sessionId,
        channel: "kapso",
        installationId,
        browserSecret,
      });
      assert.deepEqual(
        await accounts.previewChallenge({
          token: linking.token,
          sender: linkedSender,
        }),
        {
          id: linking.challengeId,
          purpose: "link",
          expiresAt: linking.expiresAt,
        }
      );
      await rejected(
        accounts.getActiveIdentity(linkedSender),
        "identity_inactive"
      );
      await accounts.confirmChallenge({
        token: linking.token,
        sender: linkedSender,
      });
      await rejected(
        accounts.consumeChallenge({
          challengeId: linking.challengeId,
          browserSecret,
          currentSessionId: "wrong",
        }),
        "session_invalid"
      );
      await rejected(
        accounts.getActiveIdentity(linkedSender),
        "identity_inactive"
      );
      const linked = await accounts.consumeChallenge({
        challengeId: linking.challengeId,
        browserSecret,
        currentSessionId: sessionId,
      });
      assert.equal(linked.userId, first.userId);
      const staleSender = {
        ...sender,
        senderId: "stale-link-proof",
      };
      const staleLink = await accounts.issueChallenge({
        purpose: "link" as const,
        userId: link.userId,
        sessionId: link.sessionId,
        channel: "telegram",
        installationId,
        browserSecret,
      });
      await query(
        sql`UPDATE public.session SET "createdAt" = clock_timestamp() - interval '11 minutes' WHERE id = ${sessionId}`
      );
      await rejected(
        accounts.previewChallenge({
          token: staleLink.token,
          sender: staleSender,
        }),
        "session_invalid"
      );
      await query(
        sql`UPDATE public.session SET "createdAt" = clock_timestamp(), "expiresAt" = clock_timestamp() - interval '1 second' WHERE id = ${sessionId}`
      );
      await rejected(
        accounts.previewChallenge({
          token: staleLink.token,
          sender: staleSender,
        }),
        "session_invalid"
      );
      await query(
        sql`UPDATE public.session SET "expiresAt" = clock_timestamp() + interval '1 hour', "userId" = ${other.userId} WHERE id = ${sessionId}`
      );
      await rejected(
        accounts.previewChallenge({
          token: staleLink.token,
          sender: staleSender,
        }),
        "session_invalid"
      );
      await query(
        sql`UPDATE public.session SET "userId" = ${first.userId} WHERE id = ${sessionId}`
      );
      await accounts.confirmChallenge({
        token: staleLink.token,
        sender: staleSender,
      });
      await rejected(
        accounts.getActiveIdentity(staleSender),
        "identity_inactive"
      );
      await query(
        sql`UPDATE public.session SET "createdAt" = clock_timestamp() - interval '11 minutes' WHERE id = ${sessionId}`
      );
      await rejected(
        accounts.consumeChallenge({
          challengeId: staleLink.challengeId,
          browserSecret,
          currentSessionId: sessionId,
        }),
        "session_invalid"
      );
      await rejected(
        accounts.getActiveIdentity(staleSender),
        "identity_inactive"
      );
      await query(
        sql`UPDATE public.session SET "createdAt" = clock_timestamp() WHERE id = ${sessionId}`
      );
      await query(
        sql`UPDATE public.channel_auth_challenge SET created_at = clock_timestamp() - interval '6 minutes', expires_at = clock_timestamp() - interval '1 second' WHERE id = ${staleLink.challengeId}`
      );
      await rejected(
        accounts.consumeChallenge({
          challengeId: staleLink.challengeId,
          browserSecret,
          currentSessionId: sessionId,
        }),
        "invalid_challenge"
      );
      await rejected(
        accounts.getActiveIdentity(staleSender),
        "identity_inactive"
      );
      const unlinkedSender = {
        ...sender,
        senderId: "unlinked-login-proof",
      };
      const unlinkedLogin = await accounts.issueChallenge({
        purpose: "login" as const,
        channel: "telegram",
        installationId,
        browserSecret,
      });
      const beforeProofUsers = await query<{
        count: number;
      }>(sql`SELECT count(*)::int AS count FROM public."user"`);
      await rejected(
        accounts.confirmChallenge({
          token: unlinkedLogin.token,
          sender: unlinkedSender,
        }),
        "sender_unlinked"
      );
      await rejected(
        accounts.getActiveIdentity(unlinkedSender),
        "identity_inactive"
      );
      const afterProofUsers = await query<{
        count: number;
      }>(sql`SELECT count(*)::int AS count FROM public."user"`);
      assert.equal(afterProofUsers[0]?.count, beforeProofUsers[0]?.count);
      assert.deepEqual(
        await accounts.getChallengeStatus({
          challengeId: unlinkedLogin.challengeId,
          browserSecret,
        }),
        {
          status: "pending",
        }
      );
      await rejected(
        accounts.consumeChallenge({
          challengeId: unlinkedLogin.challengeId,
          browserSecret,
        }),
        "invalid_challenge"
      );
      const expiring = await accounts.issueChallenge({
        purpose: "login" as const,
        channel: "telegram",
        installationId,
        browserSecret,
      });
      await query(
        sql`UPDATE public.channel_auth_challenge SET created_at = clock_timestamp() - interval '6 minutes', expires_at = clock_timestamp() - interval '1 second' WHERE id = ${expiring.challengeId}`
      );
      await rejected(
        accounts.confirmChallenge({
          token: expiring.token,
          sender,
        }),
        "invalid_challenge"
      );
      await rejected(
        accounts.previewChallenge({
          token: expiring.token,
          sender,
        }),
        "invalid_challenge"
      );
      const expiredConsumption = await accounts.issueChallenge({
        purpose: "login" as const,
        channel: "telegram",
        installationId,
        browserSecret,
      });
      await accounts.confirmChallenge({
        token: expiredConsumption.token,
        sender,
      });
      await query(
        sql`UPDATE public.channel_auth_challenge SET created_at = clock_timestamp() - interval '6 minutes', expires_at = clock_timestamp() - interval '1 second' WHERE id = ${expiredConsumption.challengeId}`
      );
      await rejected(
        accounts.consumeChallenge({
          challengeId: expiredConsumption.challengeId,
          browserSecret,
        }),
        "invalid_challenge"
      );
      assert.deepEqual(
        await accounts.getChallengeStatus({
          challengeId: expiredConsumption.challengeId,
          browserSecret,
        }),
        {
          status: "expired",
        }
      );
      const pending = await accounts.issueChallenge({
        purpose: "login" as const,
        channel: "telegram",
        installationId,
        browserSecret,
      });
      await accounts.confirmChallenge({
        token: pending.token,
        sender,
      });
      await accounts.revokeIdentity({
        identityId: first.id,
        userId: first.userId,
      });
      await rejected(accounts.getActiveIdentity(sender), "identity_inactive");
      await rejected(
        accounts.resolveVerifiedSender(sender),
        "identity_inactive"
      );
      await rejected(
        accounts.consumeChallenge({
          challengeId: pending.challengeId,
          browserSecret,
        }),
        "invalid_challenge"
      );
      assert.deepEqual(
        await accounts.getChallengeStatus({
          challengeId: pending.challengeId,
          browserSecret,
        }),
        {
          status: "expired",
        }
      );
      await rejected(
        accounts.previewChallenge({
          token: pending.token,
          sender,
        }),
        "invalid_challenge"
      );
      const revokedLogin = await accounts.issueChallenge({
        purpose: "login" as const,
        channel: "telegram",
        installationId,
        browserSecret,
      });
      await rejected(
        accounts.previewChallenge({
          token: revokedLogin.token,
          sender,
        }),
        "identity_inactive"
      );
      const sessions = await query(
        sql`SELECT id FROM public.session WHERE "userId" = ${first.userId}`
      );
      assert.equal(sessions.length, 0);
      await rejected(
        accounts.revokeIdentity({
          identityId: linked.identityId,
          userId: first.userId,
        }),
        "last_access"
      );
    });
  } finally {
    await query(
      sql`DELETE FROM public.channel_auth_challenge WHERE installation_id = ${installationId}`
    );
    await query(
      sql`DELETE FROM public.channel_identity WHERE installation_id = ${installationId}`
    );
    for (const id of userIds) {
      await query(
        sql`DELETE FROM workspaces WHERE id = ${accessScopeForUser(`better-auth:${id}`).workspaceId}`
      );
      await query(sql`DELETE FROM public."user" WHERE id = ${id}`);
    }
  }
}, 30_000);
test("session issuance serializes with revocation across real PostgreSQL connections", async () => {
  const separateConnection = new Client({
    connectionString: env.DATABASE_URL,
  });
  await separateConnection.connect();
  try {
    const accounts = ChannelAccounts;
    for (const order of ["before", "during", "after"] as const) {
      const installationId = `issuance-${randomUUID()}`;
      const browserSecret = secret();
      const challenge = await accounts.issueChallenge({
        purpose: "login" as const,
        channel: "telegram",
        installationId,
        browserSecret,
      });
      const sender = {
        channel: "telegram" as const,
        installationId,
        senderId: "linked-sender",
      };
      await linkedIdentity(sender);
      await accounts.confirmChallenge({
        token: challenge.token,
        sender,
      });
      const owner = await accounts.consumeChallenge({
        challengeId: challenge.challengeId,
        browserSecret,
      });
      try {
        // A second synthetic access path makes revocation legal; all storage is real.
        await query(sql`INSERT INTO public.channel_identity (id, channel, installation_id, sender_id, user_id, verified_at, created_at, updated_at)
          VALUES (${randomUUID()}, 'telegram', ${installationId}, 'backup', ${owner.userId}, clock_timestamp(), clock_timestamp(), clock_timestamp())`);
        const sessionId = randomUUID();
        const createSession = async () => {
          await separateConnection.query(
            `INSERT INTO public.session (id, token, "userId", "expiresAt", "createdAt", "updatedAt") VALUES ($1, $2, $3, clock_timestamp() + interval '1 hour', clock_timestamp(), clock_timestamp())`,
            [sessionId, secret(), owner.userId]
          );
          return sessionId;
        };
        if (order === "before") {
          await accounts.revokeIdentity(owner);
          await rejected(
            accounts.withLoginSession(owner, createSession),
            "identity_inactive"
          );
        } else if (order === "after") {
          assert.equal(
            await accounts.withLoginSession(owner, createSession),
            sessionId
          );
          const inserted = await query(
            sql`SELECT id FROM public.session WHERE id = ${sessionId}`
          );
          assert.equal(inserted.length, 1);
          await accounts.revokeIdentity(owner);
        } else {
          const entered = Promise.withResolvers<void>();
          const release = Promise.withResolvers<void>();
          const finalization = accounts.withLoginSession(owner, async () => {
            entered.resolve();
            await release.promise;
            return createSession();
          });
          await entered.promise;
          const revocation = accounts.revokeIdentity(owner);
          const settled = Promise.all([finalization, revocation]);
          try {
            await withTimeout(async () => {
              for (;;) {
                const [row] = await query<{
                  waiting: boolean;
                }>(
                  sql`SELECT EXISTS (SELECT 1 FROM pg_locks WHERE locktype = 'advisory' AND classid = 724193 AND objid = 1 AND NOT granted) AS waiting`
                );
                if (row?.waiting) return;
                await sleep(10);
              }
            }, 5000);
          } finally {
            release.resolve();
          }
          assert.equal((await settled)[0], sessionId);
        }
        const sessions = await query(
          sql`SELECT id FROM public.session WHERE "userId" = ${owner.userId}`
        );
        assert.equal(sessions.length, 0);
      } finally {
        await query(
          sql`DELETE FROM public.channel_auth_challenge WHERE installation_id = ${installationId}`
        );
        await query(
          sql`DELETE FROM public.channel_identity WHERE installation_id = ${installationId}`
        );
        await query(
          sql`DELETE FROM workspaces WHERE id = ${accessScopeForUser(`better-auth:${owner.userId}`).workspaceId}`
        );
        await query(sql`DELETE FROM public."user" WHERE id = ${owner.userId}`);
      }
    }
  } finally {
    await separateConnection.end();
  }
});
