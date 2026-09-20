import { onTestFinished } from "vitest";
import { query } from "@db/queries";
import { sql } from "drizzle-orm";
import { randomUUID } from "node:crypto";
import { expect, test } from "vitest";
import { readChannelResponseContext } from "../../agent/lib/channel-response";
import { Messaging } from "../../server/messaging";
import { accessScopeForUser } from "../../shared/identity/access-scope";
import { linkedIdentity } from "./identity-fixture";
const fixture = async () => {
  const identity = await linkedIdentity({
    channel: "telegram",
    installationId: randomUUID(),
    senderId: randomUUID(),
  });
  onTestFinished(async () => {
    await Promise.try(async () =>
      query(
        sql`DELETE FROM workspaces WHERE id = ${accessScopeForUser(`better-auth:${identity.userId}`).workspaceId}`
      )
    ).then(() =>
      query(sql`DELETE FROM public."user" WHERE id = ${identity.userId}`)
    );
  });
  return {
    sql,
    messaging: Messaging,
    input: {
      identityId: identity.id,
      sessionId: randomUUID(),
      sourceMessageId: randomUUID(),
      requestId: randomUUID(),
      turnId: randomUUID(),
      decision: "approve" as const,
    },
  };
};
test("response source requires accepted inbox state in the exact session", async () => {
  const { messaging, input } = await fixture();
  expect(
    await Promise.try(async () => readChannelResponseContext(input)).then(
      (value) => ({
        ok: true as const,
        value,
      }),
      (error: unknown) => ({
        ok: false as const,
        error,
      })
    )
  ).toMatchObject({
    ok: false,
  });
  await messaging.accept({
    identityId: input.identityId,
    eventId: randomUUID(),
    sourceMessageId: input.sourceMessageId,
    payload: {
      text: "pode fazer",
      sourceOccurredAtMs: 1788880000000,
    },
  });
  expect(
    await Promise.try(async () => readChannelResponseContext(input)).then(
      (value) => ({
        ok: true as const,
        value,
      }),
      (error: unknown) => ({
        ok: false as const,
        error,
      })
    )
  ).toMatchObject({
    ok: false,
  });
  const lease = await messaging.claimInbox({
    identityId: input.identityId,
    leaseSeconds: 60,
  });
  if (!lease) throw new Error("Expected a claimed synthetic inbox fixture");
  expect(
    await Promise.try(async () => readChannelResponseContext(input)).then(
      (value) => ({
        ok: true as const,
        value,
      }),
      (error: unknown) => ({
        ok: false as const,
        error,
      })
    )
  ).toMatchObject({
    ok: false,
  });
  await messaging.markAccepted({
    lease: {
      id: lease.id,
      identityId: lease.identityId,
      leaseToken: lease.leaseToken,
    },
    receipt: {
      status: "accepted",
      sessionId: input.sessionId,
    },
  });
  expect((await readChannelResponseContext(input)).source).toEqual({
    identityId: input.identityId,
    sessionId: input.sessionId,
    sourceMessageId: input.sourceMessageId,
    text: "pode fazer",
    sourceOccurredAtMs: 1788880000000,
  });
  expect(
    await Promise.try(async () =>
      readChannelResponseContext({
        ...input,
        sessionId: randomUUID(),
      })
    ).then(
      (value) => ({
        ok: true as const,
        value,
      }),
      (error: unknown) => ({
        ok: false as const,
        error,
      })
    )
  ).toMatchObject({
    ok: false,
  });
  expect(
    await Promise.try(async () =>
      readChannelResponseContext({
        ...input,
        sourceMessageId: randomUUID(),
      })
    ).then(
      (value) => ({
        ok: true as const,
        value,
      }),
      (error: unknown) => ({
        ok: false as const,
        error,
      })
    )
  ).toMatchObject({
    ok: false,
  });
});
test("accepted sources without provider occurrence time do not acquire consent", async () => {
  const { messaging, input } = await fixture();
  await messaging.accept({
    identityId: input.identityId,
    eventId: randomUUID(),
    sourceMessageId: input.sourceMessageId,
    payload: {
      text: "pode fazer",
    },
  });
  const lease = await messaging.claimInbox({
    identityId: input.identityId,
    leaseSeconds: 60,
  });
  if (!lease) throw new Error("Expected a claimed synthetic inbox fixture");
  await messaging.markAccepted({
    lease: {
      id: lease.id,
      identityId: lease.identityId,
      leaseToken: lease.leaseToken,
    },
    receipt: {
      status: "accepted",
      sessionId: input.sessionId,
    },
  });
  expect(
    await Promise.try(async () => readChannelResponseContext(input)).then(
      (value) => ({
        ok: true as const,
        value,
      }),
      (error: unknown) => ({
        ok: false as const,
        error,
      })
    )
  ).toMatchObject({
    ok: false,
    error: {
      reason: "invalid_source",
    },
  });
});
test("revocation and ambiguous accepted source records reject response context", async () => {
  const { messaging, input } = await fixture();
  for (let index = 0; index < 2; index++) {
    await messaging.accept({
      identityId: input.identityId,
      eventId: randomUUID(),
      sourceMessageId: input.sourceMessageId,
      payload: {
        text: "pode fazer",
        sourceOccurredAtMs: 1788880000000,
      },
    });
    const lease = await messaging.claimInbox({
      identityId: input.identityId,
      leaseSeconds: 60,
    });
    if (!lease) throw new Error("Expected a claimed synthetic inbox fixture");
    await messaging.markAccepted({
      lease: {
        id: lease.id,
        identityId: lease.identityId,
        leaseToken: lease.leaseToken,
      },
      receipt: {
        status: "accepted",
        sessionId: input.sessionId,
      },
    });
  }
  expect(
    await Promise.try(async () => readChannelResponseContext(input)).then(
      (value) => ({
        ok: true as const,
        value,
      }),
      (error: unknown) => ({
        ok: false as const,
        error,
      })
    )
  ).toMatchObject({
    ok: false,
    error: {
      reason: "invalid_source",
    },
  });
  await query(
    sql`UPDATE channel_identity SET revoked_at = clock_timestamp() WHERE id = ${input.identityId}`
  );
  expect(
    await Promise.try(async () => readChannelResponseContext(input)).then(
      (value) => ({
        ok: true as const,
        value,
      }),
      (error: unknown) => ({
        ok: false as const,
        error,
      })
    )
  ).toMatchObject({
    ok: false,
    error: {
      reason: "identity_inactive",
    },
  });
});
