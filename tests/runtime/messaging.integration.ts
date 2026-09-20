import { onTestFinished } from "vitest";
import { query } from "@db/queries";
import { sql } from "drizzle-orm";
import { sleep } from "../../server/operations/async";
import { randomUUID } from "node:crypto";
import { expect, test } from "vitest";
import {
  IdentityInactive,
  InvalidMessage,
  LeaseLost,
  OutboxResolutionRejected,
  PayloadConflict,
  Messaging,
  type Lease,
} from "../../server/messaging";
const fixture = async function (
  body: (
    messaging: typeof Messaging,
    sql: typeof import("drizzle-orm").sql,
    identityId: string
  ) => Promise<void>
) {
  const userId = randomUUID();
  const identityId = randomUUID();
  await (async () => {
    const resource = await query(sql`INSERT INTO "user" (id, name, email)
      VALUES (${userId}, 'Messaging proof', ${`${userId}@example.invalid`})`);
    onTestFinished(async () => {
      await (() => query(sql`DELETE FROM "user" WHERE id = ${userId}`))();
    });
    return resource;
  })();
  await query(sql`INSERT INTO channel_identity
    (id, channel, installation_id, sender_id, user_id)
    VALUES (${identityId}, 'telegram', 'messaging-proof', ${identityId}, ${userId})`);
  await body(Messaging, sql, identityId);
};
function run(body: Parameters<typeof fixture>[0]) {
  return fixture(body);
}
test("native conversations separate private history and groups while sharing one group across senders", () =>
  run(async (messaging, database, identityId) => {
    const otherIdentity = randomUUID();
    await query(database`INSERT INTO channel_identity (id, channel, installation_id, sender_id, user_id)
        SELECT ${otherIdentity}, channel, installation_id, ${otherIdentity}, user_id
        FROM channel_identity WHERE id = ${identityId}`);
    const firstGroup = "group:telegram:messaging-proof:-101";
    const otherGroup = "group:telegram:messaging-proof:-202";
    const cases = [
      {
        identity: identityId,
        scope: undefined,
        address: identityId,
      },
      {
        identity: identityId,
        scope: firstGroup,
        address: firstGroup,
      },
      {
        identity: otherIdentity,
        scope: firstGroup,
        address: firstGroup,
      },
      {
        identity: identityId,
        scope: otherGroup,
        address: otherGroup,
      },
    ];
    for (const scenario of cases) {
      const text = "Synthetic conversation isolation check";
      const payload = scenario.scope
        ? {
            text,
            conversationScope: scenario.scope,
          }
        : {
            text,
          };
      await messaging.accept({
        identityId: scenario.identity,
        eventId: randomUUID(),
        sourceMessageId: randomUUID(),
        payload,
      });
      const first = await messaging.claimInbox({
        identityId: scenario.identity,
        leaseSeconds: 30,
      });
      if (!first) throw new Error("Missing conversation claim");
      expect(first.nativeInput?.address).toBe(scenario.address);
      await query(
        database`UPDATE channel_inbox SET lease_expires_at = now() - interval '1 second' WHERE id = ${first.id}`
      );
      const recovered = await messaging.claimInbox({
        identityId: scenario.identity,
        leaseSeconds: 30,
      });
      if (!recovered) throw new Error("Missing recovered conversation claim");
      expect(recovered.nativeInput).toEqual(first.nativeInput);
      await messaging.markAccepted({
        lease: {
          identityId: scenario.identity,
          id: recovered.id,
          leaseToken: recovered.leaseToken,
        },
        receipt: {
          status: "accepted",
          sessionId: `synthetic:${scenario.address}`,
        },
      });
    }
  }));
test("input response fence survives concurrent replay and refuses uncertain redispatch", () =>
  run(async (messaging, database, identityId) => {
    const sessionId = randomUUID();
    const input = {
      identityId,
      sessionId,
      sourceMessageId: "consent-source",
      requestId: "approval-1",
      revision: "a".repeat(64),
      decision: "approve" as const,
      turnId: "user-turn",
    };
    expect(
      await Promise.try(async () =>
        messaging.claimChannelInputResponse(input)
      ).then(
        () => {
          throw new Error("Expected the operation to reject.");
        },
        (error: unknown) => error
      )
    ).toBeInstanceOf(InvalidMessage);
    await messaging.accept({
      identityId,
      eventId: "consent-event",
      sourceMessageId: input.sourceMessageId,
      payload: {
        text: "pode",
        sourceOccurredAtMs: 1_788_900_000_000,
      },
    });
    expect(
      await Promise.try(async () =>
        messaging.claimChannelInputResponse(input)
      ).then(
        () => {
          throw new Error("Expected the operation to reject.");
        },
        (error: unknown) => error
      )
    ).toBeInstanceOf(InvalidMessage);
    const acceptedSource = await messaging.claimInbox({
      identityId,
      leaseSeconds: 30,
    });
    if (!acceptedSource) throw new Error("Missing source claim");
    await messaging.markAccepted({
      lease: {
        identityId,
        id: acceptedSource.id,
        leaseToken: acceptedSource.leaseToken,
      },
      receipt: {
        status: "accepted",
        sessionId,
      },
    });
    const results = await Promise.all(
      Array.from(
        {
          length: 12,
        },
        () => messaging.claimChannelInputResponse(input)
      )
    );
    expect(results.filter((result) => result.kind === "acquired")).toHaveLength(
      1
    );
    expect(
      results.filter((result) => result.kind === "duplicate")
    ).toHaveLength(11);
    expect(new Set(results.map((result) => result.id)).size).toBe(1);
    const first = results[0];
    if (!first) throw new Error("Missing response claim");
    for (const changed of [
      {
        decision: "cancel" as const,
      },
      {
        revision: "b".repeat(64),
      },
      {
        turnId: "later-turn",
      },
    ]) {
      expect(
        (
          await messaging.claimChannelInputResponse({
            ...input,
            ...changed,
          })
        ).kind
      ).toBe("conflict");
    }
    expect(
      await messaging.markChannelInputResponse({
        id: first.id,
        status: "uncertain",
      })
    ).toBe(true);
    expect(
      await messaging.markChannelInputResponse({
        id: first.id,
        status: "accepted",
      })
    ).toBe(false);
    const persisted = await messaging.claimChannelInputResponse(input);
    expect(persisted).toEqual({
      kind: "duplicate",
      id: first.id,
      status: "uncertain",
    });
    const otherRequest = await messaging.claimChannelInputResponse({
      ...input,
      requestId: "approval-2",
    });
    expect(otherRequest.kind).toBe("acquired");
    expect(
      await messaging.markChannelInputResponse({
        id: otherRequest.id,
        status: "accepted",
      })
    ).toBe(true);
    expect(
      (
        await messaging.claimChannelInputResponse({
          ...input,
          requestId: "approval-2",
        })
      ).status
    ).toBe("accepted");
    await query(
      database`UPDATE channel_identity SET revoked_at = clock_timestamp() WHERE id = ${identityId}`
    );
    expect(
      await Promise.try(async () =>
        messaging.claimChannelInputResponse(input)
      ).then(
        () => {
          throw new Error("Expected the operation to reject.");
        },
        (error: unknown) => error
      )
    ).toBeInstanceOf(IdentityInactive);
  }));
