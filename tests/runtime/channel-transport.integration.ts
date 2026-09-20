const configuration = vi.hoisted((): Record<string, unknown> => ({}));
vi.mock("@shared/environment/env", async (original) => {
  const actual = await original<typeof import("@shared/environment/env")>();
  return {
    ...actual,
    env: new Proxy(actual.env, {
      get(target, name): unknown {
        if (typeof name === "string" && name.startsWith("TELEGRAM_"))
          return configuration[name];
        return Reflect.get(target, name);
      },
    }),
  };
});
import { onTestFinished } from "vitest";
import { query } from "@db/queries";
import { sql } from "drizzle-orm";
import { mapAsync } from "../../server/operations/async";
import { randomUUID } from "node:crypto";
import { expect, test, vi } from "vitest";
import { ProviderRetryable } from "../../server/channels/provider-errors";
import { Telegram } from "../../server/channels/telegram";
import {
  ChannelTransport,
  ChannelTransportError,
  splitChannelText,
} from "../../server/channels/transport";
import { Messaging, PayloadConflict } from "../../server/messaging";
import { accessScopeForUser } from "../../shared/identity/access-scope";
const fixture = async function (
  body: (
    transport: typeof ChannelTransport,
    messaging: typeof Messaging,
    sql: typeof import("drizzle-orm").sql,
    identities: readonly string[],
    userId: string
  ) => Promise<void>
) {
  const userId = randomUUID();
  const scope = accessScopeForUser(`better-auth:${userId}`);
  await (async () => {
    const resource = await query(
      sql`INSERT INTO "user" (id, name, email) VALUES (${userId}, 'Transport proof', ${`${userId}@example.invalid`})`
    );
    onTestFinished(async () => {
      await (() =>
        Promise.try(async () =>
          query(sql`DELETE FROM workspaces WHERE id = ${scope.workspaceId}`)
        ).then(() => query(sql`DELETE FROM "user" WHERE id = ${userId}`)))();
    });
    return resource;
  })();
  await query(sql`INSERT INTO workspaces (id) VALUES (${scope.workspaceId})`);
  await query(sql`INSERT INTO workspace_memberships (workspace_id, user_id, role)
    VALUES (${scope.workspaceId}, ${scope.userId}, 'owner')`);
  const identities = Array.from(
    {
      length: 7,
    },
    () => randomUUID()
  );
  await mapAsync(
    identities,
    (id, index) =>
      query(sql`INSERT INTO channel_identity (id, channel, installation_id, sender_id, user_id)
    VALUES (${id}, ${index === 6 ? "kapso" : "telegram"}, 'transport-proof', ${id}, ${userId})`),
    1
  );
  await body(ChannelTransport, Messaging, sql, identities, userId);
};
const run = (body: Parameters<typeof fixture>[0]) => fixture(body);
test("input delivery requires every original chunk, current revision and matching identity", () =>
  run(async (transport, _messaging, database, identities) => {
    const [identityId, otherIdentityId] = identities;
    if (!identityId || !otherIdentityId) throw new Error("Missing identities");
    const inputRequest = {
      sessionId: "session-delivery-proof",
      requestId: "request-delivery-proof",
      revision: "a".repeat(64),
    };
    const text = "details ".repeat(700);
    const receipts = await transport.enqueueText({
      identityId,
      deliveryKey: `input:${inputRequest.sessionId}:${inputRequest.requestId}`,
      text,
      inputRequest,
    });
    expect(receipts).toHaveLength(2);
    expect(await transport.deliveredInput(identityId, inputRequest)).toBeNull();
    const first = receipts[0];
    if (!first) throw new Error("Missing first receipt");
    // These rows model accepted delivery facts; this test does not qualify a provider send.
    await query(database`UPDATE channel_outbox SET status = 'sent',
        sent_at = '2026-09-08T12:00:00Z', provider_message_id = 'part-1'
        WHERE id = ${first.id}`);
    expect(await transport.deliveredInput(identityId, inputRequest)).toBeNull();
    await query(database`UPDATE channel_outbox SET status = 'sent',
        sent_at = '2026-09-08T12:00:02Z', provider_message_id = 'part-2'
        WHERE identity_id = ${identityId} AND id <> ${first.id}`);
    expect(
      await transport.deliveredInput(identityId, inputRequest)
    ).toMatchObject({
      identityId,
      ...inputRequest,
      text,
      deliveredAtMs: 1_788_868_802_000,
      providerMessageIds: ["part-1", "part-2"],
    });
    expect(
      await transport.deliveredInput(otherIdentityId, inputRequest)
    ).toBeNull();
    expect(
      await transport.deliveredInput(identityId, {
        ...inputRequest,
        revision: "b".repeat(64),
      })
    ).toBeNull();
    await query(
      database`UPDATE channel_outbox SET status = 'uncertain' WHERE id = ${first.id}`
    );
    expect(await transport.deliveredInput(identityId, inputRequest)).toBeNull();
  }));
