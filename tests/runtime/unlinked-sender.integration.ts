import { onTestFinished } from "vitest";
import type { z } from "zod";
import { query } from "@db/queries";
import { sql } from "drizzle-orm";
import { randomBytes, randomUUID } from "node:crypto";
import { expect, test, vi } from "vitest";
import {
  ChannelAccountError,
  ChannelAccounts,
  type VerifiedSender,
} from "../../server/accounts";
import { accessScopeForUser } from "../../shared/identity/access-scope";
import { workspaceFixture } from "./workspace-fixture";
import { linkedIdentity } from "./identity-fixture";
import type * as Environment from "../../shared/environment/env";
vi.mock("@shared/environment", async (original) => {
  const loaded = await original<typeof Environment>();
  return {
    env: {
      ...loaded.env,
      ZOEN_REGISTRATION_MODE: "closed",
      ZOEN_BETA_IDENTITIES: ["telegram:100001"],
    },
  };
});
const secret = () => randomBytes(32).toString("base64url");
const reasonOf = <A>(effect: Promise<A>) =>
  Promise.try(async () => {
    return await effect.then(
      (value) => ({
        ok: true as const,
        value,
      }),
      (error: unknown) => ({
        ok: false as const,
        error,
      })
    );
  }).then((result) =>
    !result.ok && result.error instanceof ChannelAccountError
      ? result.error.reason
      : result
  );