test("different accepted sources cannot race approval and cancellation of one request", () =>
  run(async (messaging, _sql, identityId) => {
    const sessionId = randomUUID();
    for (const sourceMessageId of ["yes", "no"]) {
      await messaging.accept({
        identityId,
        eventId: sourceMessageId,
        sourceMessageId,
        payload: {
          text: sourceMessageId,
        },
      });
      const source = await messaging.claimInbox({
        identityId,
        leaseSeconds: 30,
      });
      if (!source) throw new Error("Missing source claim");
      await messaging.markAccepted({
        lease: {
          identityId,
          id: source.id,
          leaseToken: source.leaseToken,
        },
        receipt: {
          status: "accepted",
          sessionId,
        },
      });
    }
    const common = {
      identityId,
      sessionId,
      requestId: "request",
      revision: "a".repeat(64),
      turnId: "turn",
    };
    const results = await Promise.all([
      messaging.claimChannelInputResponse({
        ...common,
        sourceMessageId: "yes",
        decision: "approve",
      }),
      messaging.claimChannelInputResponse({
        ...common,
        sourceMessageId: "no",
        decision: "cancel",
      }),
    ]);
    expect(results.map((result) => result.kind).toSorted()).toEqual([
      "acquired",
      "conflict",
    ]);
    expect(results[0].id).toBe(results[1].id);
  }));
test("concurrent duplicate ingress commits one canonical receipt and rejects changed payload", () =>
  run(async (messaging, database, identityId) => {
    const first = {
      identityId,
      eventId: "event-1",
      sourceMessageId: "source-event-1",
      payload: {
        text: "hello",
        sourceOccurredAtMs: 1_788_900_000_000,
        attachments: [
          {
            id: "file-1",
            mediaType: "image/png",
            name: "photo",
          },
        ],
      },
    };
    const reordered = {
      identityId,
      eventId: "event-1",
      sourceMessageId: "source-event-1",
      payload: {
        attachments: [
          {
            name: "photo",
            mediaType: "image/png",
            id: "file-1",
          },
        ],
        text: "hello",
        sourceOccurredAtMs: 1_788_900_000_000,
      },
    };
    const receipts = await Promise.all(
      Array.from(
        {
          length: 12,
        },
        (_, index) => messaging.accept(index % 2 ? first : reordered)
      )
    );
    expect(new Set(receipts.map((receipt) => receipt.id)).size).toBe(1);
    const rows = await query<{
      count: number;
    }>(database`SELECT count(*)::int AS count
      FROM channel_inbox WHERE identity_id = ${identityId}`);
    expect(rows[0]?.count).toBe(1);
    const conflict = await Promise.try(async () =>
      messaging.accept({
        ...first,
        payload: {
          text: "changed",
        },
      })
    ).then(
      () => {
        throw new Error("Expected the operation to reject.");
      },
      (error: unknown) => error
    );
    expect(conflict).toBeInstanceOf(PayloadConflict);
    const original = receipts[0];
    if (!original) throw new Error("Missing receipt");
    expect(original.status).toBe("queued");
    expect(original.sourceMessageId).toBe("source-event-1");
    expect(
      await Promise.try(async () =>
        messaging.accept({
          ...first,
          sourceMessageId: "different-provider-message",
        })
      ).then(
        () => {
          throw new Error("Expected the operation to reject.");
        },
        (error: unknown) => error
      )
    ).toBeInstanceOf(PayloadConflict);
    const persisted = await query<{
      source: string;
    }>(
      database`SELECT source_message_id AS source FROM channel_inbox WHERE id = ${original.id}`
    );
    expect(persisted[0]?.source).toBe("source-event-1");
    const claim = await messaging.claimInbox({
      identityId,
      leaseSeconds: 30,
    });
    expect(claim?.sourceMessageId).toBe("source-event-1");
    expect(claim?.payload.sourceOccurredAtMs).toBe(1_788_900_000_000);
    expect(
      await Promise.try(async () =>
        messaging.accept({
          ...first,
          payload: {
            ...first.payload,
            sourceOccurredAtMs: 1_788_900_001_000,
          },
        })
      ).then(
        () => {
          throw new Error("Expected the operation to reject.");
        },
        (error: unknown) => error
      )
    ).toBeInstanceOf(PayloadConflict);
    expect(claim?.key).toBe("event-1");
    expect((await messaging.accept(first)).id).toBe(original.id);
  }));
