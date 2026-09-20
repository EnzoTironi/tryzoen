import { query } from "@db/queries";
import { sql } from "drizzle-orm";
import { accessScopeForUser } from "../../shared/identity/access-scope";
import assert from "node:assert/strict";
import { randomBytes, randomUUID } from "node:crypto";
import { test, vi } from "vitest";
import {
  ChannelAccountError,
  ChannelAccounts,
} from "../../server/accounts/index.ts";
import {
  ChannelAuthPromptError,
  ChannelAuthPrompts,
} from "../../server/channel-auth/prompts.ts";
import { linkedIdentity } from "./identity-fixture";
const rejected = <A>(
  operation: Promise<A>,
  reason: ChannelAuthPromptError["reason"]
) =>
  operation.then(
    async () => assert.fail(`Expected ${reason}`),
    (failure: unknown) => {
      assert.ok(failure instanceof ChannelAuthPromptError);
      assert.equal(failure.reason, reason);
    }
  );
test("encrypted confirmation outbox is idempotent, fenced and never retries uncertain delivery", async () => {
  const accounts = ChannelAccounts;
  const prompts = ChannelAuthPrompts;
  const installationId = `prompts-${randomUUID()}`;
  const sender = {
    channel: "telegram" as const,
    installationId,
    senderId: "private-sender",
  };
  const issue = () =>
    accounts.issueChallenge({
      purpose: "login" as const,
      channel: "telegram",
      installationId,
      browserSecret: randomBytes(32).toString("base64url"),
    });
  const owner = await linkedIdentity(sender);
  try {
    const unavailableKey = await issue();
    const secrets = await import("@db/services/installation-secrets");
    const unavailable = vi
      .spyOn(secrets, "resolvedInstallationSecrets")
      .mockRejectedValueOnce(new Error("Unavailable encryption key"));
    await rejected(
      prompts.prepare({
        token: unavailableKey.token,
        sender,
        eventId: randomUUID(),
      }),
      "crypto_unavailable"
    );
    unavailable.mockRestore();
    const unqueued = await query(
      sql`SELECT challenge_id FROM public.channel_auth_prompt WHERE challenge_id = ${unavailableKey.challengeId}`
    );
    assert.equal(unqueued.length, 0);
    const challenge = await issue();
    const request = {
      token: challenge.token,
      sender,
      eventId: randomUUID(),
    };
    const beforeUsers = await query<{
      count: number;
    }>(sql`SELECT count(*)::int AS count FROM public."user"`);
    const receipts = await Promise.all(
      Array.from(
        {
          length: 8,
        },
        () => prompts.prepare(request)
      )
    );
    for (const receipt of receipts)
      assert.deepEqual(receipt, {
        challengeId: challenge.challengeId,
        status: "queued",
      });
    const afterUsers = await query<{
      count: number;
    }>(sql`SELECT count(*)::int AS count FROM public."user"`);
    assert.equal(afterUsers[0]?.count, beforeUsers[0]?.count);
    const encrypted = await query<{
      tokenCiphertext: string;
      count: number;
    }>(sql`SELECT token_ciphertext AS "tokenCiphertext", count(*) OVER ()::int AS count
        FROM public.channel_auth_prompt WHERE challenge_id = ${challenge.challengeId}`);
    const ciphertext = encrypted[0]?.tokenCiphertext;
    assert.ok(ciphertext);
    assert.equal(encrypted[0]?.count, 1);
    assert.notEqual(ciphertext, challenge.token);
    assert.equal(ciphertext.includes(challenge.token), false);
    assert.equal(ciphertext.includes(sender.senderId), false);
    await rejected(
      prompts.prepare({
        ...request,
        sender: {
          ...sender,
          senderId: "other-sender",
        },
      }),
      "conflict"
    );
    const other = await issue();
    await rejected(
      prompts.prepare({
        ...request,
        token: other.token,
      }),
      "conflict"
    );
    assert.deepEqual(
      await prompts.prepare({
        ...request,
        eventId: randomUUID(),
      }),
      {
        challengeId: challenge.challengeId,
        status: "queued",
      }
    );
    await rejected(prompts.pending(101), "invalid_input");
    assert.ok((await prompts.pending(100)).includes(challenge.challengeId));
    const claims = await Promise.all(
      Array.from(
        {
          length: 8,
        },
        () => prompts.claim(challenge.challengeId)
      )
    );
    assert.equal(claims.filter(Boolean).length, 1);
    const claimed = claims.find((value) => value !== null);
    assert.ok(claimed);
    assert.equal(claimed.token, challenge.token);
    assert.equal(claimed.senderId, sender.senderId);
    await rejected(
      prompts.checkLease({
        ...claimed.lease,
        leaseToken: randomUUID(),
      }),
      "lease_lost"
    );
    await rejected(
      prompts.markSent(
        {
          ...claimed.lease,
          leaseToken: randomUUID(),
        },
        "wrong-worker"
      ),
      "lease_lost"
    );
    await prompts.checkLease(claimed.lease);
    await prompts.markSent(claimed.lease, "synthetic-message-id");
    await rejected(prompts.markUncertain(claimed.lease), "lease_lost");
    assert.deepEqual(await prompts.prepare(request), {
      challengeId: challenge.challengeId,
      status: "sent",
    });
    assert.equal(await prompts.claim(challenge.challengeId), null);
    const sent = await query<{
      tokenCiphertext: string | null;
      attempts: number;
      providerMessageId: string;
    }>(sql`SELECT token_ciphertext AS "tokenCiphertext", attempts,
        provider_message_id AS "providerMessageId" FROM public.channel_auth_prompt WHERE challenge_id = ${challenge.challengeId}`);
    assert.equal(sent[0]?.tokenCiphertext, null);
    assert.equal(sent[0].attempts, 1);
    assert.equal(sent[0].providerMessageId, "synthetic-message-id");
    const expiredLease = await issue();
    const leaseRequest = {
      token: expiredLease.token,
      sender,
      eventId: randomUUID(),
    };
    await prompts.prepare(leaseRequest);
    const leased = await prompts.claim(expiredLease.challengeId);
    assert.ok(leased);
    await query(
      sql`UPDATE public.channel_auth_prompt SET lease_expires_at = clock_timestamp() - interval '1 second' WHERE challenge_id = ${expiredLease.challengeId}`
    );
    await rejected(prompts.checkLease(leased.lease), "lease_lost");
    assert.deepEqual(await prompts.prepare(leaseRequest), {
      challengeId: expiredLease.challengeId,
      status: "uncertain",
    });
    assert.equal(await prompts.claim(expiredLease.challengeId), null);
    await rejected(prompts.markSent(leased.lease, "late-result"), "lease_lost");
    const expiredChallenge = await issue();
    await prompts.prepare({
      token: expiredChallenge.token,
      sender,
      eventId: randomUUID(),
    });
    await query(
      sql`UPDATE public.channel_auth_challenge SET created_at = clock_timestamp() - interval '6 minutes', expires_at = clock_timestamp() - interval '1 second' WHERE id = ${expiredChallenge.challengeId}`
    );
    assert.equal(await prompts.claim(expiredChallenge.challengeId), null);
    const cancelled = await query<{
      status: string;
      tokenCiphertext: string | null;
    }>(
      sql`SELECT status, token_ciphertext AS "tokenCiphertext" FROM public.channel_auth_prompt WHERE challenge_id = ${expiredChallenge.challengeId}`
    );
    assert.equal(cancelled[0]?.status, "cancelled");
    assert.equal(cancelled[0].tokenCiphertext, null);
    const confirmedChallenge = await issue();
    await prompts.prepare({
      token: confirmedChallenge.token,
      sender,
      eventId: randomUUID(),
    });
    const confirmedLease = await prompts.claim(confirmedChallenge.challengeId);
    assert.ok(confirmedLease);
    await accounts.confirmChallenge({
      token: confirmedChallenge.token,
      sender,
    });
    await rejected(prompts.checkLease(confirmedLease.lease), "lease_lost");
    await query(
      sql`UPDATE public.channel_auth_prompt SET lease_expires_at = clock_timestamp() - interval '1 second' WHERE challenge_id = ${confirmedChallenge.challengeId}`
    );
    await prompts.pending(100);
    const unresolved = await query<{
      status: string;
      tokenCiphertext: string | null;
    }>(sql`SELECT status, token_ciphertext AS "tokenCiphertext"
          FROM public.channel_auth_prompt WHERE challenge_id = ${confirmedChallenge.challengeId}`);
    assert.equal(unresolved[0]?.status, "uncertain");
    assert.equal(unresolved[0].tokenCiphertext, null);
    assert.equal(await prompts.claim(confirmedChallenge.challengeId), null);
    for (const invalidation of ["confirm", "expire"] as const) {
      const inFlight = await issue();
      const inFlightRequest = {
        token: inFlight.token,
        sender,
        eventId: randomUUID(),
      };
      await prompts.prepare(inFlightRequest);
      const dispatch = await prompts.claim(inFlight.challengeId);
      assert.ok(dispatch);
      await prompts.checkLease(dispatch.lease);
      // Provider I/O may already be running when the challenge becomes inactive.
      if (invalidation === "confirm")
        await accounts.confirmChallenge({
          token: inFlight.token,
          sender,
        });
      else
        await query(
          sql`UPDATE public.channel_auth_challenge SET created_at = clock_timestamp() - interval '6 minutes', expires_at = clock_timestamp() - interval '1 second' WHERE id = ${inFlight.challengeId}`
        );
      await prompts.pending(100);
      assert.deepEqual(await prompts.prepare(inFlightRequest), {
        challengeId: inFlight.challengeId,
        status: "dispatching",
      });
      await rejected(prompts.checkLease(dispatch.lease), "lease_lost");
      await prompts.markSent(dispatch.lease, "synthetic-inflight-receipt");
      const settled = await query<{
        status: string;
        providerMessageId: string | null;
        tokenCiphertext: string | null;
      }>(sql`SELECT status,
            provider_message_id AS "providerMessageId", token_ciphertext AS "tokenCiphertext" FROM public.channel_auth_prompt WHERE challenge_id = ${inFlight.challengeId}`);
      assert.equal(settled[0]?.status, "sent");
      assert.equal(settled[0].providerMessageId, "synthetic-inflight-receipt");
      assert.equal(settled[0].tokenCiphertext, null);
      assert.equal(await prompts.claim(inFlight.challengeId), null);
    }
    for (const terminal of ["uncertain", "failed"] as const) {
      const item = await issue();
      const itemRequest = {
        token: item.token,
        sender,
        eventId: randomUUID(),
      };
      await prompts.prepare(itemRequest);
      const lease = await prompts.claim(item.challengeId);
      assert.ok(lease);
      if (terminal === "uncertain") await prompts.markUncertain(lease.lease);
      else await prompts.markRejected(lease.lease);
      assert.deepEqual(await prompts.prepare(itemRequest), {
        challengeId: item.challengeId,
        status: terminal,
      });
      assert.equal(await prompts.claim(item.challengeId), null);
    }
    const swapped = await issue();
    await prompts.prepare({
      token: swapped.token,
      sender,
      eventId: randomUUID(),
    });
    await query(
      sql`UPDATE public.channel_auth_prompt SET token_ciphertext = ${ciphertext} WHERE challenge_id = ${swapped.challengeId}`
    );
    assert.equal(await prompts.claim(swapped.challengeId), null);
    const tampered = await query<{
      status: string;
      tokenCiphertext: string | null;
    }>(
      sql`SELECT status, token_ciphertext AS "tokenCiphertext" FROM public.channel_auth_prompt WHERE challenge_id = ${swapped.challengeId}`
    );
    assert.equal(tampered[0]?.status, "failed");
    assert.equal(tampered[0].tokenCiphertext, null);
    const retained =
      await query(sql`SELECT challenge_id FROM public.channel_auth_prompt WHERE installation_id = ${installationId}
        AND status IN ('sent', 'uncertain', 'failed', 'cancelled') AND token_ciphertext IS NOT NULL`);
    assert.equal(retained.length, 0);
  } finally {
    await query(
      sql`DELETE FROM public.channel_auth_prompt WHERE installation_id = ${installationId}`
    );
    await query(
      sql`DELETE FROM public.channel_auth_challenge WHERE installation_id = ${installationId}`
    );
    await query(
      sql`DELETE FROM workspaces WHERE id = ${accessScopeForUser(`better-auth:${owner.userId}`).workspaceId}`
    );
    await query(sql`DELETE FROM public."user" WHERE id = ${owner.userId}`);
  }
});
test("prompt preparation delegates revoked link rejection to account preview", async () => {
  const accounts = ChannelAccounts;
  const prompts = ChannelAuthPrompts;
  const installationId = `revoked-prompt-${randomUUID()}`;
  const sender = {
    channel: "telegram" as const,
    installationId,
    senderId: "revoked-sender",
  };
  const owner = await linkedIdentity(sender);
  try {
    await query(sql`INSERT INTO public.channel_identity (id, channel, installation_id, sender_id, user_id, verified_at, created_at, updated_at)
        VALUES (${randomUUID()}, 'telegram', ${installationId}, 'backup', ${owner.userId}, clock_timestamp(), clock_timestamp(), clock_timestamp())`);
    await accounts.revokeIdentity({
      identityId: owner.id,
      userId: owner.userId,
    });
    const sessionId = randomUUID();
    await query(sql`INSERT INTO public.session (id, token, "userId", "expiresAt", "createdAt", "updatedAt")
        VALUES (${sessionId}, ${randomBytes(32).toString("base64url")}, ${owner.userId}, clock_timestamp() + interval '1 hour', clock_timestamp(), clock_timestamp())`);
    const challenge = await accounts.issueChallenge({
      purpose: "link" as const,
      channel: "telegram",
      installationId,
      browserSecret: randomBytes(32).toString("base64url"),
      userId: owner.userId,
      sessionId,
    });
    await Promise.try(async () =>
      prompts.prepare({
        token: challenge.token,
        sender,
        eventId: randomUUID(),
      })
    ).then(
      () => assert.fail("Revoked sender must not receive a link prompt"),
      (failure: unknown) => {
        assert.ok(failure instanceof ChannelAccountError);
        assert.equal(failure.reason, "identity_inactive");
      }
    );
    const rows = await query(
      sql`SELECT challenge_id FROM public.channel_auth_prompt WHERE challenge_id = ${challenge.challengeId}`
    );
    assert.equal(rows.length, 0);
  } finally {
    await query(
      sql`DELETE FROM public.channel_auth_prompt WHERE installation_id = ${installationId}`
    );
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
});