test("splits at 4000 UTF-16 units without splitting surrogate pairs or changing text", async () => {
  const text = `${"a".repeat(3999)}😀${"b".repeat(12_383)}`;
  const chunks = await splitChannelText(text);
  expect(chunks.join("")).toBe(text);
  expect(chunks[0]).toHaveLength(3999);
  expect(
    chunks.every((chunk) => chunk.length <= 4000 && chunk.isWellFormed())
  ).toBe(true);
  expect(chunks).toHaveLength(5);
  await expect(splitChannelText(`${text}x`)).rejects.toBeInstanceOf(
    ChannelTransportError
  );
  await expect(splitChannelText("\uD800")).rejects.toBeInstanceOf(
    ChannelTransportError
  );
});
test.each(["inbox", "outbox"] as const)(
  "%s candidates are fair per identity and exclude blockers",
  (lane) =>
    run(async (transport, messaging, database, identities) => {
      const table = database.identifier(
        lane === "inbox" ? "channel_inbox" : "channel_outbox"
      );
      const received = database.identifier(
        lane === "inbox" ? "received_at" : "created_at"
      );
      const [noisy, other, uncertain, expired, busy, revoked, anotherChannel] =
        identities;
      if (
        !noisy ||
        !other ||
        !uncertain ||
        !expired ||
        !busy ||
        !revoked ||
        !anotherChannel
      )
        throw new Error("Missing fixtures");
      const put = (identityId: string, key: string) =>
        lane === "inbox"
          ? messaging.accept({
              identityId,
              eventId: key,
              sourceMessageId: key,
              payload: {
                text: "fixture",
              },
            })
          : messaging.enqueue({
              identityId,
              deliveryKey: key,
              payload: {
                text: "fixture",
              },
            });
      await mapAsync(identities, (id) => put(id, "first"), 1);
      await mapAsync(
        Array.from(
          {
            length: 30,
          },
          (_, index) => String(index)
        ),
        (key) => put(noisy, key),
        1
      );
      await mapAsync([uncertain, expired, busy], (id) => put(id, "second"), 1);
      const claim =
        lane === "inbox"
          ? messaging.claimInbox.bind(messaging)
          : messaging.claimOutbox.bind(messaging);
      const stop =
        lane === "inbox"
          ? messaging.markInboxUncertain.bind(messaging)
          : messaging.markOutboxUncertain.bind(messaging);
      const lease = await claim({
        identityId: uncertain,
        leaseSeconds: 30,
      });
      if (!lease) throw new Error("Missing lease");
      await stop({
        lease: {
          id: lease.id,
          identityId: lease.identityId,
          leaseToken: lease.leaseToken,
        },
        reason: "handoff_unknown",
      });
      if (lane === "inbox")
        await query(
          database`UPDATE channel_inbox SET native_input = NULL WHERE id = ${lease.id}`
        );
      await claim({
        identityId: expired,
        leaseSeconds: 30,
      });
      await claim({
        identityId: busy,
        leaseSeconds: 30,
      });
      await query(
        database`UPDATE ${table} SET lease_expires_at = clock_timestamp() - interval '1 second' WHERE identity_id = ${expired} AND status = 'dispatching'`
      );
      await query(
        database`UPDATE channel_identity SET revoked_at = clock_timestamp() WHERE id = ${revoked}`
      );
      await mapAsync(
        identities,
        (id, index) =>
          query(
            database`UPDATE ${table} SET ${received} = clock_timestamp() - ${100 - index} * interval '1 minute' WHERE identity_id = ${id}`
          ),
        1
      );
      const candidates =
        lane === "inbox"
          ? transport.inboxCandidates
          : transport.outboxCandidates;
      expect(
        (await candidates("telegram", 25)).map((identity) => identity.id)
      ).toEqual(
        lane === "inbox"
          ? [noisy, other, expired]
          : [noisy, other, expired, revoked]
      );
      expect(
        (await candidates("telegram", 2)).map((identity) => identity.id)
      ).toEqual([noisy, other]);
      expect(
        (await candidates("kapso", 25)).map((identity) => identity.id)
      ).toEqual([anotherChannel]);
      expect(
        await Promise.try(async () => candidates("telegram", 26)).then(
          () => {
            throw new Error("Expected the operation to reject.");
          },
          (error: unknown) => error
        )
      ).toBeInstanceOf(ChannelTransportError);
      // Both lanes are parameters of this test; only outbox has provider delivery to verify.
      /* oxlint-disable vitest/no-conditional-expect */
      if (lane === "outbox") {
        expect(await transport.drainOutbox(revoked)).toEqual({
          state: "idle",
          sent: 0,
          failed: 0,
          uncertain: 0,
        });
        const rows = await query<{
          status: string;
        }>(
          database`SELECT status FROM channel_outbox WHERE identity_id = ${revoked}`
        );
        expect(rows.every((row) => row.status === "cancelled")).toBe(true);
        expect(await transport.drainOutbox(expired)).toEqual({
          state: "uncertain",
          sent: 0,
          failed: 0,
          uncertain: 1,
        });
        expect(
          (await candidates("telegram", 25)).map((identity) => identity.id)
        ).toEqual([noisy, other]);
      }
      /* oxlint-enable vitest/no-conditional-expect */
    })
);
test("validates active identity and rejects mismatched channel or revocation", () =>
  run(async (transport, _messaging, database, identities, userId) => {
    const id = identities[0];
    if (!id) throw new Error("Missing fixture");
    expect(await transport.activeIdentity(id, "telegram")).toMatchObject({
      id,
      userId,
      channel: "telegram",
    });
    expect(
      await Promise.try(async () => transport.activeIdentity(id, "kapso")).then(
        () => {
          throw new Error("Expected the operation to reject.");
        },
        (error: unknown) => error
      )
    ).toMatchObject({
      reason: "channel_mismatch",
    });
    await query(
      database`UPDATE channel_identity SET revoked_at = clock_timestamp() WHERE id = ${id}`
    );
    expect(
      await Promise.try(async () =>
        transport.activeIdentity(id, "telegram")
      ).then(
        () => {
          throw new Error("Expected the operation to reject.");
        },
        (error: unknown) => error
      )
    ).toMatchObject({
      reason: "identity_inactive",
    });
    expect(
      await Promise.try(async () =>
        transport.enqueueText({
          identityId: id,
          deliveryKey: "revoked",
          text: "blocked",
        })
      ).then(
        () => {
          throw new Error("Expected the operation to reject.");
        },
        (error: unknown) => error
      )
    ).toMatchObject({
      reason: "identity_inactive",
    });
  }));