test("rejects hash/selector injection and invalid payload before persistence", () =>
  run(async (messaging, database, identityId) => {
    const input = {
      identityId,
      eventId: "invalid",
      sourceMessageId: "source-invalid",
      payload: {
        text: "hello",
      },
      eventHash: "0".repeat(64),
    };
    expect(
      await Promise.try(async () => messaging.accept(input)).then(
        () => {
          throw new Error("Expected the operation to reject.");
        },
        (error: unknown) => error
      )
    ).toBeInstanceOf(InvalidMessage);
    expect(
      await Promise.try(async () =>
        messaging.accept({
          identityId,
          eventId: "empty",
          sourceMessageId: "source-empty",
          payload: {},
        })
      ).then(
        () => {
          throw new Error("Expected the operation to reject.");
        },
        (error: unknown) => error
      )
    ).toBeInstanceOf(InvalidMessage);
    const unsafe = {
      identityId,
      eventId: "url",
      sourceMessageId: "source-url",
      payload: {
        text: "hello",
        url: "https://example.invalid/private",
      },
    };
    expect(
      await Promise.try(async () => messaging.accept(unsafe)).then(
        () => {
          throw new Error("Expected the operation to reject.");
        },
        (error: unknown) => error
      )
    ).toBeInstanceOf(InvalidMessage);
    const rows = await query(
      database`SELECT id FROM channel_inbox WHERE identity_id = ${identityId}`
    );
    expect(rows).toHaveLength(0);
  }));
test("claims FIFO once per identity under concurrency and fences completion", () =>
  run(async (messaging, _sql, identityId) => {
    const first = await messaging.accept({
      identityId,
      eventId: "first",
      sourceMessageId: "source-first",
      payload: {
        text: "one",
      },
    });
    const second = await messaging.accept({
      identityId,
      eventId: "second",
      sourceMessageId: "source-second",
      payload: {
        text: "two",
      },
    });
    const claims = await Promise.all(
      Array.from(
        {
          length: 10,
        },
        () =>
          messaging.claimInbox({
            identityId,
            leaseSeconds: 30,
          })
      )
    );
    const winners = claims.filter((claim) => claim !== null);
    expect(winners).toHaveLength(1);
    const winner = winners[0];
    if (!winner) throw new Error("Expected a lease holder");
    expect(winner.id).toBe(first.id);
    const lease: Lease = {
      identityId,
      id: winner.id,
      leaseToken: winner.leaseToken,
    };
    const forged = {
      ...lease,
      leaseToken: randomUUID(),
    };
    expect(
      await Promise.try(async () =>
        messaging.markAccepted({
          lease: forged,
          receipt: {
            status: "accepted",
            sessionId: "storage-fixture-session",
          },
        })
      ).then(
        () => {
          throw new Error("Expected the operation to reject.");
        },
        (error: unknown) => error
      )
    ).toBeInstanceOf(LeaseLost);
    const completed = await messaging.markAccepted({
      lease,
      receipt: {
        status: "accepted",
        sessionId: "storage-fixture-session",
      },
    });
    expect(completed.status).toBe("accepted");
    expect(completed.resultId).toBe("storage-fixture-session");
    expect(
      await Promise.try(async () => messaging.checkInboxLease(lease)).then(
        () => {
          throw new Error("Expected the operation to reject.");
        },
        (error: unknown) => error
      )
    ).toBeInstanceOf(LeaseLost);
    expect(
      (
        await messaging.claimInbox({
          identityId,
          leaseSeconds: 30,
        })
      )?.id
    ).toBe(second.id);
  }));
test("an input without native protocol evidence remains uncertain and blocks later input", () =>
  run(async (messaging, database, identityId) => {
    await messaging.accept({
      identityId,
      eventId: "first",
      sourceMessageId: "source-first",
      payload: {
        text: "one",
      },
    });
    await messaging.accept({
      identityId,
      eventId: "second",
      sourceMessageId: "source-second",
      payload: {
        text: "two",
      },
    });
    const claim = await messaging.claimInbox({
      identityId,
      leaseSeconds: 30,
    });
    if (!claim) throw new Error("Expected a lease holder");
    await query(database`UPDATE channel_inbox SET native_input = NULL, lease_expires_at = clock_timestamp() - interval '1 second'
      WHERE id = ${claim.id}`);
    const lease = {
      identityId,
      id: claim.id,
      leaseToken: claim.leaseToken,
    };
    expect(
      await Promise.try(async () =>
        messaging.markAccepted({
          lease,
          receipt: {
            status: "accepted",
            sessionId: "too-late",
          },
        })
      ).then(
        () => {
          throw new Error("Expected the operation to reject.");
        },
        (error: unknown) => error
      )
    ).toBeInstanceOf(LeaseLost);
    expect(
      await messaging.claimInbox({
        identityId,
        leaseSeconds: 30,
      })
    ).toBeNull();
    expect(
      await messaging.claimInbox({
        identityId,
        leaseSeconds: 30,
      })
    ).toBeNull();
    const state = await messaging.inspectInbox(identityId);
    expect(state.uncertain).toHaveLength(1);
    expect(state.uncertain[0]).toMatchObject({
      id: claim.id,
      attempts: 1,
      lastError: "lease_expired",
      leaseToken: null,
    });
    expect(state.counts).toContainEqual({
      status: "queued",
      count: 1,
    });
  }));