const unknownSender = async function () {
  const sender = {
    channel: "telegram" as const,
    installationId: randomUUID(),
    senderId: "100001",
  };
  onTestFinished(async () => {
    await query(
      sql`DELETE FROM public.channel_auth_challenge WHERE installation_id = ${sender.installationId}`
    );
    await query(
      sql`DELETE FROM public.channel_pending_sender WHERE installation_id = ${sender.installationId}`
    );
    await query(
      sql`DELETE FROM public.channel_identity WHERE installation_id = ${sender.installationId}`
    );
  });
  return sender;
};
const removeUser = async (userId: string) => {
  await query(
    sql`DELETE FROM workspaces WHERE id = ${accessScopeForUser(`better-auth:${userId}`).workspaceId}`
  );
  await query(sql`DELETE FROM public."user" WHERE id = ${userId}`);
};
const userCount = async () => {
  const rows = await query<{
    count: number;
  }>(sql`SELECT count(*)::int AS count FROM public."user"`);
  return rows[0]?.count;
};
const identityRows = async (sender: z.output<typeof VerifiedSender>) => {
  return await query<{
    userId: string;
    revoked: boolean;
  }>(sql`SELECT user_id AS "userId", revoked_at IS NOT NULL AS revoked FROM public.channel_identity
      WHERE channel = ${sender.channel} AND installation_id = ${sender.installationId} AND sender_id = ${sender.senderId}`);
};
const pendingRows = async (sender: z.output<typeof VerifiedSender>) => {
  return await query<{
    contactCount: number;
    prompted: boolean;
  }>(sql`SELECT contact_count AS "contactCount", prompted_at IS NOT NULL AS prompted FROM public.channel_pending_sender
      WHERE channel = ${sender.channel} AND installation_id = ${sender.installationId} AND sender_id = ${sender.senderId}`);
};
test("an unknown private sender is recorded once per day and never becomes a user", async () => {
  const accounts = ChannelAccounts;
  const sender = await unknownSender();
  const before = await userCount();
  expect(await accounts.resolveVerifiedSender(sender)).toEqual({
    status: "unlinked",
    sender,
  });
  expect(await accounts.recordUnlinkedContact(sender)).toEqual({
    prompt: true,
  });
  expect(await accounts.recordUnlinkedContact(sender)).toEqual({
    prompt: false,
  });
  expect(await pendingRows(sender)).toEqual([
    {
      contactCount: 2,
      prompted: true,
    },
  ]);
  expect(await userCount()).toBe(before);
  expect(await identityRows(sender)).toEqual([]);
});
test("a login challenge cannot be confirmed by an unknown sender", async () => {
  const accounts = ChannelAccounts;
  const sender = await unknownSender();
  const browserSecret = secret();
  const before = await userCount();
  const login = await accounts.issueChallenge({
    purpose: "login",
    channel: sender.channel,
    installationId: sender.installationId,
    browserSecret,
  });
  expect(
    await reasonOf(
      accounts.previewChallenge({
        token: login.token,
        sender,
      })
    )
  ).toBe("sender_unlinked");
  expect(
    await reasonOf(
      accounts.confirmChallenge({
        token: login.token,
        sender,
      })
    )
  ).toBe("sender_unlinked");
  expect(
    await accounts.getChallengeStatus({
      challengeId: login.challengeId,
      browserSecret,
    })
  ).toEqual({
    status: "pending",
  });
  expect(await userCount()).toBe(before);
  expect(await identityRows(sender)).toEqual([]);
});
test("a Google user links a messenger through the browser challenge, then signs in with it", async () => {
  const accounts = ChannelAccounts;
  await using fixture = await workspaceFixture();
  const userId = fixture.actor.userId.slice("better-auth:".length);
  const sender = await unknownSender();
  await accounts.recordUnlinkedContact(sender);
  const linkSecret = secret();
  const link = await accounts.issueChallenge({
    purpose: "link",
    userId,
    sessionId: fixture.actor.authSessionId,
    browserSecret: linkSecret,
    channel: sender.channel,
    installationId: sender.installationId,
  });
  expect(
    await accounts.confirmChallenge({
      token: link.token,
      sender,
    })
  ).toEqual({
    challengeId: link.challengeId,
  });
  const linked = await accounts.consumeChallenge({
    challengeId: link.challengeId,
    browserSecret: linkSecret,
    currentSessionId: fixture.actor.authSessionId,
  });
  expect(linked).toMatchObject({
    userId,
    purpose: "link",
  });
  expect(await pendingRows(sender)).toEqual([]);
  expect(await identityRows(sender)).toEqual([
    {
      userId,
      revoked: false,
    },
  ]);
  const loginSecret = secret();
  const login = await accounts.issueChallenge({
    purpose: "login",
    channel: sender.channel,
    installationId: sender.installationId,
    browserSecret: loginSecret,
  });
  expect(
    await accounts.confirmChallenge({
      token: login.token,
      sender,
    })
  ).toEqual({
    challengeId: login.challengeId,
  });
  const signedIn = await accounts.consumeChallenge({
    challengeId: login.challengeId,
    browserSecret: loginSecret,
  });
  expect(signedIn).toMatchObject({
    userId,
    identityId: linked.identityId,
    purpose: "login",
  });
  expect(await accounts.resolveVerifiedSender(sender)).toEqual({
    status: "linked",
    identity: {
      id: linked.identityId,
      userId,
      ...sender,
    },
  });
});
test("confirmation is an idempotent receipt bound to the first confirming sender", async () => {
  const accounts = ChannelAccounts;
  const sender = await unknownSender();
  const identity = await linkedIdentity(sender);
  onTestFinished(async () => {
    await removeUser(identity.userId);
  });
  const browserSecret = secret();
  const login = await accounts.issueChallenge({
    purpose: "login",
    channel: sender.channel,
    installationId: sender.installationId,
    browserSecret,
  });
  const receipt = await accounts.confirmChallenge({
    token: login.token,
    sender,
  });
  expect(receipt).toEqual({
    challengeId: login.challengeId,
  });
  expect(
    await accounts.confirmChallenge({
      token: login.token,
      sender,
    })
  ).toEqual(receipt);
  expect(
    await reasonOf(
      accounts.confirmChallenge({
        token: login.token,
        sender: {
          ...sender,
          senderId: "100002",
        },
      })
    )
  ).toBe("invalid_challenge");
  expect(
    await reasonOf(
      accounts.consumeChallenge({
        challengeId: login.challengeId,
        browserSecret: secret(),
      })
    )
  ).toBe("invalid_challenge");
  expect(
    await accounts.getChallengeStatus({
      challengeId: login.challengeId,
      browserSecret,
    })
  ).toEqual({
    status: "confirmed",
  });
});
test("tampered and expired tokens are refused", async () => {
  const accounts = ChannelAccounts;
  const sender = await unknownSender();
  const identity = await linkedIdentity(sender);
  onTestFinished(async () => {
    await removeUser(identity.userId);
  });
  const browserSecret = secret();
  const login = await accounts.issueChallenge({
    purpose: "login",
    channel: sender.channel,
    installationId: sender.installationId,
    browserSecret,
  });
  const tampered = `${login.token.startsWith("A") ? "B" : "A"}${login.token.slice(1)}`;
  expect(
    await reasonOf(
      accounts.previewChallenge({
        token: tampered,
        sender,
      })
    )
  ).toBe("invalid_challenge");
  expect(
    await reasonOf(
      accounts.confirmChallenge({
        token: tampered,
        sender,
      })
    )
  ).toBe("invalid_challenge");
  await query(sql`UPDATE public.channel_auth_challenge
        SET created_at = clock_timestamp() - interval '6 minutes', expires_at = clock_timestamp() - interval '1 second'
        WHERE id = ${login.challengeId}`);
  expect(
    await reasonOf(
      accounts.confirmChallenge({
        token: login.token,
        sender,
      })
    )
  ).toBe("invalid_challenge");
  expect(
    await accounts.getChallengeStatus({
      challengeId: login.challengeId,
      browserSecret,
    })
  ).toEqual({
    status: "expired",
  });
});
test("a second person cannot link a messenger that already belongs to someone", async () => {
  const accounts = ChannelAccounts;
  await using fixture = await workspaceFixture();
  const sender = await unknownSender();
  const owner = await linkedIdentity(sender);
  onTestFinished(async () => {
    await removeUser(owner.userId);
  });
  const takeover = await accounts.issueChallenge({
    purpose: "link",
    userId: fixture.guest.userId.slice("better-auth:".length),
    sessionId: fixture.guest.authSessionId,
    browserSecret: secret(),
    channel: sender.channel,
    installationId: sender.installationId,
  });
  expect(
    await reasonOf(
      accounts.confirmChallenge({
        token: takeover.token,
        sender,
      })
    )
  ).toBe("account_conflict");
  expect(await identityRows(sender)).toEqual([
    {
      userId: owner.userId,
      revoked: false,
    },
  ]);
});