test("enqueues stable chunks idempotently and rolls back partial writes on conflict", () =>
  run(async (transport, messaging, database, identities) => {
    const id = identities[0];
    if (!id) throw new Error("Missing fixture");
    const text = `${"a".repeat(3999)}😀${"b".repeat(5000)}`;
    const input = {
      identityId: id,
      deliveryKey: "reply",
      text,
      replyToMessageId: "123",
    };
    const first = await transport.enqueueText(input);
    const replay = await transport.enqueueText(input);
    expect(replay.map((receipt) => receipt.id)).toEqual(
      first.map((receipt) => receipt.id)
    );
    expect(first.map((receipt) => receipt.key)).toEqual([
      "reply:0",
      "reply:1",
      "reply:2",
    ]);
    expect(first.map((receipt) => receipt.payload.text).join("")).toBe(text);
    expect(
      first.every((receipt) => receipt.payload.replyToMessageId === "123")
    ).toBe(true);
    expect(
      await Promise.try(async () =>
        transport.enqueueText({
          ...input,
          text: `${text}changed`,
        })
      ).then(
        () => {
          throw new Error("Expected the operation to reject.");
        },
        (error: unknown) => error
      )
    ).toBeInstanceOf(PayloadConflict);
    expect(
      await Promise.try(async () =>
        transport.enqueueText({
          ...input,
          text: "a".repeat(3999),
        })
      ).then(
        () => {
          throw new Error("Expected the operation to reject.");
        },
        (error: unknown) => error
      )
    ).toBeInstanceOf(PayloadConflict);
    await transport.enqueueText({
      identityId: id,
      deliveryKey: "extend",
      text: "x".repeat(4000),
    });
    expect(
      await Promise.try(async () =>
        transport.enqueueText({
          identityId: id,
          deliveryKey: "extend",
          text: "x".repeat(4001),
        })
      ).then(
        () => {
          throw new Error("Expected the operation to reject.");
        },
        (error: unknown) => error
      )
    ).toBeInstanceOf(PayloadConflict);
    await messaging.enqueue({
      identityId: id,
      deliveryKey: "atomic:1",
      payload: {
        text: "existing",
      },
    });
    expect(
      await Promise.try(async () =>
        transport.enqueueText({
          identityId: id,
          deliveryKey: "atomic",
          text: "x".repeat(4001),
        })
      ).then(
        () => {
          throw new Error("Expected the operation to reject.");
        },
        (error: unknown) => error
      )
    ).toBeInstanceOf(PayloadConflict);
    const partial = await query(
      database`SELECT id FROM channel_outbox WHERE identity_id = ${id} AND delivery_key = 'atomic:0'`
    );
    expect(partial).toHaveLength(0);
  }));