test("outbox deduplicates intent, fences sends, and keeps lanes independent", () =>
  run(async (messaging, _sql, identityId) => {
    const intent = {
      identityId,
      deliveryKey: "reply-1",
      payload: {
        text: "reply",
      },
    };
    const receipts = await Promise.all([
      messaging.enqueue(intent),
      messaging.enqueue(intent),
    ]);
    expect(receipts[0].id).toBe(receipts[1].id);
    expect(receipts.every((receipt) => receipt.sourceMessageId === null)).toBe(
      true
    );
    expect(
      await Promise.try(async () =>
        messaging.enqueue({
          ...intent,
          payload: {
            text: "changed",
          },
        })
      ).then(
        () => {
          throw new Error("Expected the operation to reject.");
        },
        (error: unknown) => error
      )
    ).toBeInstanceOf(PayloadConflict);
    await messaging.accept({
      identityId,
      eventId: "input",
      sourceMessageId: "source-input",
      payload: {
        text: "input",
      },
    });
    const incoming = await messaging.claimInbox({
      identityId,
      leaseSeconds: 30,
    });
    const outgoing = await messaging.claimOutbox({
      identityId,
      leaseSeconds: 30,
    });
    expect(incoming).not.toBeNull();
    if (!outgoing)
      throw new Error("Expected outgoing lease independently of inbox");
    expect(outgoing.sourceMessageId).toBeNull();
    const lease = {
      identityId,
      id: outgoing.id,
      leaseToken: outgoing.leaseToken,
    };
    const completed = await messaging.markSent({
      lease,
      receipt: {
        status: "sent",
        providerMessageId: "storage-fixture-provider-id",
      },
    });
    expect(completed.status).toBe("sent");
    expect(completed.sourceMessageId).toBeNull();
    expect(completed.resultId).toBe("storage-fixture-provider-id");
    expect(
      await Promise.try(async () =>
        messaging.markSent({
          lease,
          receipt: {
            status: "sent",
            providerMessageId: "repeated",
          },
        })
      ).then(
        () => {
          throw new Error("Expected the operation to reject.");
        },
        (error: unknown) => error
      )
    ).toBeInstanceOf(LeaseLost);
  }));
test("expired outbox is uncertain, cannot resend, and blocks later output", () =>
  run(async (messaging, database, identityId) => {
    await messaging.enqueue({
      identityId,
      deliveryKey: "first",
      payload: {
        text: "one",
      },
    });
    await messaging.enqueue({
      identityId,
      deliveryKey: "second",
      payload: {
        text: "two",
      },
    });
    const claim = await messaging.claimOutbox({
      identityId,
      leaseSeconds: 30,
    });
    if (!claim) throw new Error("Expected outgoing lease");
    await query(database`UPDATE channel_outbox SET lease_expires_at = clock_timestamp() - interval '1 second'
      WHERE id = ${claim.id}`);
    expect(
      await messaging.claimOutbox({
        identityId,
        leaseSeconds: 30,
      })
    ).toBeNull();
    const state = await messaging.inspectOutbox(identityId);
    expect(state.uncertain[0]).toMatchObject({
      id: claim.id,
      attempts: 1,
      status: "uncertain",
    });
    expect(state.counts).toContainEqual({
      status: "queued",
      count: 1,
    });
  }));
test("revocation blocks acceptance, dispatch, and completion and cancels queued output", () =>
  run(async (messaging, database, identityId) => {
    await messaging.accept({
      identityId,
      eventId: "first",
      sourceMessageId: "source-first",
      payload: {
        text: "one",
      },
    });
    await messaging.enqueue({
      identityId,
      deliveryKey: "first",
      payload: {
        text: "reply",
      },
    });
    const claim = await messaging.claimInbox({
      identityId,
      leaseSeconds: 30,
    });
    if (!claim) throw new Error("Expected incoming lease");
    await query(
      database`UPDATE channel_identity SET revoked_at = clock_timestamp() WHERE id = ${identityId}`
    );
    expect(
      await Promise.try(async () =>
        messaging.accept({
          identityId,
          eventId: "new",
          sourceMessageId: "source-new",
          payload: {
            text: "blocked",
          },
        })
      ).then(
        () => {
          throw new Error("Expected the operation to reject.");
        },
        (error: unknown) => error
      )
    ).toBeInstanceOf(IdentityInactive);
    expect(
      await Promise.try(async () =>
        messaging.enqueue({
          identityId,
          deliveryKey: "new",
          payload: {
            text: "blocked",
          },
        })
      ).then(
        () => {
          throw new Error("Expected the operation to reject.");
        },
        (error: unknown) => error
      )
    ).toBeInstanceOf(IdentityInactive);
    const lease = {
      identityId,
      id: claim.id,
      leaseToken: claim.leaseToken,
    };
    expect(
      await Promise.try(async () => messaging.checkInboxLease(lease)).then(
        () => {
          throw new Error("Expected the operation to reject.");
        },
        (error: unknown) => error
      )
    ).toBeInstanceOf(IdentityInactive);
    expect(
      await Promise.try(async () =>
        messaging.markAccepted({
          lease,
          receipt: {
            status: "accepted",
            sessionId: "blocked",
          },
        })
      ).then(
        () => {
          throw new Error("Expected the operation to reject.");
        },
        (error: unknown) => error
      )
    ).toBeInstanceOf(IdentityInactive);
    expect(
      await messaging.claimInbox({
        identityId,
        leaseSeconds: 30,
      })
    ).toBeNull();
    expect(
      await messaging.claimOutbox({
        identityId,
        leaseSeconds: 30,
      })
    ).toBeNull();
    expect((await messaging.inspectOutbox(identityId)).counts).toContainEqual({
      status: "cancelled",
      count: 1,
    });
  }));
test("explicit uncertainty stores only categorical errors and remains visible", () =>
  run(async (messaging, _sql, identityId) => {
    await messaging.enqueue({
      identityId,
      deliveryKey: "first",
      payload: {
        text: "reply",
      },
    });
    const claim = await messaging.claimOutbox({
      identityId,
      leaseSeconds: 30,
    });
    if (!claim) throw new Error("Expected outgoing lease");
    const lease = {
      identityId,
      id: claim.id,
      leaseToken: claim.leaseToken,
    };
    const unsafe = {
      lease,
      reason: "token=secret provider traceback",
    };
    // Untrusted adapter errors must never be persisted as diagnostic strings.
    expect(
      await Promise.try(async () =>
        messaging.markOutboxUncertain(
          // @ts-expect-error Exercise runtime rejection of an untrusted adapter error.
          unsafe
        )
      ).then(
        () => {
          throw new Error("Expected the operation to reject.");
        },
        (error: unknown) => error
      )
    ).toBeInstanceOf(InvalidMessage);
    await messaging.markOutboxUncertain({
      lease,
      reason: "handoff_unknown",
    });
    expect(
      await messaging.claimOutbox({
        identityId,
        leaseSeconds: 30,
      })
    ).toBeNull();
    const state = await messaging.inspectOutbox(identityId);
    expect(state.uncertain[0]?.lastError).toBe("handoff_unknown");
  }));
test("a confirmed rejection releases the lane but ambiguous errors cannot be terminal", () =>
  run(async (messaging, _sql, identityId) => {
    await messaging.accept({
      identityId,
      eventId: "first",
      sourceMessageId: "source-first",
      payload: {
        text: "one",
      },
    });
    const second = await messaging.accept({
      identityId,
      eventId: "second",
      sourceMessageId: "source-second",
      payload: {
        text: "two",
      },
    });
    const claim = await messaging.claimInbox({
      identityId,
      leaseSeconds: 30,
    });
    if (!claim) throw new Error("Expected lease");
    const lease = {
      identityId,
      id: claim.id,
      leaseToken: claim.leaseToken,
    };
    const ambiguous = {
      lease,
      reason: "handoff_unknown",
    };
    expect(
      await Promise.try(async () =>
        messaging.markInboxFailed(
          // @ts-expect-error Runtime validation must also reject an ambiguous failure.
          ambiguous
        )
      ).then(
        () => {
          throw new Error("Expected the operation to reject.");
        },
        (error: unknown) => error
      )
    ).toBeInstanceOf(InvalidMessage);
    expect(
      (
        await messaging.markInboxFailed({
          lease,
          reason: "adapter_rejected",
        })
      ).status
    ).toBe("failed");
    expect(
      (
        await messaging.claimInbox({
          identityId,
          leaseSeconds: 30,
        })
      )?.id
    ).toBe(second.id);
  }));
test("independent identities can claim the same event key without blocking each other", () =>
  run(async (messaging, database, identityId) => {
    const otherId = randomUUID();
    await query(database`INSERT INTO channel_identity (id, channel, installation_id, sender_id, user_id)
      SELECT ${otherId}, channel, installation_id, ${otherId}, user_id
      FROM channel_identity WHERE id = ${identityId}`);
    const inputs = [identityId, otherId].map((id) => ({
      identityId: id,
      eventId: "same-key",
      sourceMessageId: "source-same-key",
      payload: {
        text: "hello",
      },
    }));
    const accepted = await Promise.all(
      inputs.map((input) => messaging.accept(input))
    );
    expect(new Set(accepted.map((receipt) => receipt.id)).size).toBe(2);
    const claims = await Promise.all(
      [identityId, otherId].map((id) =>
        messaging.claimInbox({
          identityId: id,
          leaseSeconds: 30,
        })
      )
    );
    expect(claims.every((claim) => claim !== null)).toBe(true);
  }));