test("unsupported stored media fails before any provider configuration or send", () =>
  run(async (transport, messaging, database, identities) => {
    const id = identities[0];
    if (!id) throw new Error("Missing fixture");
    const receipt = await messaging.enqueue({
      identityId: id,
      deliveryKey: "media",
      payload: {
        attachments: [
          {
            id: "opaque",
            mediaType: "image/png",
          },
        ],
      },
    });
    expect(
      await Promise.try(async () => transport.drainOutbox(id)).then(
        () => {
          throw new Error("Expected the operation to reject.");
        },
        (error: unknown) => error
      )
    ).toMatchObject({
      reason: "unsupported_payload",
    });
    const rows = await query<{
      status: string;
      last_error: string;
    }>(
      database`SELECT status, last_error FROM channel_outbox WHERE id = ${receipt.id}`
    );
    expect(rows[0]).toEqual({
      status: "failed",
      last_error: "adapter_rejected",
    });
    expect(await transport.drainOutbox(id)).toEqual({
      state: "idle",
      sent: 0,
      failed: 0,
      uncertain: 0,
    });
  }));
test.each([
  {
    config: {},
    reason: "configuration",
  },
  {
    config: {
      TELEGRAM_BOT_ID: "123456",
      TELEGRAM_BOT_USERNAME: "transport_bot",
    },
    reason: "installation_mismatch",
  },
])("fails $reason before dispatch without provider I/O", ({ config, reason }) =>
  run(async (transport, messaging, database, identities) => {
    for (const key of Object.keys(configuration))
      Reflect.deleteProperty(configuration, key);
    Object.assign(configuration, config);
    const id = identities[0];
    if (!id) throw new Error("Missing fixture");
    const receipt = await messaging.enqueue({
      identityId: id,
      deliveryKey: "preflight",
      payload: {
        text: "must not leave database",
      },
    });
    const failure = await Promise.try(async () =>
      transport.drainOutbox(id)
    ).then(
      () => {
        throw new Error("Expected the operation to reject.");
      },
      (error: unknown) => error
    );
    expect(failure).toMatchObject({
      reason,
    });
    const rows = await query<{
      status: string;
    }>(database`SELECT status FROM channel_outbox WHERE id = ${receipt.id}`);
    expect(rows[0]?.status).toBe("failed");
  })
);
test("claims atomic text chunks in enqueue order despite tied timestamps and reversed UUID order", () =>
  run(async (transport, messaging, database, identities) => {
    const identityId = identities[0];
    if (!identityId) throw new Error("Missing fixture");
    const chunks = ["a", "b", "c", "d"].map((letter) => letter.repeat(4000));
    const receipts = await transport.enqueueText({
      identityId,
      deliveryKey: "ordered",
      text: chunks.join(""),
    });
    expect(receipts).toHaveLength(4);
    const timestamps = await query<{
      count: number;
    }>(database`SELECT count(DISTINCT created_at)::int AS count
        FROM channel_outbox WHERE identity_id = ${identityId}`);
    expect(timestamps[0]?.count).toBe(1);
    // Make the old UUID tie-breaker deterministically wrong using real stored fixtures.
    const prefix = randomUUID().slice(0, 24);
    await mapAsync(
      receipts,
      (receipt, index) =>
        query(database`UPDATE channel_outbox SET id = ${`${prefix}${String(4 - index).padStart(12, "0")}`}
          WHERE id = ${receipt.id}`),
      1
    );
    const delivered: string[] = [];
    await mapAsync(
      chunks,
      async (text, index) => {
        const claim = await messaging.claimOutbox({
          identityId,
          leaseSeconds: 30,
        });
        if (!claim) throw new Error("Missing ordered claim");
        expect(claim.key).toBe(`ordered:${String(index)}`);
        expect(claim.payload.text).toBe(text);
        delivered.push(text);
        // This receipt exercises queue settlement only; it is not provider evidence.
        const settled = await messaging.markSent({
          lease: {
            identityId,
            id: claim.id,
            leaseToken: claim.leaseToken,
          },
          receipt: {
            status: "sent",
            providerMessageId: `storage-order-fixture-${String(index)}`,
          },
        });
        expect(settled.status).toBe("sent");
      },
      1
    );
    expect(delivered.join("")).toBe(chunks.join(""));
    expect(
      await messaging.claimOutbox({
        identityId,
        leaseSeconds: 30,
      })
    ).toBeNull();
  }));