test("prepared native input survives uncertain recovery with immutable content and a new lease", () =>
  run(async (messaging, database, identityId) => {
    const first = await messaging.accept({
      identityId,
      eventId: "keyed-first",
      sourceMessageId: "keyed-source",
      payload: {
        text: "first",
      },
    });
    await messaging.accept({
      identityId,
      eventId: "keyed-second",
      sourceMessageId: "later-source",
      payload: {
        text: "second",
      },
    });
    const claim = await messaging.claimInbox({
      identityId,
      leaseSeconds: 30,
    });
    if (!claim) throw new Error("Expected initial claim");
    const lease = {
      identityId,
      id: claim.id,
      leaseToken: claim.leaseToken,
    };
    const content = [
      {
        type: "text" as const,
        text: "Frozen extracted content",
      },
    ];
    const snapshots = await Promise.all(
      Array.from(
        {
          length: 8,
        },
        () =>
          messaging.prepareInboxHandoff({
            transcripts: [],
            lease,
            content,
          })
      )
    );
    expect(
      snapshots.every(
        (snapshot) => JSON.stringify(snapshot) === JSON.stringify(snapshots[0])
      )
    ).toBe(true);
    expect(snapshots[0]).toMatchObject({
      protocol: "eve-keyed-input-v1",
      inputId: first.id,
      channel: "telegram",
      address: identityId,
      content,
    });
    const owner = await query<{
      userId: string;
    }>(
      database`SELECT user_id AS "userId" FROM channel_identity WHERE id = ${identityId}`
    );
    const account = owner[0];
    if (!account) throw new Error("Missing identity owner");
    expect(snapshots[0]?.principalId).toBe(`better-auth:${account.userId}`);
    expect(
      await Promise.try(async () =>
        messaging.prepareInboxHandoff({
          transcripts: [],
          lease,
          content: "Changed",
        })
      ).then(
        () => {
          throw new Error("Expected the operation to reject.");
        },
        (error: unknown) => error
      )
    ).toBeInstanceOf(PayloadConflict);
    await messaging.markInboxUncertain({
      lease,
      reason: "handoff_unknown",
    });
    const claims = await Promise.all(
      Array.from(
        {
          length: 8,
        },
        () =>
          messaging.claimInbox({
            identityId,
            leaseSeconds: 30,
          })
      )
    );
    const recovered = claims.filter((candidate) => candidate !== null);
    expect(recovered).toHaveLength(1);
    const next = recovered[0];
    if (!next) throw new Error("Expected recovered claim");
    expect(next.id).toBe(first.id);
    expect(next.nativeInput).toEqual(snapshots[0]);
    expect(next.leaseToken).not.toBe(lease.leaseToken);
    expect(next.attempts).toBe(2);
    expect(
      await Promise.try(async () =>
        messaging.prepareInboxHandoff({
          transcripts: [],
          lease,
          content,
        })
      ).then(
        () => {
          throw new Error("Expected the operation to reject.");
        },
        (error: unknown) => error
      )
    ).toBeInstanceOf(LeaseLost);
    await messaging.markAccepted({
      lease: {
        identityId,
        id: next.id,
        leaseToken: next.leaseToken,
      },
      receipt: {
        status: "accepted",
        sessionId: "native-storage-receipt",
      },
    });
    expect(
      (
        await messaging.claimInbox({
          identityId,
          leaseSeconds: 30,
        })
      )?.key
    ).toBe("keyed-second");
  }));
test("expired prepared input can be recovered but a revoked identity cannot prepare or retry", () =>
  run(async (messaging, database, identityId) => {
    await messaging.accept({
      identityId,
      eventId: "expired-keyed",
      sourceMessageId: "source",
      payload: {
        text: "one",
      },
    });
    const claim = await messaging.claimInbox({
      identityId,
      leaseSeconds: 1,
    });
    if (!claim) throw new Error("Expected initial claim");
    const lease = {
      identityId,
      id: claim.id,
      leaseToken: claim.leaseToken,
    };
    await messaging.prepareInboxHandoff({
      transcripts: [],
      lease,
      content: "one",
    });
    await sleep(1100);
    const recovered = await messaging.claimInbox({
      identityId,
      leaseSeconds: 30,
    });
    expect(recovered?.id).toBe(claim.id);
    if (!recovered) throw new Error("Expected expired input recovery");
    await query(
      database`UPDATE channel_identity SET revoked_at = clock_timestamp() WHERE id = ${identityId}`
    );
    expect(
      await Promise.try(async () =>
        messaging.prepareInboxHandoff({
          transcripts: [],
          lease: {
            identityId,
            id: recovered.id,
            leaseToken: recovered.leaseToken,
          },
          content: "one",
        })
      ).then(
        () => {
          throw new Error("Expected the operation to reject.");
        },
        (error: unknown) => error
      )
    ).toBeInstanceOf(IdentityInactive);
    expect(
      await messaging.claimInbox({
        identityId,
        leaseSeconds: 30,
      })
    ).toBeNull();
  }));
test("a lease expiring before media preparation retains its native key and fences the old worker", () =>
  run(async (messaging, _sql, identityId) => {
    const input = await messaging.accept({
      identityId,
      eventId: "early-crash",
      sourceMessageId: "source",
      payload: {
        text: "pending media",
      },
    });
    const first = await messaging.claimInbox({
      identityId,
      leaseSeconds: 1,
    });
    if (!first) throw new Error("Expected initial claim");
    expect(first.nativeInput).toMatchObject({
      inputId: input.id,
      address: identityId,
      protocol: "eve-keyed-input-v1",
      content: null,
    });
    await sleep(1100);
    const next = await messaging.claimInbox({
      identityId,
      leaseSeconds: 30,
    });
    if (!next) throw new Error("Expected recovery before preparation");
    expect(next.nativeInput).toEqual(first.nativeInput);
    expect(next.leaseToken).not.toBe(first.leaseToken);
    const staleLease = {
      identityId,
      id: first.id,
      leaseToken: first.leaseToken,
    };
    expect(
      await Promise.try(async () =>
        messaging.prepareInboxHandoff({
          transcripts: [],
          lease: staleLease,
          content: "stale extraction",
        })
      ).then(
        () => {
          throw new Error("Expected the operation to reject.");
        },
        (error: unknown) => error
      )
    ).toBeInstanceOf(LeaseLost);
    const prepared = await messaging.prepareInboxHandoff({
      transcripts: [],
      lease: {
        identityId,
        id: next.id,
        leaseToken: next.leaseToken,
      },
      content: "current extraction",
    });
    expect(prepared).toEqual({
      ...first.nativeInput,
      content: "current extraction",
    });
    expect(
      await Promise.try(async () =>
        messaging.prepareInboxHandoff({
          transcripts: [],
          lease: staleLease,
          content: "late extraction",
        })
      ).then(
        () => {
          throw new Error("Expected the operation to reject.");
        },
        (error: unknown) => error
      )
    ).toBeInstanceOf(LeaseLost);
  }));