test("rejects a stored chunk key hole even when its count matches the requested chunks", () =>
  run(async (transport, messaging, database, identities) => {
    const identityId = identities[0];
    if (!identityId) throw new Error("Missing fixture");
    await messaging.enqueue({
      identityId,
      deliveryKey: "hole:0",
      payload: {
        text: "a".repeat(4000),
      },
    });
    await messaging.enqueue({
      identityId,
      deliveryKey: "hole:2",
      payload: {
        text: "unexpected extra chunk",
      },
    });
    expect(
      await Promise.try(async () =>
        transport.enqueueText({
          identityId,
          deliveryKey: "hole",
          text: "a".repeat(4001),
        })
      ).then(
        () => {
          throw new Error("Expected the operation to reject.");
        },
        (error: unknown) => error
      )
    ).toBeInstanceOf(PayloadConflict);
    const rows = await query<{
      key: string;
    }>(database`SELECT delivery_key AS key FROM channel_outbox
        WHERE identity_id = ${identityId} ORDER BY delivery_key`);
    expect(rows.map((row) => row.key)).toEqual(["hole:0", "hole:2"]);
  }));
test("settled task reports retain the first atomic delivery across concurrent rewording", () =>
  run(async (transport, messaging, database, identities) => {
    const identityId = identities[0];
    if (!identityId) throw new Error("Missing fixture");
    const deliveryKey = `task-report:${"a".repeat(64)}`;
    const wording = [
      "First combined result. ".repeat(220),
      "A reworded duplicate.",
    ];
    const [first, second] = await Promise.all(
      wording.map((text) =>
        transport.enqueueTaskReport({
          identityId,
          deliveryKey,
          text,
        })
      )
    );
    expect(first?.map((receipt) => receipt.id)).toEqual(
      second?.map((receipt) => receipt.id)
    );
    const saved = await query<{
      text: string;
    }>(
      database`SELECT payload->>'text' AS text FROM channel_outbox WHERE identity_id = ${identityId} ORDER BY delivery_key`
    );
    expect(wording).toContain(saved.map((receipt) => receipt.text).join(""));
    const replay = await transport.enqueueTaskReport({
      identityId,
      deliveryKey,
      text: "A third version in a later turn.",
    });
    expect(replay.map((receipt) => receipt.id)).toEqual(
      first?.map((receipt) => receipt.id)
    );
    const distinct = await transport.enqueueTaskReport({
      identityId,
      deliveryKey: `task-report:${"b".repeat(64)}`,
      text: "Another completed cohort.",
    });
    expect(distinct[0]?.id).not.toBe(first?.[0]?.id);
    await transport.enqueueText({
      identityId,
      deliveryKey: "ordinary-message",
      text: "Original ordinary message",
    });
    expect(
      await Promise.try(async () =>
        transport.enqueueText({
          identityId,
          deliveryKey: "ordinary-message",
          text: "Conflicting ordinary message",
        })
      ).then(
        () => {
          throw new Error("Expected the operation to reject.");
        },
        (error: unknown) => error
      )
    ).toBeInstanceOf(PayloadConflict);
    await query(
      database`UPDATE channel_identity SET revoked_at = clock_timestamp() WHERE id = ${identityId}`
    );
    expect(
      await Promise.try(async () =>
        transport.enqueueTaskReport({
          identityId,
          deliveryKey,
          text: "After revocation",
        })
      ).then(
        () => {
          throw new Error("Expected the operation to reject.");
        },
        (error: unknown) => error
      )
    ).toBeInstanceOf(ChannelTransportError);
  }));