test("the first prepared transcript intents commit together and never mix or resurrect on replay", () =>
  run(async (messaging, database, identityId) => {
    const input = await messaging.accept({
      identityId,
      eventId: "transcript-race",
      sourceMessageId: "voice",
      payload: {
        text: "voice fixture",
      },
    });
    const claim = await messaging.claimInbox({
      identityId,
      leaseSeconds: 30,
    });
    if (!claim) throw new Error("Expected claim");
    const lease = {
      identityId,
      id: claim.id,
      leaseToken: claim.leaseToken,
    };
    const candidates = [
      ["alpha one", "alpha two"],
      ["beta one", "beta two"],
    ];
    await Promise.all(
      candidates.map((transcripts) =>
        messaging.prepareInboxHandoff({
          lease,
          content: "same immutable content",
          transcripts,
        })
      )
    );
    const intents = await query<{
      key: string;
      text: string;
    }>(
      database`SELECT delivery_key AS key, payload->>'text' AS text FROM channel_outbox WHERE identity_id = ${identityId} ORDER BY sequence`
    );
    expect(intents).toHaveLength(2);
    expect(intents.map((item) => item.key)).toEqual([
      `transcript:${input.id}:0:0`,
      `transcript:${input.id}:1:0`,
    ]);
    expect(
      candidates.some((candidate) =>
        candidate.every(
          (text, index) =>
            intents[index]?.text ===
            `I heard: ${text}\nIf this is incorrect, send a correction.`
        )
      )
    ).toBe(true);
    await query(
      database`DELETE FROM channel_outbox WHERE identity_id = ${identityId}`
    );
    await messaging.prepareInboxHandoff({
      lease,
      content: "same immutable content",
      transcripts: ["late contradictory transcript"],
    });
    expect(
      await query(
        database`SELECT id FROM channel_outbox WHERE identity_id = ${identityId}`
      )
    ).toHaveLength(0);
    expect(
      await Promise.try(async () =>
        messaging.prepareInboxHandoff({
          lease,
          content: "different content",
          transcripts: [],
        })
      ).then(
        () => {
          throw new Error("Expected the operation to reject.");
        },
        (error: unknown) => error
      )
    ).toBeInstanceOf(PayloadConflict);
  }));
test("a conflicting transcript intent rolls back both preparation and earlier intents", () =>
  run(async (messaging, database, identityId) => {
    const input = await messaging.accept({
      identityId,
      eventId: "transcript-rollback",
      sourceMessageId: "voice",
      payload: {
        text: "voice fixture",
      },
    });
    await messaging.enqueue({
      identityId,
      deliveryKey: `transcript:${input.id}:1:0`,
      payload: {
        text: "conflicting existing intent",
      },
    });
    const claim = await messaging.claimInbox({
      identityId,
      leaseSeconds: 30,
    });
    if (!claim) throw new Error("Expected claim");
    const lease = {
      identityId,
      id: claim.id,
      leaseToken: claim.leaseToken,
    };
    expect(
      await Promise.try(async () =>
        messaging.prepareInboxHandoff({
          lease,
          content: "prepared voice",
          transcripts: ["first", "second"],
        })
      ).then(
        () => {
          throw new Error("Expected the operation to reject.");
        },
        (error: unknown) => error
      )
    ).toBeInstanceOf(PayloadConflict);
    expect(
      (await messaging.checkInboxLease(lease)).nativeInput?.content
    ).toBeNull();
    const rows = await query<{
      key: string;
    }>(
      database`SELECT delivery_key AS key FROM channel_outbox WHERE identity_id = ${identityId}`
    );
    expect(rows).toEqual([
      {
        key: `transcript:${input.id}:1:0`,
      },
    ]);
  }));
test("uncertain outbox resolve marks delivered, cancels, or authorizes duplicate-risk retry with audit", () =>
  run(async (messaging, database, identityId) => {
    const actor = "better-auth:operator-proof";
    const makeUncertain = async function (deliveryKey: string, text: string) {
      await messaging.enqueue({
        identityId,
        deliveryKey,
        payload: {
          text,
        },
      });
      const claim = await messaging.claimOutbox({
        identityId,
        leaseSeconds: 30,
      });
      if (!claim) throw new Error(`Expected claim for ${deliveryKey}`);
      await messaging.markOutboxUncertain({
        lease: {
          identityId,
          id: claim.id,
          leaseToken: claim.leaseToken,
        },
        reason: "handoff_unknown",
      });
      return claim.id;
    };
    const deliveredId = await makeUncertain("delivered", "one");
    expect(
      await messaging.claimOutbox({
        identityId,
        leaseSeconds: 30,
      })
    ).toBeNull();
    const delivered = await messaging.resolveOutboxUncertain({
      identityId,
      id: deliveredId,
      actorPrincipalId: actor,
      note: "provider lookup recovered receipt",
      decision: {
        kind: "mark_delivered",
        providerMessageId: "tg:1001",
      },
    });
    expect(delivered).toMatchObject({
      id: deliveredId,
      status: "sent",
      resultId: "tg:1001",
      lastError: null,
    });
    expect(
      (
        await messaging.resolveOutboxUncertain({
          identityId,
          id: deliveredId,
          actorPrincipalId: actor,
          decision: {
            kind: "mark_delivered",
            providerMessageId: "tg:1001",
          },
        })
      ).status
    ).toBe("sent");
    expect(
      await Promise.try(async () =>
        messaging.resolveOutboxUncertain({
          identityId,
          id: deliveredId,
          actorPrincipalId: actor,
          decision: {
            kind: "mark_delivered",
            providerMessageId: "tg:other",
          },
        })
      ).then(
        () => {
          throw new Error("Expected the operation to reject.");
        },
        (error: unknown) => error
      )
    ).toBeInstanceOf(OutboxResolutionRejected);
    const cancelledId = await makeUncertain("cancelled", "two");
    const cancelled = await messaging.resolveOutboxUncertain({
      identityId,
      id: cancelledId,
      actorPrincipalId: actor,
      decision: {
        kind: "cancel",
        reason: "abandoned",
      },
    });
    expect(cancelled).toMatchObject({
      id: cancelledId,
      status: "cancelled",
      lastError: "abandoned",
    });
    const retryId = await makeUncertain("retry", "three");
    const retried = await messaging.resolveOutboxUncertain({
      identityId,
      id: retryId,
      actorPrincipalId: actor,
      decision: {
        kind: "authorize_retry",
        acknowledgment: "duplicate_delivery_risk_accepted",
      },
    });
    expect(retried).toMatchObject({
      id: retryId,
      status: "queued",
      lastError: "duplicate_retry_authorized",
    });
    expect(
      await Promise.try(async () =>
        messaging.resolveOutboxUncertain({
          identityId,
          id: retryId,
          actorPrincipalId: actor,
          // @ts-expect-error Exercise runtime rejection of a missing acknowledgment.
          decision: {
            kind: "authorize_retry",
          },
        })
      ).then(
        () => {
          throw new Error("Expected the operation to reject.");
        },
        (error: unknown) => error
      )
    ).toBeInstanceOf(InvalidMessage);
    const reclaim = await messaging.claimOutbox({
      identityId,
      leaseSeconds: 30,
    });
    expect(reclaim?.id).toBe(retryId);
    expect(reclaim?.attempts).toBe(2);
    const audits = await query<{
      decision: string;
      detail: string;
      priorError: string | null;
      actor: string;
      note: string | null;
    }>(database`SELECT decision, detail, prior_error AS "priorError",
          actor_principal_id AS actor, note
        FROM channel_outbox_resolution
        WHERE identity_id = ${identityId}
        ORDER BY created_at, id`);
    expect(audits).toEqual([
      {
        decision: "mark_delivered",
        detail: "tg:1001",
        priorError: "handoff_unknown",
        actor,
        note: "provider lookup recovered receipt",
      },
      {
        decision: "cancel",
        detail: "abandoned",
        priorError: "handoff_unknown",
        actor,
        note: null,
      },
      {
        decision: "authorize_retry",
        detail: "duplicate_delivery_risk_accepted",
        priorError: "handoff_unknown",
        actor,
        note: null,
      },
    ]);
  }));
test("uncertain outbox resolve refuses non-uncertain rows and inactive delivery or retry", () =>
  run(async (messaging, database, identityId) => {
    const actor = "better-auth:operator-proof";
    await messaging.enqueue({
      identityId,
      deliveryKey: "queued-only",
      payload: {
        text: "still queued",
      },
    });
    const queued = await query<{
      id: string;
    }>(database`
        SELECT id FROM channel_outbox
        WHERE identity_id = ${identityId} AND delivery_key = 'queued-only'`);
    const queuedId = queued[0]?.id;
    if (!queuedId) throw new Error("Expected queued outbox row");
    expect(
      await Promise.try(async () =>
        messaging.resolveOutboxUncertain({
          identityId,
          id: queuedId,
          actorPrincipalId: actor,
          decision: {
            kind: "cancel",
            reason: "abandoned",
          },
        })
      ).then(
        () => {
          throw new Error("Expected the operation to reject.");
        },
        (error: unknown) => error
      )
    ).toBeInstanceOf(OutboxResolutionRejected);

    // Clear the queued blocker so the next claim can create uncertainty.
    await query(database`UPDATE channel_outbox SET status = 'cancelled',
        last_error = 'test_cleanup' WHERE id = ${queuedId}`);
    await messaging.enqueue({
      identityId,
      deliveryKey: "stuck",
      payload: {
        text: "stuck",
      },
    });
    const claim = await messaging.claimOutbox({
      identityId,
      leaseSeconds: 30,
    });
    if (!claim) throw new Error("Expected claim");
    await messaging.markOutboxUncertain({
      lease: {
        identityId,
        id: claim.id,
        leaseToken: claim.leaseToken,
      },
      reason: "lease_expired",
    });
    await query(database`UPDATE channel_identity SET revoked_at = clock_timestamp()
        WHERE id = ${identityId}`);
    expect(
      await Promise.try(async () =>
        messaging.resolveOutboxUncertain({
          identityId,
          id: claim.id,
          actorPrincipalId: actor,
          decision: {
            kind: "authorize_retry",
            acknowledgment: "duplicate_delivery_risk_accepted",
          },
        })
      ).then(
        () => {
          throw new Error("Expected the operation to reject.");
        },
        (error: unknown) => error
      )
    ).toBeInstanceOf(IdentityInactive);
    expect(
      await Promise.try(async () =>
        messaging.resolveOutboxUncertain({
          identityId,
          id: claim.id,
          actorPrincipalId: actor,
          decision: {
            kind: "mark_delivered",
            providerMessageId: "tg:revoked",
          },
        })
      ).then(
        () => {
          throw new Error("Expected the operation to reject.");
        },
        (error: unknown) => error
      )
    ).toBeInstanceOf(IdentityInactive);
    const cancelled = await messaging.resolveOutboxUncertain({
      identityId,
      id: claim.id,
      actorPrincipalId: actor,
      decision: {
        kind: "cancel",
        reason: "operator_cancelled",
      },
    });
    expect(cancelled.status).toBe("cancelled");
  }));