test("the dispatcher recovers native inputs before and after preparation while blocking unmarked inputs and output", () =>
  run(async (transport, messaging, database, identities) => {
    const [preparedId, unpreparedId, outboundId, unmarkedId] = identities;
    if (!preparedId || !unpreparedId || !outboundId || !unmarkedId)
      throw new Error("Missing identities");
    await mapAsync(
      [preparedId, unpreparedId, unmarkedId],
      async (identityId) => {
        await messaging.accept({
          identityId,
          eventId: "recovery-candidate",
          sourceMessageId: "source",
          payload: {
            text: "one",
          },
        });
        const claim = await messaging.claimInbox({
          identityId,
          leaseSeconds: 30,
        });
        if (!claim) throw new Error("Expected initial claim");
        if (identityId === unmarkedId)
          await query(
            database`UPDATE channel_inbox SET native_input = NULL WHERE id = ${claim.id}`
          );
        const lease = {
          identityId,
          id: claim.id,
          leaseToken: claim.leaseToken,
        };
        if (identityId === preparedId)
          await messaging.prepareInboxHandoff({
            transcripts: [],
            lease,
            content: "one",
          });
        await messaging.markInboxUncertain({
          lease,
          reason: "handoff_unknown",
        });
      },
      1
    );
    await messaging.enqueue({
      identityId: outboundId,
      deliveryKey: "uncertain-send",
      payload: {
        text: "reply",
      },
    });
    const outbound = await messaging.claimOutbox({
      identityId: outboundId,
      leaseSeconds: 30,
    });
    if (!outbound) throw new Error("Expected outbox claim");
    await messaging.markOutboxUncertain({
      lease: {
        identityId: outboundId,
        id: outbound.id,
        leaseToken: outbound.leaseToken,
      },
      reason: "adapter_unavailable",
    });
    const candidates = await transport.inboxCandidates("telegram", 25);
    expect(candidates.map((candidate) => candidate.id)).toContain(preparedId);
    expect(candidates.map((candidate) => candidate.id)).toContain(unpreparedId);
    expect(candidates.map((candidate) => candidate.id)).not.toContain(
      unmarkedId
    );
    expect(
      (await transport.outboxCandidates("telegram", 25)).map(
        (candidate) => candidate.id
      )
    ).not.toContain(outboundId);
  }));
test("HTTP 429 schedules retry_after deferral instead of terminal failure", () => {
  Object.assign(configuration, {
    TELEGRAM_BOT_ID: "123456",
    TELEGRAM_BOT_USERNAME: "transport_bot",
  });
  vi.spyOn(Telegram, "sendText").mockRejectedValue(
    new ProviderRetryable({
      provider: "telegram",
      status: 429,
      retryAfterSeconds: 12,
    })
  );
  return run(async (transport, messaging, database, identities) => {
    const identityId = identities[0];
    if (!identityId) throw new Error("Missing fixture");
    await query(database`UPDATE channel_identity SET installation_id = '123456'
        WHERE id = ${identityId}`);
    const receipt = await messaging.enqueue({
      identityId,
      deliveryKey: "rate-limit-one",
      payload: {
        text: "temporary throttle",
      },
    });
    const follower = await messaging.enqueue({
      identityId,
      deliveryKey: "rate-limit-two",
      payload: {
        text: "must wait behind deferred head",
      },
    });
    expect(await transport.drainOutbox(identityId)).toEqual({
      state: "deferred",
      sent: 0,
      failed: 0,
      uncertain: 0,
    });
    const rows = await query<{
      id: string;
      status: string;
      last_error: string | null;
      ready: boolean;
    }>(database`SELECT id, status, last_error,
        (lease_expires_at IS NULL OR lease_expires_at <= clock_timestamp()) AS ready
        FROM channel_outbox WHERE identity_id = ${identityId}
        ORDER BY sequence`);
    expect(rows[0]).toMatchObject({
      id: receipt.id,
      status: "queued",
      last_error: "adapter_rate_limited",
      ready: false,
    });
    expect(rows[1]).toMatchObject({
      id: follower.id,
      status: "queued",
      last_error: null,
    });
    expect(
      await messaging.claimOutbox({
        identityId,
        leaseSeconds: 30,
      })
    ).toBeNull();
    await query(database`UPDATE channel_outbox
        SET lease_expires_at = clock_timestamp() - interval '1 second'
        WHERE id = ${receipt.id}`);
    const claim = await messaging.claimOutbox({
      identityId,
      leaseSeconds: 30,
    });
    expect(claim?.id).toBe(receipt.id);
    expect(claim?.key).toBe("rate-limit-one");
  });
});
